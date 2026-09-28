"""Contradiction Radar — owned by lane L5."""

from __future__ import annotations

from collections import Counter

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contradiction import Contradiction


async def conflict_counts(session: AsyncSession, chunk_ids: list[str]) -> dict[str, int]:
    """Open contradictions touching each chunk, in one query. Chunks with none are omitted."""
    wanted = set(chunk_ids)
    if not wanted:
        return {}
    rows = await session.execute(
        select(Contradiction.chunk_a_id, Contradiction.chunk_b_id).where(
            Contradiction.status == "open",
            or_(Contradiction.chunk_a_id.in_(wanted), Contradiction.chunk_b_id.in_(wanted)),
        )
    )
    counts: Counter[str] = Counter()
    for chunk_a, chunk_b in rows:
        counts.update(c for c in (chunk_a, chunk_b) if c in wanted)
    return dict(counts)
