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
