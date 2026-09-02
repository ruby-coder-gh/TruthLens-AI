"""Confidence-based human review queue for generated query answers."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import check_workspace_access, check_workspace_owner, get_current_user, get_db, require_workspace_editor
from app.core.exceptions import ConflictException, NotFoundException
from app.ingestion.chunker import ChunkResult
from app.ingestion.embedder import embed
from app.ingestion.indexer import store
from app.models.audit_log import AuditLog
from app.models.chunk_quarantine import ChunkQuarantine
from app.models.document import Document
from app.models.query import Query
from app.models.user import User
from app.models.workspace import Workspace
from app.query_cache import bump_workspace_document_version
from app.schemas.common import PaginatedResponse
from app.schemas.quarantine import QuarantineActionResponse, QuarantineChunkResponse, to_quarantine_response
from app.schemas.review import (
    ReviewQueueCountResponse,
    ReviewQueueItem,
    ReviewQueueSettingsResponse,
    ReviewQueueSettingsUpdate,
    ReviewQueueUpdate,
)

router = APIRouter(tags=["review queue"])

MIN_PAGE_SIZE = 1
MAX_PAGE_SIZE = 100


def _sources(query: Query) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(query.response_sources or "[]")
        return [source for source in parsed if isinstance(source, dict)] if isinstance(parsed, list) else []
    except (TypeError, json.JSONDecodeError):
        return []


def _to_item(query: Query) -> ReviewQueueItem:
    return ReviewQueueItem(
        id=query.id,
        workspace_id=query.workspace_id,
        query_text=query.query_text,
        response_text=query.response_text,
        response_sources=_sources(query),
        trust_score=query.trust_score,
        trust_components=query.trust_components or {},
        guardrail_score=query.guardrail_score,
        guardrail_passed=query.guardrail_passed,
        review_status=query.review_status,
        review_note=query.review_note,
        reviewed_by=query.reviewed_by,
        reviewed_at=query.reviewed_at,
        created_at=query.created_at,
    )


def _eligible_filters(workspace_id: str) -> list[Any]:
    return [
        Query.workspace_id == workspace_id,
        Query.trust_score.is_not(None),
        Query.trust_score < settings.REVIEW_QUEUE_TRUST_THRESHOLD,
        Query.review_status == "needs_review",
    ]


@router.get("/workspaces/{workspace_id}/review-queue", response_model=PaginatedResponse[ReviewQueueItem])
async def list_review_queue(
    workspace_id: str,
    page: int = 1,
    page_size: int = 20,
    workspace: Workspace = Depends(check_workspace_access),
    db: AsyncSession = Depends(get_db),
):
    """Return pending low-trust answers, with reviewed/dismissed items excluded."""
    page_size = max(MIN_PAGE_SIZE, min(page_size, MAX_PAGE_SIZE))
    if not workspace.review_queue_enabled:
        return PaginatedResponse(
            data=[],
            meta={"page": page, "page_size": page_size, "total": 0, "enabled": False, "threshold": settings.REVIEW_QUEUE_TRUST_THRESHOLD},
        )
    filters = _eligible_filters(workspace.id)
    total = (await db.execute(select(func.count(Query.id)).where(*filters))).scalar() or 0
    records = (await db.execute(
        select(Query)
        .where(*filters)
        .order_by(Query.trust_score.asc(), Query.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )).scalars().all()
    return PaginatedResponse(
        data=[_to_item(record) for record in records],
        meta={"page": page, "page_size": page_size, "total": total, "enabled": True, "threshold": settings.REVIEW_QUEUE_TRUST_THRESHOLD},
    )


@router.get("/workspaces/{workspace_id}/review-queue/count", response_model=ReviewQueueCountResponse)
async def get_review_queue_count(
    workspace_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    db: AsyncSession = Depends(get_db),
):
    """Return a cheap workspace-scoped pending count for navigation badges."""
    if not workspace.review_queue_enabled:
        return ReviewQueueCountResponse(count=0, review_queue_enabled=False)
    count = (await db.execute(select(func.count(Query.id)).where(*_eligible_filters(workspace.id)))).scalar() or 0
    return ReviewQueueCountResponse(count=count, review_queue_enabled=True)


@router.patch("/workspaces/{workspace_id}/review-queue/settings", response_model=ReviewQueueSettingsResponse)
async def update_review_queue_settings(
    workspace_id: str,
    payload: ReviewQueueSettingsUpdate,
    workspace: Workspace = Depends(check_workspace_owner),
):
    """Allow a workspace owner to opt the automatic review queue in or out."""
    workspace.review_queue_enabled = payload.review_queue_enabled
    return ReviewQueueSettingsResponse(review_queue_enabled=workspace.review_queue_enabled)


@router.patch("/workspaces/{workspace_id}/review-queue/{query_id}", response_model=ReviewQueueItem)
async def review_queue_item(
    workspace_id: str,
    query_id: str,
    payload: ReviewQueueUpdate,
    workspace: Workspace = Depends(check_workspace_access),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Record a reviewer disposition and note in both the query and AuditLog."""
    await require_workspace_editor(workspace=workspace, current_user=current_user, db=db)
    query = (await db.execute(
        select(Query).where(Query.id == query_id, Query.workspace_id == workspace.id)
    )).scalar_one_or_none()
    if not query:
        raise NotFoundException("Query", query_id)

    prior_status = query.review_status
    query.review_status = payload.review_status
    query.review_note = payload.review_note.strip() if payload.review_note else None
    query.reviewed_by = current_user.id
    query.reviewed_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(query)
    db.add(AuditLog(
        user_id=current_user.id,
        action="query.review_update",
        resource_type="query",
        resource_id=query.id,
        details=json.dumps({
            "workspace_id": workspace.id,
            "from": prior_status,
            "to": query.review_status,
            "has_note": bool(query.review_note),
            "trust_score": query.trust_score,
        }),
    ))
    return _to_item(query)


# ─── Ingest-time prompt-injection quarantine (F7a) ────────────────────────


def _estimate_token_count(content: str) -> int:
    """Match `chunker._count_tokens`'s 4-chars/token approximation."""
    return len(content) // 4


@router.get(
    "/workspaces/{workspace_id}/review-queue/quarantine",
    response_model=PaginatedResponse[QuarantineChunkResponse],
)
async def list_quarantined_chunks(
    workspace_id: str,
    status: str | None = None,
    page: int = 1,
    page_size: int = 20,
    workspace: Workspace = Depends(check_workspace_access),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List chunks quarantined at ingestion time for a workspace (editor role)."""
    await require_workspace_editor(workspace=workspace, current_user=current_user, db=db)
    page_size = max(MIN_PAGE_SIZE, min(page_size, MAX_PAGE_SIZE))

    filters = [ChunkQuarantine.workspace_id == workspace.id]
    if status:
        filters.append(ChunkQuarantine.status == status)

    total = (await db.execute(select(func.count(ChunkQuarantine.id)).where(*filters))).scalar() or 0
    records = (await db.execute(
        select(ChunkQuarantine)
        .where(*filters)
        .order_by(ChunkQuarantine.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )).scalars().all()

    return PaginatedResponse(
        data=[to_quarantine_response(record) for record in records],
        meta={"page": page, "page_size": page_size, "total": total},
    )


async def _get_quarantine_or_404(db: AsyncSession, workspace_id: str, quarantine_id: str) -> ChunkQuarantine:
    record = (await db.execute(
        select(ChunkQuarantine).where(
            ChunkQuarantine.id == quarantine_id, ChunkQuarantine.workspace_id == workspace_id
        )
    )).scalar_one_or_none()
    if not record:
        raise NotFoundException("Quarantined chunk", quarantine_id)
    return record


@router.post(
    "/workspaces/{workspace_id}/review-queue/quarantine/{quarantine_id}/release",
    response_model=QuarantineActionResponse,
)
async def release_quarantined_chunk(
    workspace_id: str,
    quarantine_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Re-embed + store a single quarantined chunk and mark it released."""
    await require_workspace_editor(workspace=workspace, current_user=current_user, db=db)
    record = await _get_quarantine_or_404(db, workspace.id, quarantine_id)
    if record.status != "quarantined":
        raise ConflictException(f"Quarantined chunk already {record.status}")

    document = (await db.execute(
        select(Document).where(Document.id == record.document_id)
    )).scalar_one_or_none()
    if not document:
        raise NotFoundException("Document", record.document_id)

    chunk_result = ChunkResult(
        id=str(uuid.uuid4()),
        document_id=record.document_id,
        index=record.chunk_index,
        content=record.content,
        token_count=_estimate_token_count(record.content),
    )
    embeddings = await embed([chunk_result], document_name=document.original_filename)
    await store(
        chunks=[chunk_result],
        embeddings=embeddings,
        workspace_id=workspace.id,
        document_id=record.document_id,
    )

    record.status = "released"
    record.reviewed_by = current_user.id
    record.reviewed_at = datetime.now(timezone.utc)
    document.chunk_count = (document.chunk_count or 0) + 1
    document.quarantined_chunk_count = max((document.quarantined_chunk_count or 0) - 1, 0)
    await bump_workspace_document_version(db, workspace.id)

    db.add(AuditLog(
        user_id=current_user.id,
        action="chunk.release",
        resource_type="chunk_quarantine",
        resource_id=record.id,
        details=json.dumps({
            "workspace_id": workspace.id,
            "document_id": record.document_id,
            "chunk_index": record.chunk_index,
            "pattern": record.pattern,
        }),
    ))
    await db.flush()
    return QuarantineActionResponse(id=record.id, status=record.status, message="Chunk released and re-indexed")  # type: ignore[arg-type]


@router.post(
    "/workspaces/{workspace_id}/review-queue/quarantine/{quarantine_id}/dismiss",
    response_model=QuarantineActionResponse,
)
async def dismiss_quarantined_chunk(
    workspace_id: str,
    quarantine_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Permanently dismiss a quarantined chunk; it stays excluded from retrieval."""
    await require_workspace_editor(workspace=workspace, current_user=current_user, db=db)
    record = await _get_quarantine_or_404(db, workspace.id, quarantine_id)
    if record.status != "quarantined":
        raise ConflictException(f"Quarantined chunk already {record.status}")

    record.status = "dismissed"
    record.reviewed_by = current_user.id
    record.reviewed_at = datetime.now(timezone.utc)

    db.add(AuditLog(
        user_id=current_user.id,
        action="chunk.dismiss",
        resource_type="chunk_quarantine",
        resource_id=record.id,
        details=json.dumps({
            "workspace_id": workspace.id,
            "document_id": record.document_id,
            "chunk_index": record.chunk_index,
            "pattern": record.pattern,
        }),
    ))
    await db.flush()
    return QuarantineActionResponse(id=record.id, status=record.status, message="Chunk dismissed")  # type: ignore[arg-type]
