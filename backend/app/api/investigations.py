"""Investigation case API: grounded research runs plus review workflow."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import check_workspace_access, get_current_user, get_db
from app.core.exceptions import ForbiddenException, NotFoundException
from app.models.audit_log import AuditLog
from app.models.investigation import Investigation
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.schemas.common import PaginatedResponse
from app.schemas.investigation import (
    InvestigationRequest,
    InvestigationResponse,
    InvestigationReviewUpdate,
    InvestigationSummary,
)
from app.utils.logger import logger

router = APIRouter(tags=["investigation"])

MIN_PAGE_SIZE = 1
MAX_PAGE_SIZE = 100


def _to_response(case: Investigation) -> InvestigationResponse:
    return InvestigationResponse(
        id=case.id,
        workspace_id=case.workspace_id,
        query=case.query_text,
        final_report=case.final_report,
        trust_score=case.trust_score,
        trust_components=case.trust_components or {},
        reasoning_trace=case.reasoning_trace or [],
        sub_questions=case.sub_questions or [],
        latency_ms=case.latency_ms,
        error=case.error,
        review_status=case.review_status,
        review_note=case.review_note,
        reviewed_by=case.reviewed_by,
        reviewed_at=case.reviewed_at,
        created_at=case.created_at,
        updated_at=case.updated_at,
    )


async def _require_reviewer(
    *, workspace: Workspace, current_user: User, db: AsyncSession
) -> None:
    """Only workspace owners/editors or global admins can change case review state."""
    if current_user.role == "admin" or workspace.owner_id == current_user.id:
        return

    result = await db.execute(
        select(WorkspaceMember.role).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.user_id == current_user.id,
        )
    )
    if result.scalar_one_or_none() not in {"owner", "editor"}:
        raise ForbiddenException("Viewer role cannot update investigation review state")


@router.post(
    "/workspaces/{workspace_id}/investigate",
    response_model=InvestigationResponse,
    status_code=201,
)
async def investigate(
    workspace_id: str,
    body: InvestigationRequest,
    workspace: Workspace = Depends(check_workspace_access),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Run a grounded investigation and persist its reproducible case snapshot."""
    from app.graph.investigation import run_investigation

    logger.info(
        "investigation_api_started",
        query=body.query[:100],
        workspace_id=workspace_id,
        user_id=current_user.id,
    )
    result = await asyncio.to_thread(
        run_investigation,
        query=body.query,
        workspace_id=workspace_id,
        user_id=current_user.id,
        top_k=body.top_k,
        filters=body.filters,
    )

    case = Investigation(
        workspace_id=workspace_id,
        user_id=current_user.id,
        query_text=body.query,
        final_report=result.get("final_report", ""),
        sub_questions=result.get("sub_questions", []),
        reasoning_trace=result.get("reasoning_trace", []),
        trust_components=result.get("trust_components", {}),
        trust_score=result.get("trust_score"),
        latency_ms=result.get("latency_ms", 0),
        error=result.get("error"),
        review_status="needs_changes" if result.get("error") else "draft",
    )
    db.add(case)
    await db.flush()
    await db.refresh(case)
    db.add(
        AuditLog(
            user_id=current_user.id,
            action="investigation.create",
            resource_type="investigation",
            resource_id=case.id,
            details=json.dumps(
                {
                    "workspace_id": workspace_id,
                    "trust_score": case.trust_score,
                    "latency_ms": case.latency_ms,
                    "has_error": bool(case.error),
                    "sub_question_count": len(case.sub_questions or []),
                }
            ),
        )
    )

    logger.info(
        "investigation_api_complete",
        investigation_id=case.id,
        trust_score=case.trust_score,
        latency_ms=case.latency_ms,
    )
    return _to_response(case)


@router.get(
    "/workspaces/{workspace_id}/investigations",
    response_model=PaginatedResponse[InvestigationSummary],
)
async def list_investigations(
    workspace_id: str,
    page: int = 1,
    page_size: int = 20,
    workspace: Workspace = Depends(check_workspace_access),
    db: AsyncSession = Depends(get_db),
):
    """List durable investigation cases for the active workspace."""
    page_size = max(MIN_PAGE_SIZE, min(page_size, MAX_PAGE_SIZE))
    total = (
        await db.execute(
            select(func.count(Investigation.id)).where(Investigation.workspace_id == workspace.id)
        )
    ).scalar() or 0
    records = (
        await db.execute(
            select(Investigation)
            .where(Investigation.workspace_id == workspace.id)
            .order_by(Investigation.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()
    return PaginatedResponse(
        data=[
            InvestigationSummary(
                id=case.id,
                workspace_id=case.workspace_id,
                query=case.query_text,
                trust_score=case.trust_score,
                review_status=case.review_status,
                created_at=case.created_at,
                updated_at=case.updated_at,
            )
            for case in records
        ],
        meta={"page": page, "page_size": page_size, "total": total},
    )


@router.get(
    "/workspaces/{workspace_id}/investigations/{investigation_id}",
    response_model=InvestigationResponse,
)
async def get_investigation(
    workspace_id: str,
    investigation_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    db: AsyncSession = Depends(get_db),
):
    """Return the exact persisted report, evidence snapshots, and review state."""
    case = (
        await db.execute(
            select(Investigation).where(
                Investigation.id == investigation_id,
                Investigation.workspace_id == workspace.id,
            )
        )
    ).scalar_one_or_none()
    if not case:
        raise NotFoundException("Investigation", investigation_id)
    return _to_response(case)


@router.patch(
    "/workspaces/{workspace_id}/investigations/{investigation_id}/review",
    response_model=InvestigationResponse,
)
async def review_investigation(
    workspace_id: str,
    investigation_id: str,
    body: InvestigationReviewUpdate,
    workspace: Workspace = Depends(check_workspace_access),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Record an editor/owner review decision and preserve its audit trail."""
    await _require_reviewer(workspace=workspace, current_user=current_user, db=db)
    case = (
        await db.execute(
            select(Investigation).where(
                Investigation.id == investigation_id,
                Investigation.workspace_id == workspace.id,
            )
        )
    ).scalar_one_or_none()
    if not case:
        raise NotFoundException("Investigation", investigation_id)

    prior_status = case.review_status
    case.review_status = body.review_status
    case.review_note = body.review_note.strip() if body.review_note else None
    case.reviewed_by = current_user.id
    case.reviewed_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(case)
    db.add(
        AuditLog(
            user_id=current_user.id,
            action="investigation.review_update",
            resource_type="investigation",
            resource_id=case.id,
            details=json.dumps(
                {"from": prior_status, "to": case.review_status, "has_note": bool(case.review_note)}
            ),
        )
    )
    return _to_response(case)
