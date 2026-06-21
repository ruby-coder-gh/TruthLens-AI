"""Query routes: /api/workspaces/{id}/queries/*"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import APIRouter, Depends

from app.core.deps import check_workspace_access, get_current_user, get_db
from app.core.exceptions import NotFoundException
from app.models.query import Query
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.schemas.common import ListResponse, PaginatedResponse
from app.schemas.query import (
    QueryDetailResponse,
    QueryResponse,
    QuerySummary,
    SourceResponse,
)

router = APIRouter(tags=["queries"])


@router.get("/workspaces/{workspace_id}/queries", response_model=PaginatedResponse[QuerySummary])
async def list_queries(
    workspace_id: str,
    page: int = 1,
    page_size: int = 20,
    workspace: Workspace = Depends(check_workspace_access),
    db: AsyncSession = Depends(get_db),
):
    """List query history for a workspace."""
    count_result = await db.execute(
        select(func.count(Query.id)).where(Query.workspace_id == workspace_id)
    )
    total = count_result.scalar() or 0

    offset = (page - 1) * page_size
    result = await db.execute(
        select(Query)
        .where(Query.workspace_id == workspace_id)
        .order_by(Query.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    queries = result.scalars().all()

    return PaginatedResponse(
        data=[
            QuerySummary(
                id=q.id,
                workspace_id=q.workspace_id,
                query_text=q.query_text[:200] + ("..." if len(q.query_text) > 200 else ""),
                trust_score=q.trust_score,
                guardrail_passed=q.guardrail_passed,
                model_used=q.model_used,
                created_at=q.created_at,
            )
            for q in queries
        ],
        meta={"page": page, "page_size": page_size, "total": total},
    )


@router.get("/queries", response_model=PaginatedResponse[QuerySummary])
async def list_all_queries(
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List query history across all workspaces the user has access to."""
    # Get workspace IDs the user belongs to
    ws_result = await db.execute(
        select(WorkspaceMember.workspace_id).where(WorkspaceMember.user_id == user.id)
    )
    workspace_ids = [row[0] for row in ws_result.fetchall()]

    if not workspace_ids:
        return PaginatedResponse(
            data=[],
            meta={"page": page, "page_size": page_size, "total": 0},
        )

    count_result = await db.execute(
        select(func.count(Query.id)).where(Query.workspace_id.in_(workspace_ids))
    )
    total = count_result.scalar() or 0

    offset = (page - 1) * page_size
    result = await db.execute(
        select(Query)
        .where(Query.workspace_id.in_(workspace_ids))
        .order_by(Query.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    queries = result.scalars().all()

    return PaginatedResponse(
        data=[
            QuerySummary(
                id=q.id,
                workspace_id=q.workspace_id,
                query_text=q.query_text[:200] + ("..." if len(q.query_text) > 200 else ""),
                trust_score=q.trust_score,
                guardrail_passed=q.guardrail_passed,
                model_used=q.model_used,
                created_at=q.created_at,
            )
            for q in queries
        ],
        meta={"page": page, "page_size": page_size, "total": total},
    )


@router.get("/queries/{query_id}", response_model=QueryDetailResponse)
async def get_query_anywhere(
    query_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get full query detail by ID (any workspace user has access to)."""
    # Find workspace IDs user has access to
    ws_result = await db.execute(
        select(WorkspaceMember.workspace_id).where(WorkspaceMember.user_id == user.id)
    )
    workspace_ids = [row[0] for row in ws_result.fetchall()]
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

    sources = []
    try:
        if query.response_sources:
            sources = json.loads(query.response_sources)
    except (json.JSONDecodeError, TypeError):
        sources = []

    return QueryDetailResponse(
        id=query.id,
        workspace_id=query.workspace_id,
        query_text=query.query_text,
        rewritten_query=query.rewritten_query,
        response_text=query.response_text,
        response_sources=sources,
        trust_score=query.trust_score,
        guardrail_score=query.guardrail_score,
        guardrail_passed=query.guardrail_passed,
        model_used=query.model_used,
        latency_ms=query.latency_ms,
        token_count=query.token_count,
        created_at=query.created_at,
    )


@router.get("/workspaces/{workspace_id}/queries/{query_id}", response_model=QueryDetailResponse)
async def get_query(
    workspace_id: str,
    query_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    db: AsyncSession = Depends(get_db),
):
    """Get full query detail."""
    result = await db.execute(
        select(Query).where(Query.id == query_id, Query.workspace_id == workspace_id)
    )
    query = result.scalar_one_or_none()
    if not query:
        raise NotFoundException("Query", query_id)

    sources = []
    try:
        if query.response_sources:
            sources = json.loads(query.response_sources)
    except (json.JSONDecodeError, TypeError):
        sources = []

    return QueryDetailResponse(
        id=query.id,
        workspace_id=query.workspace_id,
        query_text=query.query_text,
        rewritten_query=query.rewritten_query,
        response_text=query.response_text,
        response_sources=sources,
        trust_score=query.trust_score,
        guardrail_score=query.guardrail_score,
        guardrail_passed=query.guardrail_passed,
        model_used=query.model_used,
        latency_ms=query.latency_ms,
        token_count=query.token_count,
        created_at=query.created_at,
    )


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

    sources_list = []
    try:
        if query.response_sources:
            sources_list = json.loads(query.response_sources)
    except (json.JSONDecodeError, TypeError):
        sources_list = []

    return ListResponse(
        data=[
            SourceResponse(
                chunk_id=s.get("chunk_id", ""),
                document_id=s.get("document_id", ""),
                document_name=s.get("document_name", s.get("metadata", {}).get("document_name", "")),
                excerpt=s.get("excerpt", s.get("content", ""))[:300],
                relevance_score=s.get("score", s.get("relevance_score", 0.0)),
                rerank_score=s.get("rerank_score"),
                page_number=s.get("page_number", s.get("metadata", {}).get("page_number")),
                confidence=s.get("confidence"),
                matched_chunks=s.get("matched_chunks"),
                explanation=s.get("explanation"),
                updated_at=s.get("updated_at"),
                file_type=s.get("file_type"),
            )
            for s in sources_list
        ]
    )


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
