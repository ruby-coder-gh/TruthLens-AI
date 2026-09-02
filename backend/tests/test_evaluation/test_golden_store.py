"""Golden-set loader: builtin dataset merged with reviewer-promoted entries."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.golden_entry import GoldenEntry as GoldenEntryRow


def _builtin_count() -> int:
    from evaluation.golden_dataset import get_golden_dataset

    return len(get_golden_dataset())


@pytest.mark.asyncio
async def test_load_golden_entries_returns_builtin_only_when_nothing_promoted(test_db: AsyncSession):
    """With an empty golden_entries table the loader is the builtin dataset."""
    from app.evaluation.golden_store import load_golden_entries

    entries = await load_golden_entries(test_db)

    assert len(entries) == _builtin_count()


@pytest.mark.asyncio
async def test_load_golden_entries_appends_promoted_rows_tagged_with_their_id(test_db: AsyncSession):
    """A promoted row is converted to a GoldenEntry and tagged ``[promoted:<id>]``."""
    from evaluation.golden_dataset import GoldenEntry
    from app.evaluation.golden_store import load_golden_entries

    row = GoldenEntryRow(
        question="What is the escalation path for a Sev-1?",
        reference_answer="Page the on-call SRE, then notify the incident commander.",
        source_documents=["runbook.md"],
        expected_grounding=True,
        category="answerable",
        difficulty=2,
        notes="from review queue",
        status="approved",
    )
    test_db.add(row)
    await test_db.commit()
    await test_db.refresh(row)

    entries = await load_golden_entries(test_db)

    assert len(entries) == _builtin_count() + 1
    promoted = entries[-1]
    assert isinstance(promoted, GoldenEntry)
    assert promoted.question == "What is the escalation path for a Sev-1?"
    assert promoted.source_documents == ["runbook.md"]
    assert promoted.difficulty == 2
    assert promoted.notes.startswith(f"[promoted:{row.id}]")
    assert "from review queue" in promoted.notes


@pytest.mark.asyncio
async def test_load_golden_entries_does_not_mutate_the_builtin_dataset(test_db: AsyncSession):
    """The loader must copy, never append onto the module-level GOLDEN_DATASET."""
    from evaluation.golden_dataset import get_golden_dataset
    from app.evaluation.golden_store import load_golden_entries

    test_db.add(GoldenEntryRow(question="q", reference_answer="a", category="unanswerable", status="approved"))
    await test_db.commit()

    before = len(get_golden_dataset())
    await load_golden_entries(test_db)
    await load_golden_entries(test_db)

    assert len(get_golden_dataset()) == before


@pytest.mark.asyncio
async def test_golden_set_version_equals_builtin_file_hash_when_no_promotions(test_db: AsyncSession):
    """Empty table => identical to evaluate.py's builtin-only hash (CI determinism)."""
    from evaluation.evaluate import _golden_set_version
    from app.evaluation.golden_store import golden_set_version

    assert await golden_set_version(test_db) == _golden_set_version()


@pytest.mark.asyncio
async def test_golden_set_version_changes_on_every_promotion(test_db: AsyncSession):
    """Promoting an entry bumps the version so EvalRun rows are comparable."""
    from app.evaluation.golden_store import golden_set_version

    baseline = await golden_set_version(test_db)

    test_db.add(GoldenEntryRow(question="q1", reference_answer="a1", status="approved"))
    await test_db.commit()
    after_first = await golden_set_version(test_db)

    test_db.add(GoldenEntryRow(question="q2", reference_answer="a2", status="approved"))
    await test_db.commit()
    after_second = await golden_set_version(test_db)

    assert len({baseline, after_first, after_second}) == 3
    assert len(after_first) == 12


@pytest.mark.asyncio
async def test_golden_set_version_is_stable_for_the_same_promotions(test_db: AsyncSession):
    """Version is a pure function of (builtin file, promoted ids) — not of row order."""
    from app.evaluation.golden_store import golden_set_version

    test_db.add_all([
        GoldenEntryRow(question="q1", reference_answer="a1", status="approved"),
        GoldenEntryRow(question="q2", reference_answer="a2", status="approved"),
    ])
    await test_db.commit()

    assert await golden_set_version(test_db) == await golden_set_version(test_db)


@pytest.mark.asyncio
async def test_golden_counts_reports_builtin_and_promoted_totals(test_db: AsyncSession):
    """Admin analytics needs builtin/promoted counts alongside the version."""
    from app.evaluation.golden_store import golden_counts

    test_db.add(GoldenEntryRow(question="q1", reference_answer="a1"))
    await test_db.commit()

    counts = await golden_counts(test_db)

    assert counts == {"builtin": _builtin_count(), "promoted": 1, "total": _builtin_count() + 1}


# ─── Fix round 1: builtin-hash memoization ───────────────────────────


@pytest.mark.asyncio
async def test_builtin_dataset_file_is_hashed_once_per_mtime(test_db: AsyncSession, monkeypatch):
    """golden_set_version() runs inside async request handlers; re-reading and
    SHA-1'ing the ~60 KB dataset file on every call is pure waste."""
    from pathlib import Path

    from app.evaluation import golden_store

    golden_store._builtin_digest_cache.clear()
    reads: list[str] = []
    original_read_bytes = Path.read_bytes

    def counting_read_bytes(self):
        reads.append(str(self))
        return original_read_bytes(self)

    monkeypatch.setattr(Path, "read_bytes", counting_read_bytes)

    first = await golden_store.golden_set_version(test_db)
    second = await golden_store.golden_set_version(test_db)
    await golden_store.golden_set_version(test_db)

    assert first == second
    assert len([r for r in reads if r.endswith("golden_dataset.py")]) == 1


@pytest.mark.asyncio
async def test_editing_the_dataset_file_invalidates_the_memoized_hash(test_db: AsyncSession, monkeypatch):
    """The cache key includes mtime_ns, so an edited dataset re-hashes."""
    from app.evaluation import golden_store

    golden_store._builtin_digest_cache.clear()
    real_path = golden_store._builtin_dataset_path()
    baseline = await golden_store.golden_set_version(test_db)

    class _FakeStat:
        st_mtime_ns = 1

    original_stat = type(real_path).stat
    monkeypatch.setattr(type(real_path), "stat", lambda self, **kw: _FakeStat() if self == real_path else original_stat(self, **kw))
    monkeypatch.setattr(type(real_path), "read_bytes", lambda self: b"edited dataset")

    assert await golden_store.golden_set_version(test_db) != baseline
    golden_store._builtin_digest_cache.clear()


# ─── SEC-1: only admin-approved promotions reach an eval run ─────────


@pytest.mark.asyncio
async def test_pending_entries_are_never_loaded_for_evaluation(test_db: AsyncSession):
    """A `pending` row is inert: not loaded, and it does not move the version."""
    from app.evaluation.golden_store import (
        golden_set_version,
        load_golden_entries,
        load_promoted_entries,
    )

    baseline = await golden_set_version(test_db)
    test_db.add(GoldenEntryRow(question="unapproved?", reference_answer="a", status="pending"))
    await test_db.commit()

    assert await load_promoted_entries(test_db) == []
    assert len(await load_golden_entries(test_db)) == _builtin_count()
    assert await golden_set_version(test_db) == baseline


@pytest.mark.asyncio
async def test_only_approved_rows_are_hashed_into_the_version(test_db: AsyncSession):
    """Two rows, one approved: the version equals the approved-only version."""
    from app.evaluation.golden_store import golden_set_version

    test_db.add(GoldenEntryRow(question="approved?", reference_answer="a", status="approved"))
    await test_db.commit()
    approved_only = await golden_set_version(test_db)

    test_db.add(GoldenEntryRow(question="pending?", reference_answer="b", status="pending"))
    await test_db.commit()

    assert await golden_set_version(test_db) == approved_only


@pytest.mark.asyncio
async def test_list_promoted_entries_shows_pending_rows_for_the_admin_surface(test_db: AsyncSession):
    """Admins must be able to *see* pending rows in order to approve them."""
    from app.evaluation.golden_store import list_promoted_entries

    test_db.add_all([
        GoldenEntryRow(question="p?", reference_answer="a", status="pending"),
        GoldenEntryRow(question="a?", reference_answer="b", status="approved"),
    ])
    await test_db.commit()

    assert {row.question for row in await list_promoted_entries(test_db)} == {"p?", "a?"}
    assert [row.question for row in await list_promoted_entries(test_db, status="pending")] == ["p?"]
    assert [row.question for row in await list_promoted_entries(test_db, status="approved")] == ["a?"]
