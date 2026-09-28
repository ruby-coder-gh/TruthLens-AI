"""Contradiction Radar — owned by lane L5."""

from __future__ import annotations

import asyncio
from collections import Counter
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.chroma_client import get_workspace_collection
from app.models.contradiction import Contradiction
from app.models.document import Document
from app.utils.logger import logger


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


def _page_numbers_sync(workspace_id: str, chunk_ids: list[str]) -> dict[str, int]:
    got = get_workspace_collection(workspace_id).get(where={"chunk_id": {"$in": chunk_ids}}, include=["metadatas"])
    pages: dict[str, int] = {}
    for meta in got["metadatas"]:
        if meta and meta.get("chunk_id") and isinstance(meta.get("page_number"), int):
            pages[str(meta["chunk_id"])] = meta["page_number"]
    return pages


async def open_conflicts_for_chunks(
    session: AsyncSession, workspace_id: str, chunk_ids: list[str]
) -> list[dict[str, Any]]:
    """Open Radar contradictions touching any of `chunk_ids` (K5).

    Shapes each row as `{a: {document_name, page_number, sentence}, b: {...},
    score}` for the Truth Receipt payload's `conflicts` field — the caller
    (`create_receipt`) resolves this for the answer's cited chunks before
    calling `build_payload`. A page-lookup hiccup (Chroma) must never break
    sealing, so it's swallowed like `api.radar._page_numbers`.
    """
    wanted = set(chunk_ids)
    if not wanted:
        return []
    rows = (
        await session.execute(
            select(Contradiction).where(
                Contradiction.status == "open",
                or_(Contradiction.chunk_a_id.in_(wanted), Contradiction.chunk_b_id.in_(wanted)),
            )
        )
    ).scalars().all()
    if not rows:
        return []

    doc_ids = {r.doc_a_id for r in rows} | {r.doc_b_id for r in rows}
    names = dict(
        (await session.execute(
            select(Document.id, Document.original_filename).where(Document.id.in_(doc_ids))
        )).all()
    )
    needed_chunk_ids = sorted({r.chunk_a_id for r in rows} | {r.chunk_b_id for r in rows})
    try:
        pages = await asyncio.to_thread(_page_numbers_sync, workspace_id, needed_chunk_ids)
    except Exception as e:
        logger.warning("receipt_conflict_page_lookup_failed", workspace_id=workspace_id, error=str(e))
        pages = {}

    def side(doc_id: str, chunk_id: str, sentence: str) -> dict[str, Any]:
        return {"document_name": names.get(doc_id, ""), "page_number": pages.get(chunk_id), "sentence": sentence}

    return [
        {
            "a": side(r.doc_a_id, r.chunk_a_id, r.sentence_a),
            "b": side(r.doc_b_id, r.chunk_b_id, r.sentence_b),
            "score": r.score,
        }
        for r in rows
    ]
