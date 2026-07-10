"""Comparison routes: /api/workspaces/{id}/comparisons/*"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.deps import check_workspace_access, get_current_user, get_db
from app.core.exceptions import NotFoundException
from app.models.comparison import Comparison, ComparisonResult
from app.models.document import Document
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.common import (
    ComparisonResponse,
    ComparisonResultResponse,
    ComparisonSource,
    ComparisonSummary,
    ComparisonCreateRequest,
    ComparisonCreateResponse,
    PaginatedResponse,
)
from app.utils.logger import logger

router = APIRouter(tags=["comparisons"])

MIN_PAGE_SIZE = 1
MAX_PAGE_SIZE = 100


def _to_comparison_source(raw: dict[str, Any], document_id: str, document_name: str) -> ComparisonSource:
    """Map a stored source dict to a ComparisonSource, tolerating partial payloads.

    Persisted comparison sources may use different keys (e.g. ``text`` for the
    excerpt) depending on which pipeline produced them, so resolve fields
    defensively rather than assuming an exact schema match.
    """
    excerpt = raw.get("excerpt")
    if excerpt is None:
        excerpt = raw.get("text", "")

    def _as_float(value: Any) -> float | None:
        try:
            return float(value) if value is not None else None
        except (TypeError, ValueError):
            return None

    return ComparisonSource(
        chunk_id=str(raw.get("chunk_id", "")),
        document_id=str(raw.get("document_id", document_id)),
        document_name=str(raw.get("document_name", document_name)),
        excerpt=str(excerpt),
        relevance_score=_as_float(raw.get("relevance_score")) or 0.0,
        rerank_score=_as_float(raw.get("rerank_score")),
        confidence=_as_float(raw.get("confidence")),
        matched_chunks=raw.get("matched_chunks") if isinstance(raw.get("matched_chunks"), int) else None,
    )


async def _run_comparison(*, query: str, workspace_id: str, document_ids: list[str], user_id: str, query_id: str):
    from app.graph.comparison_graph import run_comparison

    return await run_comparison(
        query=query,
        workspace_id=workspace_id,
        document_ids=document_ids,
        user_id=user_id,
        query_id=query_id,
    )


@router.post(
    "/workspaces/{workspace_id}/comparisons",
    response_model=ComparisonCreateResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_comparison(
    workspace_id: str,
    payload: ComparisonCreateRequest,
    workspace: Workspace = Depends(check_workspace_access),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a new multi-document comparison (async - returns immediately)."""
    if len(payload.document_ids) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least 2 documents required for comparison",
        )
    if len(payload.document_ids) > 5:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Maximum 5 documents allowed for comparison",
        )

    # Verify all documents exist and belong to workspace
    result = await db.execute(
        select(Document.id).where(
            Document.id.in_(payload.document_ids),
            Document.workspace_id == workspace_id,
        )
    )
    found_ids = {row[0] for row in result.fetchall()}
    missing = set(payload.document_ids) - found_ids
    if missing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Documents not found in workspace: {missing}",
        )

    # Create comparison record
    comparison = Comparison(
        workspace_id=workspace_id,
        user_id=user.id,
        question=payload.question,
        document_ids=payload.document_ids,
    )
    db.add(comparison)
    await db.commit()
    await db.refresh(comparison)

    # Run comparison in background (fire and forget for now)
    import asyncio
    asyncio.create_task(_run_and_save_comparison(
        comparison_id=comparison.id,
        query=payload.question,
        workspace_id=workspace_id,
        document_ids=payload.document_ids,
        user_id=user.id,
    ))

    return ComparisonCreateResponse(
        comparison_id=comparison.id,
        status="processing",
        message="Comparison started. Poll for results.",
    )


async def _run_and_save_comparison(
    comparison_id: str,
    query: str,
    workspace_id: str,
    document_ids: list[str],
    user_id: str,
) -> None:
    """Background task to run comparison and save results."""
    from app.database import async_session_factory

    try:
        result = await _run_comparison(
            query=query,
            workspace_id=workspace_id,
            document_ids=document_ids,
            user_id=user_id,
            query_id=comparison_id,
        )

        async with async_session_factory() as db:
            # Update comparison with results
            comparison = await db.get(Comparison, comparison_id)
            if not comparison:
                return

            comparison.synthesis_text = result.get("synthesis_text")
            comparison.agreement_score = result.get("agreement_score")
            comparison.trust_score = result.get("trust_score")

            # Save per-document results
            per_doc_stances = result.get("per_doc_stances", {})
            doc_results = result.get("doc_results", [])

            for dr in doc_results:
                doc_id = dr["document_id"]
                stance = per_doc_stances.get(doc_id, "silent")

                # Save sources
                sources_json = json.dumps(dr.get("sources", []))

                comp_result = ComparisonResult(
                    comparison_id=comparison_id,
                    document_id=doc_id,
                    answer_text=dr["answer_text"],
                    sources=sources_json,
                    trust_score=dr.get("trust_score"),
                    stance=stance,
                )
                db.add(comp_result)

            await db.commit()

    except Exception as e:
        logger.error("comparison_background_failed", comparison_id=comparison_id, error=str(e))


@router.get(
    "/workspaces/{workspace_id}/comparisons",
    response_model=PaginatedResponse[ComparisonSummary],
)
async def list_comparisons(
    workspace_id: str,
    page: int = 1,
    page_size: int = 20,
    workspace: Workspace = Depends(check_workspace_access),
    db: AsyncSession = Depends(get_db),
):
    """List comparison history for a workspace."""
    page_size = max(MIN_PAGE_SIZE, min(page_size, MAX_PAGE_SIZE))

    count_result = await db.execute(
        select(func.count(Comparison.id)).where(Comparison.workspace_id == workspace_id)
    )
    total = count_result.scalar() or 0

    offset = (page - 1) * page_size
    result = await db.execute(
        select(Comparison)
        .where(Comparison.workspace_id == workspace_id)
        .order_by(Comparison.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    comparisons = result.scalars().all()

    return PaginatedResponse(
        data=[
            ComparisonSummary(
                id=c.id,
                workspace_id=c.workspace_id,
                question=c.question,
                document_count=len(c.document_ids),
                agreement_score=c.agreement_score,
                trust_score=c.trust_score,
                created_at=c.created_at,
            )
            for c in comparisons
        ],
        meta={"page": page, "page_size": page_size, "total": total},
    )


@router.get(
    "/workspaces/{workspace_id}/comparisons/{comparison_id}",
    response_model=ComparisonResponse,
)
async def get_comparison(
    workspace_id: str,
    comparison_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    db: AsyncSession = Depends(get_db),
):
    """Get full comparison detail with per-document results."""
    result = await db.execute(
        select(Comparison).where(
            Comparison.id == comparison_id,
            Comparison.workspace_id == workspace_id,
        )
    )
    comparison = result.scalar_one_or_none()
    if not comparison:
        raise NotFoundException("Comparison", comparison_id)

    # Load per-document results
    cr_result = await db.execute(
        select(ComparisonResult).where(ComparisonResult.comparison_id == comparison_id)
    )
    comp_results = cr_result.scalars().all()

    # Load document names
    doc_ids = [cr.document_id for cr in comp_results]
    doc_names = {}
    if doc_ids:
        doc_result = await db.execute(
            select(Document.id, Document.original_filename).where(Document.id.in_(doc_ids))
        )
        doc_names = {row[0]: row[1] for row in doc_result.fetchall()}

    # Build response
    results: list[ComparisonResultResponse] = []
    for cr in comp_results:
        raw_sources: list[dict[str, Any]] = []
        try:
            if cr.sources:
                loaded = json.loads(cr.sources)
                if isinstance(loaded, list):
                    raw_sources = [s for s in loaded if isinstance(s, dict)]
        except (json.JSONDecodeError, TypeError):
            raw_sources = []

        doc_name = doc_names.get(cr.document_id, "")
        sources = [_to_comparison_source(s, cr.document_id, doc_name) for s in raw_sources]

        results.append(
            ComparisonResultResponse(
                id=cr.id,
                document_id=cr.document_id,
                document_name=doc_name,
                answer_text=cr.answer_text,
                sources=sources,
                trust_score=cr.trust_score,
                stance=cr.stance,
                created_at=cr.created_at,
            )
        )

    return ComparisonResponse(
        id=comparison.id,
        workspace_id=comparison.workspace_id,
        question=comparison.question,
        document_ids=comparison.document_ids,
        synthesis_text=comparison.synthesis_text,
        agreement_score=comparison.agreement_score,
        trust_score=comparison.trust_score,
        results=results,
        created_at=comparison.created_at,
    )


@router.delete(
    "/workspaces/{workspace_id}/comparisons/{comparison_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_comparison(
    workspace_id: str,
    comparison_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    db: AsyncSession = Depends(get_db),
):
    """Delete a comparison."""
    result = await db.execute(
        select(Comparison).where(
            Comparison.id == comparison_id,
            Comparison.workspace_id == workspace_id,
        )
    )
    comparison = result.scalar_one_or_none()
    if not comparison:
        raise NotFoundException("Comparison", comparison_id)
    await db.delete(comparison)
