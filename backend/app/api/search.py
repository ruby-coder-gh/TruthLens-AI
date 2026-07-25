"""Permission-scoped cross-workspace keyword search."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, Query as FastAPIQuery
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_accessible_workspace_ids, get_current_user, get_db
from app.core.exceptions import InvalidInputException
from app.models.document import Document
from app.models.query import Query
from app.models.user import User
from app.models.workspace import Workspace
from app.retrieval.hybrid_search import keyword_search_records
from app.schemas.common import PaginatedResponse
from app.schemas.search import SearchResult

router = APIRouter(tags=["search"])

MIN_PAGE_SIZE = 1
MAX_PAGE_SIZE = 100
MAX_PER_WORKSPACE = 20
MAX_RECORDS_PER_KIND = 250


def _snippet(text: str, query: str, *, limit: int = 280) -> str:
    normalized = text.replace("\n", " ").strip()
    if len(normalized) <= limit:
        return normalized
    position = normalized.lower().find(query.lower())
    if position < 0:
        return normalized[:limit].rstrip() + "…"
    start = max(0, position - limit // 3)
    end = min(len(normalized), start + limit)
    return ("…" if start else "") + normalized[start:end].strip() + ("…" if end < len(normalized) else "")


@router.get("/search", response_model=PaginatedResponse[SearchResult])
async def search_everywhere(
    q: str = FastAPIQuery(min_length=1, max_length=500),
    page: int = 1,
    page_size: int = 20,
    per_workspace: int = 8,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Search accessible query history and document metadata using BM25 only.

    Access is resolved before loading a record, and each workspace is ranked
    independently then capped to keep a large tenant from drowning out others.
    No embedding, reranker, or generation work is started by this endpoint.
    """
    needle = q.strip()
    if not needle:
        raise InvalidInputException("Search query must not be empty")
    page_size = max(MIN_PAGE_SIZE, min(page_size, MAX_PAGE_SIZE))
    per_workspace = max(1, min(per_workspace, MAX_PER_WORKSPACE))
    workspace_ids = await get_accessible_workspace_ids(db, user)
    if not workspace_ids:
        return PaginatedResponse(
            data=[],
            meta={"page": page, "page_size": page_size, "total": 0, "workspace_count": 0, "per_workspace_limit": per_workspace},
        )

    workspaces = (await db.execute(
        select(Workspace.id, Workspace.name).where(Workspace.id.in_(workspace_ids))
    )).all()
    results: list[SearchResult] = []
    for workspace_id, workspace_name in workspaces:
        queries = (await db.execute(
            select(Query)
            .where(Query.workspace_id == workspace_id)
            .order_by(Query.created_at.desc())
            .limit(MAX_RECORDS_PER_KIND)
        )).scalars().all()
        documents = (await db.execute(
            select(Document)
            .where(Document.workspace_id == workspace_id)
            .order_by(Document.updated_at.desc())
            .limit(MAX_RECORDS_PER_KIND)
        )).scalars().all()

        records: list[dict[str, Any]] = []
        for query in queries:
            records.append({
                "id": query.id,
                "resource_type": "query",
                "title": query.query_text[:200],
                "snippet_source": f"{query.query_text}\n{query.response_text or ''}",
                "search_text": f"{query.query_text}\n{query.response_text or ''}",
            })
        for document in documents:
            metadata = f"{document.original_filename} {document.mime_type} {document.status}"
            records.append({
                "id": document.id,
                "resource_type": "document",
                "title": document.original_filename,
                "snippet_source": f"{document.original_filename} · {document.mime_type} · {document.status}",
                "search_text": metadata,
            })

        ranked = await asyncio.to_thread(keyword_search_records, needle, records, top_k=per_workspace)
        results.extend(
            SearchResult(
                id=str(record["id"]),
                resource_type=record["resource_type"],
                workspace_id=workspace_id,
                workspace_name=workspace_name,
                title=str(record["title"]),
                snippet=_snippet(str(record["snippet_source"]), needle),
                score=round(score, 4),
            )
            for record, score in ranked
        )

    results.sort(key=lambda result: (-result.score, result.workspace_name.lower(), result.title.lower()))
    total = len(results)
    offset = max(0, page - 1) * page_size
    return PaginatedResponse(
        data=results[offset:offset + page_size],
        meta={
            "page": page,
            "page_size": page_size,
            "total": total,
            "workspace_count": len(workspaces),
            "per_workspace_limit": per_workspace,
        },
    )
