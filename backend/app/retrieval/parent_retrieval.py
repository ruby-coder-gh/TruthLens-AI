"""Parent-document retrieval: expand matched chunks with surrounding context.

When a small chunk matches a query, this module retrieves the sibling chunks
around it (the "parent document context") so the LLM has more context.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from app.database import async_session_factory
from app.models.chunk import Chunk
from app.retrieval.hybrid_search import RetrievalResult
from app.retrieval.reranker import RerankedResult
from app.utils.logger import logger


def _build_sibling_result(
    chunk: Chunk,
    workspace_id: str,
) -> RerankedResult:
    """Build a RerankedResult for a sibling chunk (zero scores)."""
    return RerankedResult(
        chunk_id=chunk.id,
        document_id=chunk.document_id,
        workspace_id=workspace_id,
        content=chunk.content,
        score=0.0,
        vector_score=0.0,
        bm25_score=0.0,
        rerank_score=0.0,
        final_score=0.0,
        metadata={"chunk_index": chunk.index, "is_parent_context": True},
    )


def _copy_result(
    orig: RetrievalResult,
    workspace_id: str,
    index: int | None = None,
) -> RerankedResult:
    """Copy a RetrievalResult into a RerankedResult, preserving scores."""
    metadata = dict(orig.metadata)
    if index is not None:
        metadata["chunk_index"] = index
    return RerankedResult(
        chunk_id=orig.chunk_id,
        document_id=orig.document_id,
        workspace_id=workspace_id,
        content=orig.content,
        score=orig.score,
        vector_score=orig.vector_score,
        bm25_score=orig.bm25_score,
        rerank_score=getattr(orig, "rerank_score", 0.0),
        final_score=getattr(orig, "final_score", orig.score),
        metadata=metadata,
    )


async def expand_with_parent(
    chunks: list[RetrievalResult],
    workspace_id: str,
    window_size: int = 1,
) -> list[RerankedResult]:
    """Expand matched chunks with surrounding sibling chunks.

    For each matched chunk, looks up sibling chunks in the same document
    with an index within ±window_size and inserts them adjacent to the match.
    Deduplicates by chunk_id and preserves the original ordering of matched chunks.

    Args:
        chunks: List of matched RetrievalResult objects.
        workspace_id: Workspace ID (for logging and constructing results).
        window_size: Number of sibling chunks on each side (default 1).
                     Set to 0 to disable expansion.

    Returns:
        Expanded list of RerankedResult with parent context inserted.
    """
    if not chunks or window_size < 1:
        return [_copy_result(r, workspace_id) for r in chunks]

    # ── 1. Resolve chunk_index for every input chunk ──────────────────
    # Try metadata first, fall back to DB query
    needs_db_lookup: list[str] = []
    for r in chunks:
        idx = r.metadata.get("chunk_index")
        if idx is None:
            needs_db_lookup.append(r.chunk_id)

    db_chunk_map: dict[str, Chunk] = {}
    if needs_db_lookup:
        async with async_session_factory() as session:
            stmt = select(Chunk).where(Chunk.id.in_(needs_db_lookup))
            result = await session.execute(stmt)
            for c in result.scalars().all():
                db_chunk_map[c.id] = c

    # Build (chunk_id, doc_id, index, original) tuples in order
    chunk_order: list[tuple[str, str, int | None, RetrievalResult]] = []
    for r in chunks:
        idx = r.metadata.get("chunk_index")
        if idx is None and r.chunk_id in db_chunk_map:
            idx = db_chunk_map[r.chunk_id].index
        chunk_order.append((r.chunk_id, r.document_id, idx, r))

    # ── 2. Collect all sibling coordinates needed ────────────────────
    # doc_id -> set of indices to fetch
    needed_indices: dict[str, set[int]] = {}
    for _chunk_id, doc_id, idx, _orig in chunk_order:
        if idx is None:
            continue
        if doc_id not in needed_indices:
            needed_indices[doc_id] = set()
        for offset in range(-window_size, window_size + 1):
            needed_indices[doc_id].add(idx + offset)

    # ── 3. Query all siblings from DB ────────────────────────────────
    sibling_lookup: dict[tuple[str, int], Chunk] = {}
    if needed_indices:
        async with async_session_factory() as session:
            for doc_id, indices in needed_indices.items():
                stmt = (
                    select(Chunk)
                    .where(Chunk.document_id == doc_id)
                    .where(Chunk.index.in_(list(indices)))
                    .order_by(Chunk.index)
                )
                result = await session.execute(stmt)
                for c in result.scalars().all():
                    sibling_lookup[(c.document_id, c.index)] = c

    # ── 4. Build expanded output preserving order ────────────────────
    seen: set[str] = set()
    expanded: list[RerankedResult] = []

    for chunk_id, doc_id, idx, orig in chunk_order:
        if idx is None:
            # Can't find index — include as-is
            if chunk_id not in seen:
                expanded.append(_copy_result(orig, workspace_id))
                seen.add(chunk_id)
            continue

        # Before siblings (negative offsets, ascending order)
        for offset in range(-window_size, 0):
            sib = sibling_lookup.get((doc_id, idx + offset))
            if sib is not None and sib.id not in seen:
                expanded.append(_build_sibling_result(sib, workspace_id))
                seen.add(sib.id)

        # Matched chunk itself
        if chunk_id not in seen:
            expanded.append(_copy_result(orig, workspace_id, index=idx))
            seen.add(chunk_id)

        # After siblings (positive offsets, ascending order)
        for offset in range(1, window_size + 1):
            sib = sibling_lookup.get((doc_id, idx + offset))
            if sib is not None and sib.id not in seen:
                expanded.append(_build_sibling_result(sib, workspace_id))
                seen.add(sib.id)

    logger.info(
        "expand_with_parent_complete",
        input_count=len(chunks),
        output_count=len(expanded),
        workspace_id=workspace_id,
    )

    return expanded
