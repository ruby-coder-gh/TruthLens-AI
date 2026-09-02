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

    test_db.add(GoldenEntryRow(question="q", reference_answer="a", category="unanswerable"))
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

    test_db.add(GoldenEntryRow(question="q1", reference_answer="a1"))
    await test_db.commit()
    after_first = await golden_set_version(test_db)

    test_db.add(GoldenEntryRow(question="q2", reference_answer="a2"))
    await test_db.commit()
    after_second = await golden_set_version(test_db)

    assert len({baseline, after_first, after_second}) == 3
    assert len(after_first) == 12


@pytest.mark.asyncio
async def test_golden_set_version_is_stable_for_the_same_promotions(test_db: AsyncSession):
    """Version is a pure function of (builtin file, promoted ids) — not of row order."""
    from app.evaluation.golden_store import golden_set_version

    test_db.add_all([
        GoldenEntryRow(question="q1", reference_answer="a1"),
        GoldenEntryRow(question="q2", reference_answer="a2"),
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
