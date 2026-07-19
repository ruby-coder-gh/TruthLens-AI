"""Query routes: /api/workspaces/{id}/queries/*"""

from __future__ import annotations

import json
import uuid
from typing import Any

from fastapi import APIRouter, Depends, status
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import check_workspace_access, get_accessible_workspace_ids, get_current_user, get_db
from app.core.exceptions import ConflictException, NotFoundException
from app.models.audit_log import AuditLog
from app.models.query import Query
from app.models.query_pin import QueryPin
from app.models.user import User
from app.models.workspace import Workspace
from app.query_cache import normalize_query
from app.report_export import render_evidence_markdown
from app.schemas.common import ListResponse, PaginatedResponse
from app.schemas.pin import QueryPinResponse
from app.schemas.query import QueryDetailResponse, QuerySummary, SourceResponse
from app.schemas.query_comparison import QueryComparisonResponse, QuerySourceDiff



def _deserialize_sources(query: Query) -> list[dict[str, Any]]:
    try:
        loaded = json.loads(query.response_sources or "[]")
        return [source for source in loaded if isinstance(source, dict)] if isinstance(loaded, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def _source_response(source: dict[str, Any]) -> SourceResponse:
    metadata = source.get("metadata") if isinstance(source.get("metadata"), dict) else {}
    raw_score = source.get("relevance_score", source.get("score", 0.0))
    try:
        score = float(raw_score)
    except (TypeError, ValueError):
        score = 0.0
    return SourceResponse(
        chunk_id=str(source.get("chunk_id", "")),
        document_id=str(source.get("document_id", "")),
        document_name=source.get("document_name", metadata.get("document_name")),
        excerpt=str(source.get("excerpt", source.get("content", "")))[:300],
        relevance_score=score,
        rerank_score=source.get("rerank_score") if isinstance(source.get("rerank_score"), (int, float)) else None,
        page_number=source.get("page_number", metadata.get("page_number")),
        confidence=source.get("confidence") if isinstance(source.get("confidence"), (int, float)) else None,
        matched_chunks=source.get("matched_chunks") if isinstance(source.get("matched_chunks"), int) else None,
        explanation=source.get("explanation") if isinstance(source.get("explanation"), str) else None,
        updated_at=source.get("updated_at") if isinstance(source.get("updated_at"), str) else None,
        file_type=source.get("file_type") if isinstance(source.get("file_type"), str) else None,
    )


async def _pinned_query_ids(db: AsyncSession, *, user_id: str, query_ids: list[str]) -> set[str]:
    if not query_ids:
        return set()
    result = await db.execute(
        select(QueryPin.query_id).where(
            QueryPin.user_id == user_id,
            QueryPin.query_id.in_(query_ids),
        )
    )
    return set(result.scalars().all())


def _to_summary(query: Query, *, is_pinned: bool = False) -> QuerySummary:
    return QuerySummary(
        id=query.id,
        workspace_id=query.workspace_id,
        query_text=query.query_text[:200] + ("..." if len(query.query_text) > 200 else ""),
        trust_score=query.trust_score,
        guardrail_passed=query.guardrail_passed,
        model_used=query.model_used,
        is_pinned=is_pinned,
        compared_to_query_id=query.compared_to_query_id,
        review_status=query.review_status,
        created_at=query.created_at,
    )


def _to_detail(query: Query, *, is_pinned: bool = False) -> QueryDetailResponse:
    return QueryDetailResponse(
        id=query.id,
        workspace_id=query.workspace_id,
        query_text=query.query_text,
        rewritten_query=query.rewritten_query,
        response_text=query.response_text,
        response_sources=_deserialize_sources(query),
        trust_score=query.trust_score,
        guardrail_score=query.guardrail_score,
        guardrail_passed=query.guardrail_passed,
        model_used=query.model_used,
        latency_ms=query.latency_ms,
        token_count=query.token_count,
        is_pinned=is_pinned,
        compared_to_query_id=query.compared_to_query_id,
        trust_components=query.trust_components or {},
        review_status=query.review_status,
        review_note=query.review_note,
        reviewed_by=query.reviewed_by,
        reviewed_at=query.reviewed_at,
        created_at=query.created_at,
    )


def _source_key(source: dict[str, Any]) -> str:
    return str(source.get("chunk_id") or source.get("document_id") or source.get("document_name") or "")


async def _run_fresh_query(*, query: Query, user_id: str) -> dict[str, Any]:
    """Run the standard LangGraph pipeline with cache bypassed for a comparison."""
    from app.graph.query_graph import build_query_graph

    graph = build_query_graph()
    initial_state = {
        "query": query.query_text,
        "rewritten_query": None,
        "workspace_id": query.workspace_id,
        "user_id": user_id,
        "query_id": str(uuid.uuid4()),
        "top_k": settings.RETRIEVAL_TOP_K,
        "filters": None,
        "force_refresh": True,
        "cache_hit": False,
        "cached_query_id": None,
        "workspace_document_version": 0,
        "retrieval_results": None,
        "reranked_results": None,
        "contexts": None,
        "response_text": None,
        "cited_spans": None,
        "guardrail_result": None,
        "guardrail_retry_count": 0,
        "trust_score": None,
        "trust_components": None,
        "model_used": "unknown",
        "latency_ms": 0,
        "error": None,
    }
    return await graph.ainvoke(initial_state)
router = APIRouter(tags=["queries"])

MIN_PAGE_SIZE = 1
MAX_PAGE_SIZE = 100


@router.get("/workspaces/{workspace_id}/queries", response_model=PaginatedResponse[QuerySummary])
async def list_queries(
    workspace_id: str,
    pinned: bool | None = None,
    page: int = 1,
    page_size: int = 20,
    workspace: Workspace = Depends(check_workspace_access),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List query history, optionally restricted to the caller's private pins."""
    page_size = max(MIN_PAGE_SIZE, min(page_size, MAX_PAGE_SIZE))
    filters = [Query.workspace_id == workspace_id]
    if pinned is True:
        filters.append(Query.id.in_(select(QueryPin.query_id).where(QueryPin.user_id == user.id)))

    total = (await db.execute(select(func.count(Query.id)).where(*filters))).scalar() or 0
    queries = (await db.execute(
        select(Query)
        .where(*filters)
        .order_by(Query.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )).scalars().all()
    pinned_ids = await _pinned_query_ids(db, user_id=user.id, query_ids=[query.id for query in queries])

    return PaginatedResponse(
        data=[_to_summary(query, is_pinned=query.id in pinned_ids) for query in queries],
        meta={"page": page, "page_size": page_size, "total": total},
    )


@router.get("/queries", response_model=PaginatedResponse[QuerySummary])
async def list_all_queries(
    pinned: bool | None = None,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List history across the caller's accessible workspaces and private pins."""
    page_size = max(MIN_PAGE_SIZE, min(page_size, MAX_PAGE_SIZE))
    workspace_ids = await get_accessible_workspace_ids(db, user)
    if not workspace_ids:
        return PaginatedResponse(data=[], meta={"page": page, "page_size": page_size, "total": 0})

    filters = [Query.workspace_id.in_(workspace_ids)]
    if pinned is True:
        filters.append(Query.id.in_(select(QueryPin.query_id).where(QueryPin.user_id == user.id)))
    total = (await db.execute(select(func.count(Query.id)).where(*filters))).scalar() or 0
    queries = (await db.execute(
        select(Query).where(*filters).order_by(Query.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    pinned_ids = await _pinned_query_ids(db, user_id=user.id, query_ids=[query.id for query in queries])
    return PaginatedResponse(
        data=[_to_summary(query, is_pinned=query.id in pinned_ids) for query in queries],
        meta={"page": page, "page_size": page_size, "total": total},
    )


@router.get("/queries/{query_id}", response_model=QueryDetailResponse)
async def get_query_anywhere(
    query_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get full query detail by ID from an owner/member-accessible workspace."""
    workspace_ids = await get_accessible_workspace_ids(db, user)
    if not workspace_ids:
        raise NotFoundException("Query", query_id)
    query = (await db.execute(
        select(Query).where(Query.id == query_id, Query.workspace_id.in_(workspace_ids))
    )).scalar_one_or_none()
    if not query:
        raise NotFoundException("Query", query_id)
    pinned = query.id in await _pinned_query_ids(db, user_id=user.id, query_ids=[query.id])
    return _to_detail(query, is_pinned=pinned)


def _render_query_markdown(query: Query, sources: list[dict[str, Any]]) -> str:
    """Render a query's question/answer/trust score/sources as a Markdown document."""
    answer = query.response_text or "_No answer generated._"

    if query.trust_score is None:
        trust = "_Not scored._"
    else:
        trust = f"{round(query.trust_score * 100)}%"

    sources_block = render_evidence_markdown(sources)

    return (
        "# TruthLens Export\n\n"
        "## Question\n"
        f"{query.query_text}\n\n"
        "## Answer\n"
        f"{answer}\n\n"
        "## Trust Score\n"
        f"{trust}\n\n"
        "## Sources\n"
        f"{sources_block}\n"
    )


@router.get("/queries/{query_id}/export")
async def export_query_markdown(
    query_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """Export a query's question, answer, trust score, and sources as a Markdown file."""
    workspace_ids = await get_accessible_workspace_ids(db, user)
    if not workspace_ids:
        raise NotFoundException("Query", query_id)

    result = await db.execute(
        select(Query).where(
            Query.id == query_id,
            Query.workspace_id.in_(workspace_ids),
        )
    )
    query = result.scalar_one_or_none()
    if not query:
        raise NotFoundException("Query", query_id)

    md = _render_query_markdown(query, _deserialize_sources(query))

    return Response(
        content=md,
        media_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="truthlens-query-{query.id}.md"'
        },
    )


@router.get("/workspaces/{workspace_id}/queries/{query_id}", response_model=QueryDetailResponse)
async def get_query(
    workspace_id: str,
    query_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get full query detail."""
    result = await db.execute(
        select(Query).where(Query.id == query_id, Query.workspace_id == workspace_id)
    )
    query = result.scalar_one_or_none()
    if not query:
        raise NotFoundException("Query", query_id)

    pinned = query.id in await _pinned_query_ids(db, user_id=user.id, query_ids=[query.id])
    return _to_detail(query, is_pinned=pinned)


@router.get("/workspaces/{workspace_id}/queries/{query_id}/sources", response_model=ListResponse[SourceResponse])
async def get_query_sources(
    workspace_id: str,
    query_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    db: AsyncSession = Depends(get_db),
):
    """Get cited sources for a query."""
    result = await db.execute(
        select(Query).where(Query.id == query_id, Query.workspace_id == workspace_id)
    )
    query = result.scalar_one_or_none()
    if not query:
        raise NotFoundException("Query", query_id)

    return ListResponse(data=[_source_response(source) for source in _deserialize_sources(query)])


@router.delete("/workspaces/{workspace_id}/queries/{query_id}", status_code=204)
async def delete_query(
    workspace_id: str,
    query_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    db: AsyncSession = Depends(get_db),
):
    """Delete a query."""
    result = await db.execute(
        select(Query).where(Query.id == query_id, Query.workspace_id == workspace_id)
    )
    query = result.scalar_one_or_none()
    if not query:
        raise NotFoundException("Query", query_id)
    await db.delete(query)


@router.post(
    "/workspaces/{workspace_id}/queries/{query_id}/pin",
    response_model=QueryPinResponse,
    status_code=status.HTTP_201_CREATED,
)
async def pin_query(
    workspace_id: str,
    query_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Pin a query for the requesting user only (never a shared workspace flag)."""
    query = (await db.execute(
        select(Query).where(Query.id == query_id, Query.workspace_id == workspace.id)
    )).scalar_one_or_none()
    if not query:
        raise NotFoundException("Query", query_id)

    existing = (await db.execute(
        select(QueryPin).where(QueryPin.user_id == user.id, QueryPin.query_id == query.id)
    )).scalar_one_or_none()
    if existing:
        return QueryPinResponse(
            id=existing.id,
            workspace_id=existing.workspace_id,
            query_id=existing.query_id,
            user_id=existing.user_id,
            created_at=existing.created_at,
        )

    pin_count = (await db.execute(
        select(func.count(QueryPin.id)).where(
            QueryPin.user_id == user.id,
            QueryPin.workspace_id == workspace.id,
        )
    )).scalar() or 0
    if pin_count >= settings.QUERY_PIN_LIMIT:
        raise ConflictException(
            f"Pin limit of {settings.QUERY_PIN_LIMIT} reached for this workspace. Unpin an item before adding another."
        )

    pin = QueryPin(workspace_id=workspace.id, query_id=query.id, user_id=user.id)
    db.add(pin)
    await db.flush()
    await db.refresh(pin)
    db.add(AuditLog(
        user_id=user.id,
        action="query.pin",
        resource_type="query",
        resource_id=query.id,
        details=json.dumps({"workspace_id": workspace.id, "private": True}),
    ))
    return QueryPinResponse(
        id=pin.id, workspace_id=pin.workspace_id, query_id=pin.query_id,
        user_id=pin.user_id, created_at=pin.created_at,
    )


@router.delete("/workspaces/{workspace_id}/queries/{query_id}/pin", status_code=status.HTTP_204_NO_CONTENT)
async def unpin_query(
    workspace_id: str,
    query_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove only the caller's private pin; other members' pins remain intact."""
    query = (await db.execute(
        select(Query).where(Query.id == query_id, Query.workspace_id == workspace.id)
    )).scalar_one_or_none()
    if not query:
        raise NotFoundException("Query", query_id)
    pin = (await db.execute(
        select(QueryPin).where(QueryPin.user_id == user.id, QueryPin.query_id == query.id)
    )).scalar_one_or_none()
    if pin:
        await db.delete(pin)
        db.add(AuditLog(
            user_id=user.id,
            action="query.unpin",
            resource_type="query",
            resource_id=query.id,
            details=json.dumps({"workspace_id": workspace.id, "private": True}),
        ))


@router.post(
    "/workspaces/{workspace_id}/queries/{query_id}/compare",
    response_model=QueryComparisonResponse,
)
async def compare_query_answer(
    workspace_id: str,
    query_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Re-run a saved question against the current document set and explain changes."""
    original = (await db.execute(
        select(Query).where(Query.id == query_id, Query.workspace_id == workspace.id)
    )).scalar_one_or_none()
    if not original:
        raise NotFoundException("Query", query_id)

    result = await _run_fresh_query(query=original, user_id=user.id)
    rerun_sources = result.get("contexts") or []
    if not isinstance(rerun_sources, list):
        rerun_sources = []
    rerun_id = str(result.get("query_id") or uuid.uuid4())
    guardrail = result.get("guardrail_result") or {}
    rerun = Query(
        id=rerun_id,
        workspace_id=workspace.id,
        user_id=user.id,
        query_text=original.query_text,
        normalized_query=normalize_query(original.query_text),
        document_version=int(result.get("workspace_document_version") or workspace.document_version),
        rewritten_query=result.get("rewritten_query"),
        response_text=result.get("response_text"),
        response_sources=json.dumps(rerun_sources),
        trust_score=result.get("trust_score"),
        trust_components=result.get("trust_components") or {},
        guardrail_score=guardrail.get("score"),
        guardrail_passed=guardrail.get("passed"),
        model_used=result.get("model_used"),
        latency_ms=int(result.get("latency_ms") or 0),
        token_count=None,
        compared_to_query_id=original.id,
        review_status="needs_review",
    )
    db.add(rerun)
    await db.flush()
    await db.refresh(rerun)

    original_sources = _deserialize_sources(original)
    original_keys = {_source_key(source): source for source in original_sources if _source_key(source)}
    rerun_keys = {_source_key(source): source for source in rerun_sources if _source_key(source)}
    source_diff = QuerySourceDiff(
        new_sources=[_source_response(rerun_keys[key]) for key in rerun_keys.keys() - original_keys.keys()],
        dropped_sources=[_source_response(original_keys[key]) for key in original_keys.keys() - rerun_keys.keys()],
        shared_sources=[_source_response(rerun_keys[key]) for key in rerun_keys.keys() & original_keys.keys()],
    )
    delta = None
    if original.trust_score is not None and rerun.trust_score is not None:
        delta = rerun.trust_score - original.trust_score

    db.add(AuditLog(
        user_id=user.id,
        action="query.compare",
        resource_type="query",
        resource_id=rerun.id,
        details=json.dumps({
            "workspace_id": workspace.id,
            "compared_to_query_id": original.id,
            "new_source_count": len(source_diff.new_sources),
            "dropped_source_count": len(source_diff.dropped_sources),
            "trust_score_delta": delta,
        }),
    ))
    original_pinned = original.id in await _pinned_query_ids(db, user_id=user.id, query_ids=[original.id])
    return QueryComparisonResponse(
        original=_to_detail(original, is_pinned=original_pinned),
        rerun=_to_detail(rerun),
        trust_score_delta=delta,
        source_diff=source_diff,
        trust_components=rerun.trust_components or {},
    )
