"""Contradiction Radar scan runner (lane L5)."""

from __future__ import annotations

import asyncio
import json
import threading
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.exceptions import ConflictException
from app.models.contradiction import Contradiction
from app.models.document import Document
from app.models.radar_scan import RadarScan
from app.models.user import User
from app.models.workspace import Workspace
from tests.test_radar.conftest import FakeCollection, FakeNLI, keyword_embed, unit

REVENUE_A = "Northwind revenue in 2025 was €412 million."
REVENUE_B = "Northwind revenue in 2025 was €398 million."
STAFF = "The company employs 1,240 people across Europe."


@pytest_asyncio.fixture
async def seeded(test_db: AsyncSession):
    user = User(email="radar@example.com", username="radar", password_hash="x", is_active=True)
    test_db.add(user)
    await test_db.commit()
    workspace = Workspace(name="Radar WS", owner_id=user.id)
    test_db.add(workspace)
    await test_db.commit()
    docs = []
    for name in ("annual-report.pdf", "press-release.pdf"):
        doc = Document(
            workspace_id=workspace.id, filename=name, original_filename=name,
            mime_type="application/pdf", file_size=1, status="ready",
        )
        test_db.add(doc)
        docs.append(doc)
    await test_db.commit()
    return workspace, docs[0], docs[1], user


def _record(doc: Document, index: int, text: str, embedding: list[float], page: int | None = 1) -> dict:
    return {
        "id": f"{doc.id}:{index}",
        "document_id": doc.id,
        "document_name": doc.original_filename,
        "chunk_id": f"chunk-{doc.original_filename}-{index}",
        "text": text,
        "embedding": embedding,
        "page_number": page,
    }


@pytest.fixture
def radar(monkeypatch):
    """Patch Chroma / embedder / NLI inside the scan module; returns a setter."""
    from app.radar import scan as scan_mod

    state: dict = {"nli": FakeNLI()}

    def install(records: list[dict], nli: FakeNLI | None = None) -> tuple[FakeCollection, FakeNLI]:
        collection = FakeCollection(records)
        state["nli"] = nli or state["nli"]
        monkeypatch.setattr(scan_mod, "get_workspace_collection", lambda _wid: collection)
        monkeypatch.setattr(scan_mod, "nli_batch", state["nli"])
        monkeypatch.setattr(scan_mod, "_embed_sentences", keyword_embed)
        return collection, state["nli"]

    return install


async def _rows(test_db: AsyncSession, workspace_id: str) -> list[Contradiction]:
    test_db.expire_all()
    result = await test_db.execute(select(Contradiction).where(Contradiction.workspace_id == workspace_id))
    return list(result.scalars().all())


async def _scan_row(test_db: AsyncSession, scan_id: str) -> RadarScan:
    test_db.expire_all()
    return (await test_db.execute(select(RadarScan).where(RadarScan.id == scan_id))).scalar_one()


@pytest.mark.asyncio
class TestRunScan:
    async def test_flags_planted_numeric_contradiction(self, seeded, radar, test_db):
        from app.radar.scan import run_scan

        workspace, doc_a, doc_b, user = seeded
        radar([
            _record(doc_a, 0, f"{REVENUE_A} {STAFF}", unit(1, 0, 0), page=3),
            _record(doc_b, 0, f"{REVENUE_B} {STAFF}", unit(1, 0.1, 0), page=1),
        ])

        scan_id = await run_scan(workspace.id, created_by=user.id)

        rows = await _rows(test_db, workspace.id)
        assert len(rows) == 1
        row = rows[0]
        first, second = sorted([(doc_a.id, REVENUE_A), (doc_b.id, REVENUE_B)])
        assert (row.doc_a_id, row.sentence_a) == first
        assert (row.doc_b_id, row.sentence_b) == second
        assert row.score == pytest.approx(0.95)
        assert row.similarity > 0.99
        assert row.status == "open"
        assert row.scan_id == scan_id

        scan = await _scan_row(test_db, scan_id)
        assert scan.status == "done"
        assert scan.created_by == user.id
        assert scan.chunks_scanned == 2
        assert scan.pairs_checked == 1
        assert scan.found == 1
        assert scan.started_at is not None and scan.finished_at is not None
        assert scan.error is None

    async def test_ignores_same_document_pairs(self, seeded, radar, test_db):
        from app.radar.scan import run_scan

        workspace, doc_a, _doc_b, _user = seeded
        doc_a_id = doc_a.id
        collection, nli = radar([
            _record(doc_a, 0, REVENUE_A, unit(1, 0, 0)),
            _record(doc_a, 1, REVENUE_B, unit(1, 0, 0)),
        ])

        scan_id = await run_scan(workspace.id)

        assert await _rows(test_db, workspace.id) == []
        assert collection.query_calls
        assert all(call["where"] == {"document_id": {"$ne": doc_a_id}} for call in collection.query_calls)
        assert nli.calls == []
        assert (await _scan_row(test_db, scan_id)).status == "done"

    async def test_skips_chunk_pairs_below_similarity(self, seeded, radar, test_db, monkeypatch):
        from app.radar.scan import run_scan

        monkeypatch.setattr(settings, "RADAR_MIN_SIMILARITY", 0.9)
        workspace, doc_a, doc_b, _user = seeded
        _collection, nli = radar([
            _record(doc_a, 0, REVENUE_A, unit(1, 0, 0)),
            _record(doc_b, 0, REVENUE_B, unit(1, 1, 0)),  # cosine 0.707
        ])

        scan_id = await run_scan(workspace.id)

        assert await _rows(test_db, workspace.id) == []
        assert nli.calls == []
        assert (await _scan_row(test_db, scan_id)).pairs_checked == 0

    @pytest.mark.parametrize(
        "nli",
        [FakeNLI(contradiction=0.7), FakeNLI(contradiction=0.85, entailment=0.9)],
        ids=["below-min-contradiction", "entailment-wins"],
    )
    async def test_respects_contradiction_threshold_and_entailment(self, seeded, radar, test_db, nli):
        from app.radar.scan import run_scan

        workspace, doc_a, doc_b, _user = seeded
        if nli.entailment == 0.9:
            # One direction says contradiction 0.85, the other entailment 0.9.
            base = nli

            def split(pairs):
                base.calls.append(list(pairs))
                return [(0.05, 0.1, 0.85) if i % 2 == 0 else (0.9, 0.05, 0.05) for i in range(len(pairs))]

            nli = split  # type: ignore[assignment]
        radar([
            _record(doc_a, 0, REVENUE_A, unit(1, 0, 0)),
            _record(doc_b, 0, REVENUE_B, unit(1, 0, 0)),
        ], nli=nli)

        scan_id = await run_scan(workspace.id)

        assert await _rows(test_db, workspace.id) == []
        scan = await _scan_row(test_db, scan_id)
        assert scan.pairs_checked == 1
        assert scan.found == 0

    async def test_scores_both_directions_in_one_batch(self, seeded, radar, test_db):
        from app.radar.scan import run_scan

        workspace, doc_a, doc_b, _user = seeded
        _collection, nli = radar([
            _record(doc_a, 0, REVENUE_A, unit(1, 0, 0)),
            _record(doc_b, 0, REVENUE_B, unit(1, 0, 0)),
        ])

        await run_scan(workspace.id)

        assert len(nli.calls) == 1
        assert sorted(nli.calls[0]) == sorted([(REVENUE_A, REVENUE_B), (REVENUE_B, REVENUE_A)])

    async def test_dedupes_pairs_and_rescans_are_idempotent(self, seeded, radar, test_db):
        from app.radar.scan import run_scan

        workspace, doc_a, doc_b, _user = seeded
        _collection, nli = radar([
            _record(doc_a, 0, REVENUE_A, unit(1, 0, 0)),
            _record(doc_b, 0, REVENUE_B, unit(1, 0, 0)),
            # Chunk overlap: the same sentence again in a neighbouring chunk.
            _record(doc_b, 1, REVENUE_B, unit(1, 0.05, 0)),
        ])

        first = await run_scan(workspace.id)
        second = await run_scan(workspace.id)

        rows = await _rows(test_db, workspace.id)
        assert len(rows) == 1
        assert (await _scan_row(test_db, first)).found == 1
        assert (await _scan_row(test_db, second)).found == 1
        # A->B and B->A neighbour hits collapse into one chunk pair each.
        assert (await _scan_row(test_db, first)).pairs_checked == 2

    async def test_rescan_preserves_dismissed_status(self, seeded, radar, test_db):
        from app.radar.scan import run_scan

        workspace, doc_a, doc_b, user = seeded
        radar([
            _record(doc_a, 0, REVENUE_A, unit(1, 0, 0)),
            _record(doc_b, 0, REVENUE_B, unit(1, 0, 0)),
        ])
        await run_scan(workspace.id)
        row = (await _rows(test_db, workspace.id))[0]
        row.status = "dismissed"
        row.resolved_by = user.id
        await test_db.commit()

        await run_scan(workspace.id)

        rows = await _rows(test_db, workspace.id)
        assert len(rows) == 1
        assert rows[0].status == "dismissed"
        assert rows[0].resolved_by == user.id

    async def test_scoped_scan_reads_only_scope_documents(self, seeded, radar, test_db):
        from app.radar.scan import run_scan

        workspace, doc_a, doc_b, _user = seeded
        collection, _nli = radar([
            _record(doc_a, 0, REVENUE_A, unit(1, 0, 0)),
            _record(doc_b, 0, REVENUE_B, unit(1, 0, 0)),
        ])

        scan_id = await run_scan(workspace.id, document_ids=[doc_b.id])

        assert collection.get_calls[0]["where"] == {"document_id": {"$in": [doc_b.id]}}
        scan = await _scan_row(test_db, scan_id)
        assert json.loads(scan.scope) == [doc_b.id]
        assert scan.chunks_scanned == 1
        assert len(await _rows(test_db, workspace.id)) == 1

    async def test_caps_chunks_at_radar_max_chunks(self, seeded, radar, test_db, monkeypatch):
        from app.radar.scan import run_scan

        monkeypatch.setattr(settings, "RADAR_MAX_CHUNKS", 1)
        workspace, doc_a, doc_b, _user = seeded
        radar([
            _record(doc_a, 0, REVENUE_A, unit(1, 0, 0)),
            _record(doc_b, 0, REVENUE_B, unit(1, 0, 0)),
        ])

        scan_id = await run_scan(workspace.id)

        assert (await _scan_row(test_db, scan_id)).chunks_scanned == 1

    async def test_failure_marks_scan_failed(self, seeded, monkeypatch, test_db):
        from app.radar import scan as scan_mod

        workspace, *_ = seeded

        def boom(_wid):
            raise RuntimeError("chroma unavailable")

        monkeypatch.setattr(scan_mod, "get_workspace_collection", boom)

        scan_id = await scan_mod.run_scan(workspace.id)

        scan = await _scan_row(test_db, scan_id)
        assert scan.status == "failed"
        assert "chroma unavailable" in (scan.error or "")
        assert scan.finished_at is not None


@pytest.mark.asyncio
class TestScanLifecycle:
    async def test_start_scan_task_rejects_second_active_scan(self, seeded, test_db):
        from app.radar.scan import start_scan_task

        workspace, *_ = seeded
        test_db.add(RadarScan(workspace_id=workspace.id, status="running"))
        await test_db.commit()

        with pytest.raises(ConflictException) as exc:
            await start_scan_task(workspace.id)
        assert exc.value.status_code == 409

    async def test_stale_active_scan_does_not_block(self, seeded, radar, test_db):
        from app.radar.scan import run_scan

        workspace, doc_a, doc_b, _user = seeded
        radar([_record(doc_a, 0, REVENUE_A, unit(1, 0, 0))])
        test_db.add(RadarScan(
            workspace_id=workspace.id, status="running",
            created_at=datetime.now(timezone.utc) - timedelta(hours=3),
        ))
        await test_db.commit()

        scan_id = await run_scan(workspace.id)

        assert (await _scan_row(test_db, scan_id)).status == "done"

    async def test_start_scan_task_returns_queued_scan_and_runs_in_background(self, seeded, radar, test_db):
        from app.api.stream_registry import pending_tasks
        from app.radar.scan import start_scan_task

        workspace, doc_a, doc_b, _user = seeded
        radar([
            _record(doc_a, 0, REVENUE_A, unit(1, 0, 0)),
            _record(doc_b, 0, REVENUE_B, unit(1, 0, 0)),
        ])

        scan_id = await start_scan_task(workspace.id)
        assert (await _scan_row(test_db, scan_id)).status == "queued"

        await asyncio.gather(*pending_tasks())
        assert (await _scan_row(test_db, scan_id)).status == "done"
        assert len(await _rows(test_db, workspace.id)) == 1

    async def test_auto_scan_while_active_queues_documents_for_a_follow_up(self, seeded, radar, test_db):
        from app.api.stream_registry import pending_tasks
        from app.radar import scan as scan_mod

        workspace, doc_a, doc_b, _user = seeded
        scopes = [[doc_a.id], [doc_b.id]]
        collection, _nli = radar([
            _record(doc_a, 0, REVENUE_A, unit(1, 0, 0)),
            _record(doc_b, 0, REVENUE_B, unit(1, 0, 0)),
        ])
        gate = threading.Event()
        real_get = collection.get

        def slow_get(**kwargs):
            gate.wait(5)
            return real_get(**kwargs)

        collection.get = slow_get  # type: ignore[method-assign]

        first = await scan_mod.request_auto_scan(workspace.id, [doc_a.id])
        assert first is not None
        queued = await scan_mod.request_auto_scan(workspace.id, [doc_b.id])
        assert queued is None  # folded into a follow-up, not a 409

        gate.set()
        await asyncio.gather(*pending_tasks())

        workspace_id = workspace.id
        test_db.expire_all()
        scans = (await test_db.execute(
            select(RadarScan).where(RadarScan.workspace_id == workspace_id).order_by(RadarScan.created_at)
        )).scalars().all()
        assert [s.status for s in scans] == ["done", "done"]
        assert [json.loads(s.scope) for s in scans] == scopes

    async def test_run_scan_waits_for_in_process_scan(self, seeded, radar, test_db):
        from app.radar import scan as scan_mod

        workspace, doc_a, doc_b, _user = seeded
        collection, _nli = radar([_record(doc_a, 0, REVENUE_A, unit(1, 0, 0))])
        gate = threading.Event()
        real_get = collection.get

        def slow_get(**kwargs):
            gate.wait(5)
            return real_get(**kwargs)

        collection.get = slow_get  # type: ignore[method-assign]
        await scan_mod.request_auto_scan(workspace.id, [doc_a.id])

        full = asyncio.create_task(scan_mod.run_scan(workspace.id))
        await asyncio.sleep(0.05)
        gate.set()
        scan_id = await full

        assert (await _scan_row(test_db, scan_id)).status == "done"


@pytest.mark.asyncio
async def test_conflict_counts_counts_open_contradictions_per_chunk(seeded, test_db):
    from app.radar import conflict_counts

    workspace, doc_a, doc_b, _user = seeded

    def contradiction(key: str, a: str, b: str, status: str = "open") -> Contradiction:
        return Contradiction(
            workspace_id=workspace.id, pair_key=key, doc_a_id=doc_a.id, chunk_a_id=a, sentence_a="x",
            doc_b_id=doc_b.id, chunk_b_id=b, sentence_b="y", score=0.9, similarity=0.8, status=status,
        )

    test_db.add_all([
        contradiction("k1", "c1", "c2"),
        contradiction("k2", "c1", "c3"),
        contradiction("k3", "c2", "c3", status="dismissed"),
    ])
    await test_db.commit()

    counts = await conflict_counts(test_db, ["c1", "c2", "c3", "c4"])

    assert counts == {"c1": 2, "c2": 1, "c3": 1}
    assert await conflict_counts(test_db, []) == {}


def test_sentences_drop_headings_and_keep_terminated_sentences():
    """Real-model run: two document titles ("…Annual Report 2025" vs "Q4 2025 Press Release") scored contradiction 0.997."""
    from app.radar.scan import _sentences

    text = (
        "Northwind Renewables Annual Report 2025\n\n"
        "## Financial Highlights\n\n"
        f"{REVENUE_A} {STAFF}\n"
        "- Aurora commissioning is planned for Q3 2027.\n"
        "Too short. "
        "a trailing fragment cut off by the chunk boundary without an end"
    )

    assert _sentences(text) == [REVENUE_A, STAFF, "Aurora commissioning is planned for Q3 2027."]


def test_sentences_break_at_heading_lines_and_rejoin_soft_wrapped_prose():
    """Real demo seed: a heading line with no blank line after it was glued onto the claim
    ("Aurora Project Update Aurora is expected to commission in the third quarter of 2...")."""
    from app.radar.scan import _sentences

    text = (
        "Aurora Project Update\n"
        "Aurora is expected to commission in the third quarter of 2027. The project remains\n"
        "600 MW of contracted capacity backed by a 20-year power\n"
        "purchase agreement.\n"
        "**Dana Whitfield — Chief Executive Officer**\n"
        "Dana Whitfield became Chief Executive Officer in January 2022."
    )

    assert _sentences(text) == [
        "Aurora is expected to commission in the third quarter of 2027.",
        "The project remains 600 MW of contracted capacity backed by a 20-year power purchase agreement.",
        "Dana Whitfield became Chief Executive Officer in January 2022.",
    ]


def test_sentences_rejoin_a_wrap_after_a_lowercase_word_or_comma():
    """Hard-wrapped markdown (leadership page) left fragments like "€2 billion of renewable
    energy transactions." when the next line opened with a capital or a currency sign."""
    from app.radar.scan import _sentences

    text = (
        "Marcus joined in 2020 from a fund, where he led over\n"
        "€2 billion of renewable energy transactions. Before joining\n"
        "Northwind Renewables, Dana spent eleven years at a developer.\n"
        "Executive Committee\n"
        "Dana Whitfield became Chief Executive Officer in January 2022."
    )

    assert _sentences(text) == [
        "Marcus joined in 2020 from a fund, where he led over €2 billion of renewable energy transactions.",
        "Before joining Northwind Renewables, Dana spent eleven years at a developer.",
        "Dana Whitfield became Chief Executive Officer in January 2022.",
    ]


def test_sentences_strip_markdown_emphasis():
    from app.radar.scan import _sentences

    text = "Total project capital expenditure is now estimated at **€1.1 billion**, up from __€980 million__."

    assert _sentences(text) == [
        "Total project capital expenditure is now estimated at €1.1 billion, up from €980 million."
    ]


def test_sentences_drop_table_rows_and_short_fragments():
    """Real demo seed: "2020 −34% −27% −7 pts Revenue growth was driven by…" reached NLI as a sentence."""
    from app.radar.scan import _sentences

    text = (
        "Emissions intensity vs. 2020 −34% −27% −7 pts.\n\n"
        "Fabrication yard capacity.\n\n"
        "Revenue was €398 million."
    )

    assert _sentences(text) == ["Revenue was €398 million."]


@pytest.mark.parametrize(
    ("a", "b", "same"),
    [
        ("Revenue in 2025 was €412 million.", "Revenue in 2025 was €398 million.", True),
        ("Emissions intensity was 34% below the 2020 baseline.",
         "Emissions intensity was 41% below the 2020 baseline.", True),
        ("Aurora is expected to commission in the third quarter of 2027.",
         "Aurora is now expected to commission in the first quarter of 2028.", True),
        ("Dana Whitfield became Chief Executive Officer in March 2021.",
         "Dana Whitfield became Chief Executive Officer in January 2022.", True),
        # Real demo false positives (NLI 0.96-0.999): related topic, different quantity.
        ("Group capital expenditure guidance for 2026 is €640–680M, weighted toward Aurora "
         "construction and the Fjellheim repowering programme.",
         "Total project capital expenditure is now estimated at €1.1 billion, compared with the "
         "€980 million sanctioned at final investment decision in 2023.", False),
        ("This was driven by the retirement of two older gas-backed balancing contracts and a full "
         "year of operation from the Kestrel Ridge onshore wind expansion.",
         "Onshore wind generation was broadly flat year over year on a same-asset basis, with growth "
         "coming entirely from the Kestrel Ridge expansion, which contributed a full twelve months of "
         "output in 2025 versus roughly nine months in 2024.", False),
        # BUG-16: a short, freshly-uploaded note sentence conflicting with a fact buried inside a
        # long compound sentence — real-model repro (see radar_repro notes) showed this pair
        # clears MIN_SENTENCE_SIMILARITY (cosine 0.60) but Jaccard subject-overlap was only 0.125
        # (union diluted by the long sentence's unrelated clauses), so it never reached NLI.
        ("Revenue growth was driven by a full year of contribution from the Kestrel Ridge onshore "
         "expansion (commissioned March 2024) and higher merchant power prices in our Nordic solar "
         "assets during the second and third quarters.",
         "Kestrel Ridge was commissioned in November 2024, later than the original schedule.", True),
    ],
)
def test_same_subject_keeps_numeric_conflicts_and_rejects_different_quantities(a, b, same):
    from app.radar.scan import _same_subject

    assert _same_subject(a, b) is same
    assert _same_subject(b, a) is same


# ─── BUG-16: core-clause NLI retry ────────────────────────────────────
#
# Real-model repro (QA2's exact planted-conflict note, cross-encoder/
# nli-deberta-v3-base) found both "closed the year 2025 with 1,580
# employees" vs "...1,240 employees, a net addition of 94 roles, almost all
# of them in project engineering..." and the Kestrel Ridge commissioning-date
# pair cleared neighbour-k, sentence similarity and _same_subject, then
# failed at NLI: the long/compound corpus sentence scored contradiction
# ~0.98-0.9998 as the *premise* against the short claim as hypothesis, but
# neutral (~0.99) in the reverse direction -- so min(both directions) never
# reached RADAR_MIN_CONTRADICTION. Retrying with each sentence's core clause
# (dropping a trailing " and ..."/parenthetical clause) recovered >=0.93 both
# ways for every genuine pair tested, while the existing one-directional
# false positive (CEO quote vs "became CEO in March 2021") -- which has no
# such clause to trim -- stayed correctly unflagged either way.


@pytest.mark.parametrize(
    ("sentence", "expected"),
    [
        (
            "Revenue growth was driven by a full year of contribution from the Kestrel Ridge "
            "onshore expansion (commissioned March 2024) and higher merchant power prices in "
            "our Nordic solar assets during the second and third quarters.",
            "Revenue growth was driven by a full year of contribution from the Kestrel Ridge "
            "onshore expansion (commissioned March 2024) and.",
        ),
        (
            "We closed the year with 1,240 employees, a net addition of 94 roles, almost "
            "all of them in project engineering and operations.",
            "We closed the year with 1,240 employees.",
        ),
        # Short, no clause-boundary marker: nothing to trim.
        ("The Kestrel Ridge onshore wind expansion was commissioned in November 2024.", None),
        # Below the minimum word floor even though it has a comma.
        ("Revenue, up sharply.", None),
    ],
)
def test_truncate_to_core_clause(sentence, expected):
    from app.radar.scan import _truncate_to_core_clause

    assert _truncate_to_core_clause(sentence) == expected


def test_score_pairs_retries_with_core_clause_when_full_sentence_nli_is_asymmetric(monkeypatch):
    """The exact QA2 Kestrel Ridge pair: full-sentence NLI is one-directional
    (confused), the core-clause retry is confident both ways."""
    from app.radar import scan as scan_mod
    from app.radar.scan import _Chunk, _score_pairs

    short = "The Kestrel Ridge onshore wind expansion was commissioned in November 2024."
    long = (
        "Revenue growth was driven by a full year of contribution from the Kestrel Ridge "
        "onshore expansion (commissioned March 2024) and higher merchant power prices in "
        "our Nordic solar assets during the second and third quarters."
    )
    chunk_a = _Chunk("chunk-a", "doc-a", short)
    chunk_b = _Chunk("chunk-b", "doc-b", long)

    monkeypatch.setattr(scan_mod, "_embed_sentences", lambda sentences: np.array([unit(1, 1) for _ in sentences]))

    calls: list[list[tuple[str, str]]] = []

    def fake_nli(pairs):
        calls.append(list(pairs))
        return [
            (0.02, 0.9, 0.08) if premise == long or hypothesis == long else (0.01, 0.02, 0.97)
            for premise, hypothesis in pairs
        ]

    monkeypatch.setattr(scan_mod, "nli_batch", fake_nli)

    findings = _score_pairs([(0.9, chunk_a, chunk_b)], {})

    assert len(findings) == 1
    assert {findings[0].sentence_a, findings[0].sentence_b} == {short, long}
    # First attempt (full sentences) then the core-clause retry.
    assert len(calls) == 2


def test_score_pairs_retry_does_not_flag_a_pair_that_is_confused_even_truncated(monkeypatch):
    """A pair that's genuinely not a conflict must not be flagged just
    because a retry was attempted -- the retry still requires both NLI
    directions to agree, same as the first attempt."""
    from app.radar import scan as scan_mod
    from app.radar.scan import _Chunk, _score_pairs

    short = "The Kestrel Ridge onshore wind expansion was commissioned in November 2024."
    long = (
        "Revenue growth was driven by a full year of contribution from the Kestrel Ridge "
        "onshore expansion (commissioned March 2024) and higher merchant power prices in "
        "our Nordic solar assets during the second and third quarters."
    )
    chunk_a = _Chunk("chunk-a", "doc-a", short)
    chunk_b = _Chunk("chunk-b", "doc-b", long)

    monkeypatch.setattr(scan_mod, "_embed_sentences", lambda sentences: np.array([unit(1, 1) for _ in sentences]))
    monkeypatch.setattr(scan_mod, "nli_batch", lambda pairs: [(0.05, 0.9, 0.05) for _ in pairs])

    findings = _score_pairs([(0.9, chunk_a, chunk_b)], {})

    assert findings == []


@pytest.mark.asyncio
async def test_one_directional_contradiction_is_not_a_finding(seeded, radar, test_db):
    """Real demo seed: '"2025 was a year of steady execution," said Dana Whitfield, Chief Executive
    Officer.' vs 'Dana Whitfield became Chief Executive Officer in March 2021.' scored contradiction
    0.977 one way and 0.001 the other. Every planted conflict scored >= 0.998 both ways."""
    from app.radar.scan import run_scan

    workspace, doc_a, doc_b, _user = seeded

    def one_way(pairs):
        return [(0.01, 0.02, 0.97) if premise == REVENUE_A else (0.01, 0.98, 0.01) for premise, _ in pairs]

    radar([
        _record(doc_a, 0, REVENUE_A, unit(1, 0, 0)),
        _record(doc_b, 0, REVENUE_B, unit(1, 0, 0)),
    ], nli=one_way)

    await run_scan(workspace.id)

    assert await _rows(test_db, workspace.id) == []


@pytest.mark.asyncio
async def test_different_subject_sentences_are_not_sent_to_nli(seeded, radar, test_db):
    from app.radar.scan import run_scan

    workspace, doc_a, doc_b, _user = seeded
    _collection, nli = radar([
        _record(doc_a, 0, "Group revenue guidance for 2026 is €640 million, weighted toward construction.", unit(1, 0, 0)),
        _record(doc_b, 0, "Project revenue is now estimated at €1.1 billion after the schedule slip.", unit(1, 0, 0)),
    ])

    await run_scan(workspace.id)

    assert nli.calls == []


@pytest.mark.asyncio
async def test_loosely_related_sentences_are_not_sent_to_nli(seeded, radar, test_db, monkeypatch):
    """Real-model eval: an unrelated CEO sentence (cosine 0.56) drew NLI contradiction 0.99; true conflicts sat >= 0.65."""
    from app.radar import scan as scan_mod

    workspace, doc_a, doc_b, _user = seeded
    _collection, nli = radar([
        _record(doc_a, 0, "Dana Whitfield has served as Chief Executive Officer since March 2021.", unit(1, 0, 0)),
        _record(doc_b, 0, "The CEO presented the strategy to investors in November.", unit(1, 0, 0)),
    ])
    vectors = np.array([unit(1, 0), unit(0.56, (1 - 0.56 ** 2) ** 0.5)], dtype=np.float32)
    monkeypatch.setattr(scan_mod, "_embed_sentences", lambda sentences: vectors[: len(sentences)])

    await scan_mod.run_scan(workspace.id)

    assert nli.calls == []
