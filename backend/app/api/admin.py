"""Admin routes: /api/admin/*"""

from __future__ import annotations

import asyncio
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from pydantic import BaseModel, field_validator
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import APIRouter, Depends

from app.config import settings
from app.core.auth import hash_password
from app.core.deps import get_current_admin, get_db
from app.core.exceptions import ConflictException, NotFoundException
from app.models.audit_log import AuditLog
from app.models.document import Document
from app.models.eval_run import EvalRun
from app.models.feedback import Feedback
from app.models.query import Query
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.analytics import (
    AdminSettingsResponse,
    AdminSettingsUpdate,
    EvalRunResponse,
    FlaggedAnswerResponse,
    TrustScoreDistribution,
    UsageStatsResponse,
    UserActivityResponse,
)
from app.schemas.common import AdminStatsResponse, AuditLogResponse, EvaluationResponse, PaginatedResponse
from app.schemas.user import UserResponse
from app.utils.logger import logger

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(get_current_admin)])

# In-memory settings overrides (reset on restart)
_settings_overrides: dict[str, Any] = {}

TRUST_SCORE_LOW_THRESHOLD = 0.4
MIN_PAGE_SIZE = 1
MAX_PAGE_SIZE = 100


# ─── Inline schemas for admin-only operations ────────────────────────


class UserInviteRequest(BaseModel):
    email: str
    username: str
    role: str = "user"

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        if not v or "@" not in v:
            raise ValueError("Valid email address is required")
        return v.strip().lower()

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str) -> str:
        if not v or len(v.strip()) < 2:
            raise ValueError("Username must be at least 2 characters")
        return v.strip()


class UserDetailResponse(BaseModel):
    id: str
    email: str
    username: str
    role: str
    is_active: bool
    query_count: int = 0
    last_login_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class UserRoleUpdate(BaseModel):
    role: str


class UserStatusUpdate(BaseModel):
    is_active: bool


# ─── Existing endpoints ─────────────────────────────────────────────


@router.get("/stats", response_model=AdminStatsResponse)
async def get_admin_stats(db: AsyncSession = Depends(get_db)):
    """Get system-wide metrics (admin only)."""
    async def _count(model):
        r = await db.execute(select(func.count(model.id)))
        return r.scalar() or 0

    counts = await asyncio.gather(
        _count(User), _count(Workspace), _count(Document),
        _count(Query), _count(Feedback),
    )
    total_users, total_workspaces, total_documents, total_queries, total_feedback = counts

    trust_r, rating_r = await asyncio.gather(
        db.execute(select(func.avg(Query.trust_score)).where(Query.trust_score.isnot(None))),
        db.execute(select(func.avg(Feedback.rating))),
    )
    avg_trust = trust_r.scalar()
    avg_rating = rating_r.scalar()

    return AdminStatsResponse(
        total_users=total_users,
        total_workspaces=total_workspaces,
        total_documents=total_documents,
        total_queries=total_queries,
        total_chunks=0,
        avg_trust_score=round(float(avg_trust), 4) if avg_trust else None,
        avg_rating=round(float(avg_rating), 2) if avg_rating else None,
        total_feedback=total_feedback,
    )


@router.get("/logs", response_model=PaginatedResponse[AuditLogResponse])
async def get_audit_logs(
    page: int = 1,
    page_size: int = 50,
    action: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Get audit log entries (admin only)."""
    page_size = max(MIN_PAGE_SIZE, min(page_size, MAX_PAGE_SIZE))

    query = select(AuditLog)
    count_query = select(func.count(AuditLog.id))

    if action:
        query = query.where(AuditLog.action == action)
        count_query = count_query.where(AuditLog.action == action)

    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0

    offset = (page - 1) * page_size
    result = await db.execute(
        query.order_by(AuditLog.created_at.desc()).offset(offset).limit(page_size)
    )
    logs = result.scalars().all()

    return PaginatedResponse(
        data=[
            AuditLogResponse(
                id=log.id,
                user_id=log.user_id,
                action=log.action,
                resource_type=log.resource_type,
                resource_id=log.resource_id,
                details=json.loads(log.details) if log.details else None,
                ip_address=log.ip_address,
                created_at=log.created_at,
            )
            for log in logs
        ],
        meta={"page": page, "page_size": page_size, "total": total},
    )


@router.get("/evaluation", response_model=EvaluationResponse)
async def get_evaluation(db: AsyncSession = Depends(get_db)):
    """Get RAGAS evaluation scores (admin only)."""

    try:
        with open("data/evaluation_results.json") as f:
            data = json.load(f)
        return EvaluationResponse(
            faithfulness=data.get("faithfulness"),
            answer_relevance=data.get("answer_relevance"),
            context_precision=data.get("context_precision"),
            context_recall=data.get("context_recall"),
            answer_correctness=data.get("answer_correctness"),
            last_updated=datetime.fromisoformat(data["last_updated"]) if data.get("last_updated") else None,
        )
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        return EvaluationResponse()


@router.post("/evaluation/run", status_code=202)
async def run_evaluation(db: AsyncSession = Depends(get_db)):
    """Trigger RAGAS evaluation on golden dataset (admin only)."""
    from app.evaluation.ragas_eval import ragas_evaluate

    result = await db.execute(
        select(Query).where(
            Query.response_text.isnot(None),
            Query.trust_score.isnot(None),
        ).order_by(func.random()).limit(20)
    )
    queries = result.scalars().all()

    if not queries:
        return {"message": "No queries with responses found for evaluation"}

    q_texts = [q.query_text for q in queries]
    answers = [q.response_text or "" for q in queries]
    contexts = []
    for q in queries:
        try:
            sources = json.loads(q.response_sources or "[]")
            ctx = [s.get("excerpt", s.get("content", "")) for s in sources]
        except (json.JSONDecodeError, TypeError):
            ctx = []
        contexts.append(ctx)

    scores = await ragas_evaluate(q_texts, answers, contexts)

    import json as json_mod

    results_data = {
        "faithfulness": scores.faithfulness,
        "answer_relevance": scores.answer_relevance,
        "context_precision": scores.context_precision,
        "context_recall": scores.context_recall,
        "answer_correctness": scores.answer_correctness,
        "last_updated": datetime.now(timezone.utc).isoformat(),
    }

    from pathlib import Path
    eval_path = Path("data/evaluation_results.json")
    eval_path.parent.mkdir(parents=True, exist_ok=True)
    with open(eval_path, "w") as f:
        json_mod.dump(results_data, f)

    logger.info("evaluation_run_complete", scores=vars(scores))
    return {"message": "Evaluation complete", "scores": vars(scores)}


# ─── User Management ────────────────────────────────────────────────


@router.get("/users", response_model=PaginatedResponse[UserResponse])
async def list_users(
    page: int = 1,
    page_size: int = 50,
    db: AsyncSession = Depends(get_db),
):
    """List all users with pagination (admin only)."""
    page_size = max(MIN_PAGE_SIZE, min(page_size, MAX_PAGE_SIZE))

    count_result = await db.execute(select(func.count(User.id)))
    total = count_result.scalar() or 0

    offset = (page - 1) * page_size
    result = await db.execute(
        select(User).order_by(User.created_at.desc()).offset(offset).limit(page_size)
    )
    users = result.scalars().all()

    return PaginatedResponse(
        data=[
            UserResponse(
                id=u.id,
                email=u.email,
                username=u.username,
                role=u.role,
                is_active=u.is_active,
                created_at=u.created_at,
                updated_at=u.updated_at,
            )
            for u in users
        ],
        meta={"page": page, "page_size": page_size, "total": total},
    )


@router.post("/users/invite", response_model=UserResponse, status_code=201)
async def invite_user(
    body: UserInviteRequest,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Invite a new user (admin only). Creates with temporary password."""
    # Check uniqueness
    email_exists = await db.execute(select(User).where(User.email == body.email))
    user_exists = await db.execute(select(User).where(User.username == body.username))
    if email_exists.scalar_one_or_none() or user_exists.scalar_one_or_none():
        raise ConflictException("Email or username already registered")

    temp_password = secrets.token_urlsafe(12)
    user = User(
        email=body.email,
        username=body.username,
        password_hash=hash_password(temp_password),
        role=body.role,
        is_active=True,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)

    db.add(AuditLog(
        user_id=current_user.id,
        action="user.invite",
        resource_type="user",
        resource_id=user.id,
        details=json.dumps({"email": body.email, "username": body.username, "role": body.role}),
    ))

    return UserResponse(
        id=user.id,
        email=user.email,
        username=user.username,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


@router.get("/users/{user_id}", response_model=UserDetailResponse)
async def get_user_detail(
    user_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get full user detail (admin only)."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise NotFoundException("User", user_id)

    query_count = await db.execute(
        select(func.count(Query.id)).where(Query.user_id == user_id)
    )

    return UserDetailResponse(
        id=user.id,
        email=user.email,
        username=user.username,
        role=user.role,
        is_active=user.is_active,
        query_count=query_count.scalar() or 0,
        last_login_at=user.last_login_at,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


@router.put("/users/{user_id}/role", response_model=UserResponse)
async def update_user_role(
    user_id: str,
    body: UserRoleUpdate,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update user role (admin only)."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise NotFoundException("User", user_id)

    user.role = body.role

    db.add(AuditLog(
        user_id=current_user.id,
        action="user.role_update",
        resource_type="user",
        resource_id=user_id,
        details=json.dumps({"new_role": body.role}),
    ))

    return UserResponse(
        id=user.id,
        email=user.email,
        username=user.username,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


@router.put("/users/{user_id}/status", response_model=UserResponse)
async def update_user_status(
    user_id: str,
    body: UserStatusUpdate,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Activate or deactivate user (admin only)."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise NotFoundException("User", user_id)

    user.is_active = body.is_active

    db.add(AuditLog(
        user_id=current_user.id,
        action="user.status_update",
        resource_type="user",
        resource_id=user_id,
        details=json.dumps({"is_active": body.is_active}),
    ))

    return UserResponse(
        id=user.id,
        email=user.email,
        username=user.username,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: str,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Soft-delete user by deactivating (admin only)."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise NotFoundException("User", user_id)

    user.is_active = False

    db.add(AuditLog(
        user_id=current_user.id,
        action="user.deactivate",
        resource_type="user",
        resource_id=user_id,
    ))


@router.get("/users/{user_id}/activity", response_model=PaginatedResponse[UserActivityResponse])
async def get_user_activity(
    user_id: str,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """Get query history for a specific user (admin only)."""
    page_size = max(MIN_PAGE_SIZE, min(page_size, MAX_PAGE_SIZE))

    result = await db.execute(select(User).where(User.id == user_id))
    if not result.scalar_one_or_none():
        raise NotFoundException("User", user_id)

    count_query = select(func.count(Query.id)).where(Query.user_id == user_id)
    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0

    offset = (page - 1) * page_size
    query_result = await db.execute(
        select(Query)
        .where(Query.user_id == user_id)
        .order_by(Query.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    queries = query_result.scalars().all()

    return PaginatedResponse(
        data=[
            UserActivityResponse(
                id=q.id,
                query_text=q.query_text,
                trust_score=q.trust_score,
                created_at=q.created_at,
            )
            for q in queries
        ],
        meta={"page": page, "page_size": page_size, "total": total},
    )


# ─── Analytics ──────────────────────────────────────────────────────


@router.get("/analytics/flagged-answers", response_model=PaginatedResponse[FlaggedAnswerResponse])
async def get_flagged_answers(
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """Return queries with low trust scores (admin only)."""
    page_size = max(MIN_PAGE_SIZE, min(page_size, MAX_PAGE_SIZE))

    count_query = select(func.count(Query.id)).where(
        Query.trust_score.isnot(None),
        Query.trust_score < TRUST_SCORE_LOW_THRESHOLD,
    )
    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0

    offset = (page - 1) * page_size
    result = await db.execute(
        select(Query)
        .where(
            Query.trust_score.isnot(None),
            Query.trust_score < TRUST_SCORE_LOW_THRESHOLD,
        )
        .order_by(Query.trust_score.asc())
        .offset(offset)
        .limit(page_size)
    )
    queries = result.scalars().all()

    responses = []
    for q in queries:
        responses.append(FlaggedAnswerResponse(
            id=q.id,
            query_text=q.query_text,
            response_text=q.response_text,
            trust_score=q.trust_score,
            user_name=q.user.username if q.user else None,
            workspace_name=q.workspace.name if q.workspace else None,
            created_at=q.created_at,
        ))

    return PaginatedResponse(
        data=responses,
        meta={"page": page, "page_size": page_size, "total": total},
    )


@router.get("/analytics/queries-over-time", response_model=list[UsageStatsResponse])
async def get_queries_over_time(
    days: int = 30,
    db: AsyncSession = Depends(get_db),
):
    """Return daily query count for last N days (admin only)."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    # Single grouped aggregation — the database buckets rows by day, so only
    # one row per day is returned regardless of table size.
    result = await db.execute(
        select(
            func.date(Query.created_at).label("date"),
            func.count(Query.id).label("query_count"),
        )
        .where(Query.created_at >= cutoff)
        .group_by(func.date(Query.created_at))
        .order_by(func.date(Query.created_at))
    )
    rows = result.all()

    return [
        UsageStatsResponse(
            date=str(row.date),
            query_count=row.query_count,
            user_count=0,
        )
        for row in rows
    ]


@router.get("/analytics/trust-score-distribution", response_model=list[TrustScoreDistribution])
async def get_trust_score_distribution(
    db: AsyncSession = Depends(get_db),
):
    """Return count of queries in trust score buckets (admin only)."""
    # Single aggregation pass — all four buckets counted in one query via
    # conditional CASE expressions, returning exactly one row.
    result = await db.execute(
        select(
            func.count(case((Query.trust_score.between(0.0, 0.25), 1))).label("bucket_0_25"),
            func.count(case((Query.trust_score.between(0.26, 0.50), 1))).label("bucket_26_50"),
            func.count(case((Query.trust_score.between(0.51, 0.75), 1))).label("bucket_51_75"),
            func.count(case((Query.trust_score.between(0.76, 1.0), 1))).label("bucket_76_100"),
        ).where(Query.trust_score.isnot(None))
    )
    row = result.one()

    return [
        TrustScoreDistribution(range="0-25", count=row.bucket_0_25 or 0),
        TrustScoreDistribution(range="26-50", count=row.bucket_26_50 or 0),
        TrustScoreDistribution(range="51-75", count=row.bucket_51_75 or 0),
        TrustScoreDistribution(range="76-100", count=row.bucket_76_100 or 0),
    ]


# ─── Evaluation history ─────────────────────────────────────────────


@router.get("/evaluation/history", response_model=PaginatedResponse[EvalRunResponse])
async def get_evaluation_history(
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """Get all past eval runs (admin only)."""
    page_size = max(MIN_PAGE_SIZE, min(page_size, MAX_PAGE_SIZE))

    count_result = await db.execute(select(func.count(EvalRun.id)))
    total = count_result.scalar() or 0

    offset = (page - 1) * page_size
    result = await db.execute(
        select(EvalRun).order_by(EvalRun.run_at.desc()).offset(offset).limit(page_size)
    )
    runs = result.scalars().all()

    return PaginatedResponse(
        data=[
            EvalRunResponse(
                id=r.id,
                run_at=r.run_at,
                faithfulness=r.faithfulness,
                context_precision=r.context_precision,
                context_recall=r.context_recall,
                answer_relevance=r.answer_relevance,
                answer_correctness=r.answer_correctness,
                refusal_accuracy=r.refusal_accuracy,
                golden_set_version=r.golden_set_version,
            )
            for r in runs
        ],
        meta={"page": page, "page_size": page_size, "total": total},
    )


# ─── Settings ────────────────────────────────────────────────────────


@router.get("/settings", response_model=AdminSettingsResponse)
async def get_admin_settings():
    """Get current app settings (admin only)."""
    return AdminSettingsResponse(
        app_name=settings.APP_NAME,
        app_version=settings.APP_VERSION,
        max_upload_size_mb=settings.SERVER_MAX_UPLOAD_SIZE // 1024 // 1024,
        trust_score_high_threshold=settings.GUARDRAIL_THRESHOLD,
        trust_score_low_threshold=_settings_overrides.get("trust_score_low_threshold", TRUST_SCORE_LOW_THRESHOLD),
        rate_limit_enabled=_settings_overrides.get("rate_limit_enabled", settings.RATE_LIMIT_ENABLED),
        rate_limit_requests=_settings_overrides.get("rate_limit_requests", settings.RATE_LIMIT_REQUESTS),
        rate_limit_window_seconds=_settings_overrides.get("rate_limit_window_seconds", settings.RATE_LIMIT_WINDOW),
    )


@router.put("/settings", response_model=AdminSettingsResponse)
async def update_admin_settings(body: AdminSettingsUpdate):
    """Update app settings in-memory (admin only, reset on restart)."""
    if body.max_upload_size_mb is not None:
        _settings_overrides["max_upload_size_mb"] = body.max_upload_size_mb
    if body.trust_score_high_threshold is not None:
        _settings_overrides["trust_score_high_threshold"] = body.trust_score_high_threshold
    if body.trust_score_low_threshold is not None:
        _settings_overrides["trust_score_low_threshold"] = body.trust_score_low_threshold
    if body.rate_limit_enabled is not None:
        _settings_overrides["rate_limit_enabled"] = body.rate_limit_enabled

    return await get_admin_settings()
