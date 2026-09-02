"""Confidence-based human review queue for generated query answers."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import check_workspace_access, check_workspace_owner, get_current_user, get_db, require_workspace_editor
from app.core.exceptions import AppException, ConflictException, InvalidInputException, NotFoundException
from app.models.audit_log import AuditLog
from app.models.golden_entry import GoldenEntry
from app.models.query import Query
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.common import PaginatedResponse
from app.schemas.golden import GoldenEntryResponse, GoldenPromoteRequest
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
        prompt_version=query.prompt_version,
        review_status=query.review_status,
        review_note=query.review_note,
        reviewed_by=query.reviewed_by,
        reviewed_at=query.reviewed_at,
        created_at=query.created_at,
    )


async def _promoted_entry_ids(db: AsyncSession, query_ids: list[str]) -> dict[str, str]:
    """Map query id -> golden entry id for the queue page (one batched select)."""
    if not query_ids:
        return {}
    rows = (await db.execute(
        select(GoldenEntry.source_query_id, GoldenEntry.id).where(GoldenEntry.source_query_id.in_(query_ids))
    )).all()
    return {source_query_id: entry_id for source_query_id, entry_id in rows if source_query_id}


def _eligible_filters(workspace_id: str) -> list[Any]:
    return [
        Query.workspace_id == workspace_id,
        Query.trust_score.is_not(None),
        Query.trust_score < settings.REVIEW_QUEUE_TRUST_THRESHOLD,
        Query.review_status == "needs_review",
        # A gated abstention scores 0.0 by construction but is a *correct*
        # refusal, not a low-confidence answer. Reviewing it teaches nothing, so
        # it must not drown the queue.
        Query.edge_case.is_(None),
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
    items = [_to_item(record) for record in records]
    promoted = await _promoted_entry_ids(db, [item.id for item in items])
    for item in items:
        item.golden_entry_id = promoted.get(item.id)
    return PaginatedResponse(
        data=items,
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


# ─── Golden-set promotion (F7b) ──────────────────────────────────────
# Appended at the end of the module so parallel lanes adding routes to this
# router merge cleanly.


def _cited_document_names(query: Query) -> list[str]:
    """Distinct cited document names, in first-cited order."""
    names: list[str] = []
    for source in _sources(query):
        metadata = source.get("metadata")
        name = source.get("document_name") or (metadata.get("document_name") if isinstance(metadata, dict) else None)
        if isinstance(name, str) and name and name not in names:
            names.append(name)
    return names


@router.post(
    "/workspaces/{workspace_id}/review-queue/{query_id}/promote-golden",
    response_model=GoldenEntryResponse,
    status_code=201,
)
async def promote_query_to_golden_set(
    workspace_id: str,
    query_id: str,
    payload: GoldenPromoteRequest,
    workspace: Workspace = Depends(check_workspace_access),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Turn a reviewed answer into a permanent golden-set regression entry.

    The reviewer's correction (or the model's own answer) becomes the reference
    answer and the cited documents become the expected sources, so human review
    compounds into regression protection. One golden entry per query —
    re-promotion is a 409, never a silent duplicate.
    """
    await require_workspace_editor(workspace=workspace, current_user=current_user, db=db)
    query = (await db.execute(
        select(Query).where(Query.id == query_id, Query.workspace_id == workspace.id)
    )).scalar_one_or_none()
    if not query:
        raise NotFoundException("Query", query_id)

    existing = (await db.execute(
        select(GoldenEntry.id).where(GoldenEntry.source_query_id == query.id)
    )).scalar_one_or_none()
    if existing:
        raise ConflictException("This answer has already been promoted to the golden set")

    supplied_answer = (payload.reference_answer or "").strip()
    if query.edge_case and not supplied_answer:
        # The abstention body embeds volatile retrieval counts ("Searched 5
        # chunks across 2 documents; best evidence score 0.02"), which would
        # break the moment the corpus is re-indexed. The reviewer must write the
        # reference answer themselves.
        raise AppException(
            "REFERENCE_ANSWER_REQUIRED",
            "This answer was an abstention; supply an explicit reference_answer to promote it",
            status_code=422,
        )
    reference_answer = supplied_answer or (query.response_text or "").strip()
    if not reference_answer:
        raise InvalidInputException("A reference answer is required to promote this query")

    entry = GoldenEntry(
        question=query.query_text,
        reference_answer=reference_answer,
        source_documents=_cited_document_names(query),
        # Only 'answerable' entries assert grounded retrieval; unanswerable and
        # ambiguous ones are graded on refusal behaviour instead.
        expected_grounding=payload.category == "answerable",
        category=payload.category,
        difficulty=payload.difficulty,
        notes=payload.notes.strip() if payload.notes else None,
        source_query_id=query.id,
        workspace_id=workspace.id,
        created_by=current_user.id,
    )
    db.add(entry)
    try:
        await db.flush()
    except IntegrityError:
        # The pre-check SELECT cannot see a concurrent, uncommitted sibling
        # insert; uq_golden_entries_source_query decides. Report it as the same
        # 409 rather than a 500.
        await db.rollback()
        raise ConflictException("This answer has already been promoted to the golden set")
    await db.refresh(entry)
    db.add(AuditLog(
        user_id=current_user.id,
        action="query.promote_golden",
        resource_type="query",
        resource_id=query.id,
        details=json.dumps({
            "workspace_id": workspace.id,
            "golden_entry_id": entry.id,
            "category": entry.category,
            "difficulty": entry.difficulty,
            "source_documents": entry.source_documents,
            "reviewer_corrected": bool(payload.reference_answer),
        }),
    ))
    return GoldenEntryResponse.from_row(entry)
