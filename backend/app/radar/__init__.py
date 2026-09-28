"""Contradiction Radar — owned by lane L5."""

from __future__ import annotations

import asyncio
import re
from collections import Counter
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.chroma_client import get_workspace_collection
from app.models.contradiction import Contradiction
from app.models.document import Document
from app.utils.logger import logger

_NUMBER_RE = re.compile(r"(?<![A-Za-z])\d+(?:[.,]\d+)*")
_SOURCE_MARKER_RE = re.compile(r"\[source:(\d+)\]")


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


async def _shape_conflict_rows(
    session: AsyncSession, workspace_id: str, rows: list[Contradiction]
) -> list[dict[str, Any]]:
    """Resolve document names + chunk page numbers and shape rows as
    `{a: {document_name, page_number, sentence}, b: {...}, score}`. A
    page-lookup hiccup (Chroma) must never break the caller, so it's
    swallowed like `api.radar._page_numbers`."""
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


async def open_conflicts_for_chunks(
    session: AsyncSession, workspace_id: str, chunk_ids: list[str]
) -> list[dict[str, Any]]:
    """Open Radar contradictions touching any of `chunk_ids` (K5).

    Shapes each row as `{a: {document_name, page_number, sentence}, b: {...},
    score}` for the Truth Receipt payload's `conflicts` field — the caller
    (`create_receipt`) resolves this for the answer's cited chunks before
    calling `build_payload`.
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
    return await _shape_conflict_rows(session, workspace_id, rows)


async def open_conflicts_for_workspace(
    session: AsyncSession, workspace_id: str, document_ids: set[str] | None = None
) -> list[dict[str, Any]]:
    """Open Radar contradictions for the workspace (R2-7).

    Document-level, not chunk-level: a contradiction is included as long as
    either side's *document* -- not necessarily the exact chunk a sub-question
    retrieved -- is in `document_ids`. `None` (the default) returns every open
    contradiction in the workspace; an empty set returns none. Used by
    investigation synthesis, which wants the full picture for "identify
    conflicts" questions rather than only the chunks one sub-question
    happened to retrieve.
    """
    if document_ids is not None and not document_ids:
        return []
    stmt = select(Contradiction).where(
        Contradiction.workspace_id == workspace_id, Contradiction.status == "open"
    )
    if document_ids is not None:
        stmt = stmt.where(or_(Contradiction.doc_a_id.in_(document_ids), Contradiction.doc_b_id.in_(document_ids)))
    rows = (await session.execute(stmt)).scalars().all()
    return await _shape_conflict_rows(session, workspace_id, rows)


def _numbers(text: str) -> set[str]:
    return set(_NUMBER_RE.findall(text))


async def append_missing_disagreement_figures(
    session: AsyncSession, workspace_id: str, answer: str, contexts: list[dict[str, Any]]
) -> str:
    """BUG-24 cheap post-check: an answer can cite both sides of an open Radar
    pair and still only state one side's number, silently picking a side
    despite the disagreement prompt instruction. If so, append the missing
    side's sentence with its own `[source:N]` citation.

    `workspace_id` is accepted (not used to filter the query -- chunk ids are
    already workspace-scoped via the caller's retrieval) for symmetry with
    `open_conflicts_for_chunks` and to keep the call site uniform.
    """
    cited_indices = {int(n) for n in _SOURCE_MARKER_RE.findall(answer)}
    if len(cited_indices) < 2:
        return answer
    chunk_by_index = {
        i: str(ctx.get("chunk_id", "")) for i, ctx in enumerate(contexts, start=1) if i in cited_indices
    }
    index_by_chunk = {chunk_id: i for i, chunk_id in chunk_by_index.items() if chunk_id}
    cited_chunk_ids = set(index_by_chunk)
    if len(cited_chunk_ids) < 2:
        return answer

    rows = (
        await session.execute(
            select(Contradiction).where(
                Contradiction.status == "open",
                Contradiction.chunk_a_id.in_(cited_chunk_ids),
                Contradiction.chunk_b_id.in_(cited_chunk_ids),
            )
        )
    ).scalars().all()
    if not rows:
        return answer

    answer_numbers = _numbers(answer)
    additions: list[str] = []
    seen_pairs: set[tuple[str, str]] = set()
    for r in rows:
        pair_key = (min(r.chunk_a_id, r.chunk_b_id), max(r.chunk_a_id, r.chunk_b_id))
        if pair_key in seen_pairs:
            continue
        a_numbers, b_numbers = _numbers(r.sentence_a), _numbers(r.sentence_b)
        a_present, b_present = bool(a_numbers & answer_numbers), bool(b_numbers & answer_numbers)
        missing_side = None
        if a_present and not b_present and b_numbers:
            missing_side = (r.sentence_b, r.chunk_b_id)
        elif b_present and not a_present and a_numbers:
            missing_side = (r.sentence_a, r.chunk_a_id)
        if missing_side is None:
            continue
        sentence, chunk_id = missing_side
        index = index_by_chunk.get(chunk_id)
        if index is None:
            continue
        additions.append(f"{sentence} [source:{index}]")
        seen_pairs.add(pair_key)

    if not additions:
        return answer
    return answer.rstrip() + " " + " ".join(additions)
