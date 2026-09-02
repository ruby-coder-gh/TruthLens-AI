"""Golden set loader: the builtin dataset plus reviewer-promoted entries.

The builtin golden set is a hard-coded list in ``evaluation/golden_dataset.py``.
Reviewers promote corrected answers out of the review queue into the
``golden_entries`` table; this module is the single place that merges the two so
an eval run sees both.

``evaluation/evaluate.py``'s CLI and ``tests/test_evaluation/test_golden_regression.py``
deliberately keep the builtin-only path: CI must stay deterministic and
independent of whatever a reviewer promoted last week.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.golden_entry import GoldenEntry as GoldenEntryRow
from evaluation.golden_dataset import GoldenEntry, get_golden_dataset

_VERSION_HASH_LENGTH = 12

# Memoized SHA-1 state for the builtin dataset file, keyed by (path, mtime_ns).
# golden_set_version() is called from async request handlers; re-reading and
# hashing the ~60 KB module on every call is pure waste, and the file only
# changes when someone edits the source. Hash objects are copied out so callers
# can keep updating them with the promoted ids.
_builtin_digest_cache: dict[tuple[str, int], Any] = {}
_MAX_CACHED_DIGESTS = 4


def _builtin_dataset_path() -> Path:
    """Path to the hard-coded dataset module (``backend/evaluation/golden_dataset.py``)."""
    return Path(__file__).resolve().parents[2] / "evaluation" / "golden_dataset.py"


def _builtin_digest() -> Any:
    """A fresh SHA-1 hash object preloaded with the builtin dataset file bytes."""
    path = _builtin_dataset_path()
    key = (str(path), path.stat().st_mtime_ns)
    digest = _builtin_digest_cache.get(key)
    if digest is None:
        if len(_builtin_digest_cache) >= _MAX_CACHED_DIGESTS:
            # Only grows when the file is edited (dev/tests); never unbounded.
            _builtin_digest_cache.clear()
        digest = hashlib.sha1(path.read_bytes())
        _builtin_digest_cache[key] = digest
    return digest.copy()


def _to_golden_entry(row: GoldenEntryRow) -> GoldenEntry:
    """Convert a promoted DB row into the dataclass the eval runner consumes.

    The ``[promoted:<id>]`` note prefix mirrors the ``[gd-NNN]`` ids the builtin
    dataset assigns, so per-entry eval results stay traceable to their origin.
    """
    marker = f"[promoted:{row.id}]"
    notes = f"{marker} {row.notes}".strip() if row.notes else marker
    return GoldenEntry(
        question=row.question,
        reference_answer=row.reference_answer,
        source_documents=list(row.source_documents or []),
        expected_grounding=bool(row.expected_grounding),
        category=row.category,
        difficulty=row.difficulty,
        notes=notes,
    )


async def load_promoted_entries(db: AsyncSession) -> list[GoldenEntryRow]:
    """Return promoted golden rows in stable creation order."""
    result = await db.execute(
        select(GoldenEntryRow).order_by(GoldenEntryRow.created_at.asc(), GoldenEntryRow.id.asc())
    )
    return list(result.scalars().all())


async def load_golden_entries(db: AsyncSession) -> list[GoldenEntry]:
    """Builtin golden entries followed by every promoted entry.

    Returns a new list; ``get_golden_dataset()`` hands back the module-level
    list, so appending to it in place would corrupt the builtin set for the rest
    of the process.
    """
    promoted = await load_promoted_entries(db)
    return [*get_golden_dataset(), *(_to_golden_entry(row) for row in promoted)]


async def golden_set_version(db: AsyncSession) -> str:
    """Short content hash over (builtin dataset file, promoted entry ids).

    With an empty ``golden_entries`` table this is byte-identical to
    ``evaluation.evaluate._golden_set_version()``, so historical EvalRun rows
    stay comparable. Every promotion or deletion changes it.
    """
    digest = _builtin_digest()
    result = await db.execute(select(GoldenEntryRow.id))
    promoted_ids = sorted(result.scalars().all())
    if promoted_ids:
        digest.update("|".join(promoted_ids).encode("utf-8"))
    return digest.hexdigest()[:_VERSION_HASH_LENGTH]


async def golden_counts(db: AsyncSession) -> dict[str, int]:
    """Builtin / promoted / total entry counts for the admin analytics eval tab."""
    builtin = len(get_golden_dataset())
    promoted = (await db.execute(select(func.count(GoldenEntryRow.id)))).scalar() or 0
    return {"builtin": builtin, "promoted": int(promoted), "total": builtin + int(promoted)}
