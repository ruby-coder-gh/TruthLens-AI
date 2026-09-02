"""Admin routes: /api/admin/*"""

from __future__ import annotations

import asyncio
import json
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, field_serializer, field_validator
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import APIRouter, Depends, Response

from app.config import settings
from app.core.auth import hash_password
from app.core.refresh_tokens import revoke_all_refresh_tokens
from app.core.deps import get_current_admin, get_db
from app.core.exceptions import ConflictException, NotFoundException
from app.evaluation.golden_store import golden_counts, golden_set_version, load_promoted_entries
from app.models.audit_log import AuditLog
from app.models.chunk_quarantine import ChunkQuarantine
from app.models.document import Document
from app.models.eval_run import EvalRun
from app.models.feedback import Feedback
from app.models.golden_entry import GoldenEntry
from app.models.query import Query
from app.models.user import User
from app.models.workspace import Workspace
from app.report_export import rows_to_csv
from app.schemas._datetime import utc_iso
from app.schemas.analytics import (
    AdminSettingsResponse,
    AdminSettingsUpdate,
    EvalRunResponse,
    FlaggedAnswerResponse,
    PricingResponse,
    TrustScoreDistribution,
    UsageReportResponse,
    UsageRow,
    UsageStatsResponse,
    UsageTotals,
    UserActivityResponse,
)
from app.schemas.common import AdminStatsResponse, AuditLogResponse, EvaluationResponse, PaginatedResponse
from app.schemas.golden import GoldenEntryResponse
from app.schemas.quarantine import QuarantineChunkResponse, to_quarantine_response
from app.schemas.user import UserResponse
from app.utils.logger import logger

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(get_current_admin)])

# In-memory settings overrides (reset on restart)
_settings_overrides: dict[str, Any] = {}

TRUST_SCORE_LOW_THRESHOLD = 0.4
MIN_PAGE_SIZE = 1
MAX_PAGE_SIZE = 100


def _to_naive_utc(dt: datetime | None) -> datetime | None:
    """Normalize an optional (possibly tz-aware) datetime to naive UTC.

    Stored timestamps (`created_at` columns) are naive UTC on SQLite (see
    `app/schemas/_datetime.py`), so incoming filter bounds must match that
    representation for the SQL comparison to be correct.
    """
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


_DATE_ONLY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _end_of_day_if_date_only(value: Any) -> Any:
    """Widen a bare `date_to=YYYY-MM-DD` query value to the end of that day.

    A bare date has no time component, so the default `datetime` parsing
    used for query params anchors it at midnight -- which makes
    `date_to=2026-08-31` exclude the entire day instead of including it, and
    is the root cause of "last day missing" bugs in the usage report and
    audit-log exports. This normalises a date-only value to
    `23:59:59.999999` of that day (naive, later converted to UTC by
    `_to_naive_utc`) so the whole day is included.

    A value that already carries a time component -- including the
    frontend's own `...T23:59:59.999` end-of-day marker, or an explicit
    `...T00:00:00` -- is left untouched; only date-only strings are
    ambiguous enough to need widening. This is idempotent: re-applying it to
    an already-widened value (which has a time component) is a no-op.
    """
    if isinstance(value, str) and _DATE_ONLY_RE.match(value.strip()):
        return f"{value.strip()}T23:59:59.999999"
    return value


# Shared annotated type for every `date_to` query param (usage report/export,
# audit-log list/export) so the end-of-day widening above is applied
# uniformly by FastAPI's parameter parsing, before any handler code runs.
DateToQuery = Annotated[datetime | None, BeforeValidator(_end_of_day_if_date_only)]


def _export_timestamp() -> str:
    """UTC timestamp suitable for embedding in export filenames."""
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


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

    _serialize_last_login_at = field_serializer("last_login_at")(utc_iso)
    _serialize_created_at = field_serializer("created_at")(utc_iso)
    _serialize_updated_at = field_serializer("updated_at")(utc_iso)


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

    trust_r, rating_r, cache_hits_r = await asyncio.gather(
        db.execute(select(func.avg(Query.trust_score)).where(Query.trust_score.isnot(None))),
        db.execute(select(func.avg(Feedback.rating))),
        db.execute(select(func.coalesce(func.sum(Query.cache_hit_count), 0))),
    )
    avg_trust = trust_r.scalar()
    avg_rating = rating_r.scalar()
    query_cache_hits = int(cache_hits_r.scalar() or 0)
    cache_request_count = total_queries + query_cache_hits

    return AdminStatsResponse(
        total_users=total_users,
        total_workspaces=total_workspaces,
        total_documents=total_documents,
        total_queries=total_queries,
        total_chunks=0,
        avg_trust_score=round(float(avg_trust), 4) if avg_trust else None,
        avg_rating=round(float(avg_rating), 2) if avg_rating else None,
        total_feedback=total_feedback,
        query_cache_hits=query_cache_hits,
        query_cache_hit_rate=round(query_cache_hits / cache_request_count, 4) if cache_request_count else None,
    )


def _apply_audit_log_filters(
    stmt: Any,
    *,
    action: str | None,
    q: str | None,
    user_id: str | None,
    resource_type: str | None,
    date_from: datetime | None,
    date_to: datetime | None,
) -> Any:
    """Apply the shared audit-log filter set to a select(...) statement.

    Used for both the data query and the count query (list endpoint) and
    the export query, so filtering stays identical across all three.
    """
    if action:
        stmt = stmt.where(AuditLog.action == action)

    if q:
        search_term = f"%{q.strip()}%"
        stmt = stmt.where(or_(
            AuditLog.action.ilike(search_term),
            AuditLog.resource_type.ilike(search_term),
            AuditLog.resource_id.ilike(search_term),
            AuditLog.details.ilike(search_term),
            AuditLog.ip_address.ilike(search_term),
        ))

    if user_id:
        stmt = stmt.where(AuditLog.user_id == user_id)

    if resource_type:
        stmt = stmt.where(AuditLog.resource_type == resource_type)

    naive_from = _to_naive_utc(date_from)
    if naive_from:
        stmt = stmt.where(AuditLog.created_at >= naive_from)

    naive_to = _to_naive_utc(date_to)
    if naive_to:
        stmt = stmt.where(AuditLog.created_at <= naive_to)

    return stmt


@router.get("/logs", response_model=PaginatedResponse[AuditLogResponse])
async def get_audit_logs(
    page: int = 1,
    page_size: int = 50,
    action: str | None = None,
    q: str | None = None,
    user_id: str | None = None,
    resource_type: str | None = None,
    date_from: datetime | None = None,
    date_to: DateToQuery = None,
    db: AsyncSession = Depends(get_db),
):
    """Get audit log entries (admin only).

    `q` performs a case-insensitive substring match across the meaningful
    text columns (action, resource_type, resource_id, details, ip_address).
    `user_id`/`resource_type` are exact matches; `date_from`/`date_to` (ISO
    8601) bound `created_at` inclusively. A bare date (no time component)
    given for `date_from` anchors at the start of that day (00:00:00); a
    bare date given for `date_to` is widened to the end of that day
    (23:59:59.999999) so the whole day is included. Either bound with an
    explicit time component (e.g. `...T00:00:00` or the frontend's
    `...T23:59:59.999`) is used exactly as given.
    """
    page_size = max(MIN_PAGE_SIZE, min(page_size, MAX_PAGE_SIZE))

    query = _apply_audit_log_filters(
        select(AuditLog), action=action, q=q, user_id=user_id,
        resource_type=resource_type, date_from=date_from, date_to=date_to,
    )
    count_query = _apply_audit_log_filters(
        select(func.count(AuditLog.id)), action=action, q=q, user_id=user_id,
        resource_type=resource_type, date_from=date_from, date_to=date_to,
    )

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


@router.get("/logs/export")
async def export_audit_logs(
    format: Literal["csv", "json"] = "csv",
    action: str | None = None,
    q: str | None = None,
    user_id: str | None = None,
    resource_type: str | None = None,
    date_from: datetime | None = None,
    date_to: DateToQuery = None,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Export audit log entries as CSV or JSON (admin only).

    Bypasses the list endpoint's page-size clamp but hard-caps the result at
    `AUDIT_EXPORT_MAX_ROWS`, ordered newest-first. The export itself is
    audited (mirrors `investigations.py` audit-bundle export). See
    `get_audit_logs` for `date_from`/`date_to` bare-date-vs-explicit-time
    semantics.
    """
    stmt = _apply_audit_log_filters(
        select(AuditLog),
        action=action, q=q, user_id=user_id, resource_type=resource_type,
        date_from=date_from, date_to=date_to,
    )
    stmt = stmt.order_by(AuditLog.created_at.desc()).limit(settings.AUDIT_EXPORT_MAX_ROWS)
    result = await db.execute(stmt)
    logs = result.scalars().all()

    ts = _export_timestamp()
    filters_summary = {
        "action": action,
        "q": q,
        "user_id": user_id,
        "resource_type": resource_type,
        "date_from": utc_iso(date_from),
        "date_to": utc_iso(date_to),
    }

    if format == "json":
        payload = [
            AuditLogResponse(
                id=log.id,
                user_id=log.user_id,
                action=log.action,
                resource_type=log.resource_type,
                resource_id=log.resource_id,
                details=json.loads(log.details) if log.details else None,
                ip_address=log.ip_address,
                created_at=log.created_at,
            ).model_dump(mode="json")
            for log in logs
        ]
        content: str = json.dumps(payload)
        media_type = "application/json"
        filename = f"audit-log-{ts}.json"
    else:
        headers = ["id", "created_at", "user_id", "action", "resource_type", "resource_id", "ip_address", "details"]
        csv_rows = [
            [
                log.id,
                utc_iso(log.created_at),
                log.user_id or "",
                log.action,
                log.resource_type,
                log.resource_id or "",
                log.ip_address or "",
                log.details or "",
            ]
            for log in logs
        ]
        content = rows_to_csv(headers, csv_rows)
        media_type = "text/csv"
        filename = f"audit-log-{ts}.csv"

    db.add(AuditLog(
        user_id=current_user.id,
        action="audit.export",
        resource_type="audit_log",
        details=json.dumps({"format": format, "filters": filters_summary, "row_count": len(logs)}),
    ))

    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/quarantine", response_model=PaginatedResponse[QuarantineChunkResponse])
async def list_all_quarantined_chunks(
    page: int = 1,
    page_size: int = 50,
    status: str | None = None,
    workspace_id: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Cross-workspace list of ingest-time quarantined chunks (admin only).

    Joins `Document.original_filename` explicitly rather than walking the
    `ChunkQuarantine.document` relationship (`lazy="raise"`) — `Document`
    eagerly `selectin`-loads every full chunk body via `Document.chunks`.
    """
    page_size = max(MIN_PAGE_SIZE, min(page_size, MAX_PAGE_SIZE))

    filters = []
    if status:
        filters.append(ChunkQuarantine.status == status)
    if workspace_id:
        filters.append(ChunkQuarantine.workspace_id == workspace_id)

    count_query = select(func.count(ChunkQuarantine.id))
    query = select(ChunkQuarantine, Document.original_filename).outerjoin(
        Document, Document.id == ChunkQuarantine.document_id
    )
    if filters:
        count_query = count_query.where(*filters)
        query = query.where(*filters)

    total = (await db.execute(count_query)).scalar() or 0
    rows = (await db.execute(
        query.order_by(ChunkQuarantine.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    )).all()

    return PaginatedResponse(
        data=[to_quarantine_response(record, document_name) for record, document_name in rows],
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


DEFAULT_EVAL_SMOKE_LIMIT = 5


def _write_evaluation_snapshot(summary: dict[str, Any]) -> None:
    """Write `data/evaluation_results.json` from a pipeline summary.

    Shared by the background golden-set run so `GET /admin/evaluation` (the
    file snapshot) keeps reflecting the most recent run. Best-effort: a
    write failure must not affect the already-persisted `EvalRun` row.
    """
    from pathlib import Path

    ragas_scores = summary.get("ragas_scores") or {}
    results_data = {
        "faithfulness": ragas_scores.get("faithfulness", summary.get("avg_guardrail_score")),
        "answer_relevance": ragas_scores.get("answer_relevance", summary.get("avg_word_f1")),
        "context_precision": ragas_scores.get("context_precision"),
        "context_recall": ragas_scores.get("context_recall"),
        "answer_correctness": ragas_scores.get("answer_correctness"),
        "last_updated": datetime.now(timezone.utc).isoformat(),
    }

    try:
        eval_path = Path("data/evaluation_results.json")
        eval_path.parent.mkdir(parents=True, exist_ok=True)
        with open(eval_path, "w") as f:
            json.dump(results_data, f)
    except OSError as e:  # noqa: BLE001 — best-effort snapshot
        logger.warning("evaluation_snapshot_write_failed", error=str(e))


async def _run_golden_eval_background(limit: int) -> None:
    """Background task: run the golden-set pipeline and persist an EvalRun row.

    Fire-and-forget (see `comparisons.py` for the same pattern). Must never
    raise into the event loop — a missing Ollama server or the `ragas`
    package not being installed should degrade gracefully (the pipeline and
    `_persist_eval_run` already tolerate both), but this wrapper is a final
    backstop so an unhandled exception never surfaces as a bare task error.
    """
    from evaluation.evaluate import evaluate_pipeline

    try:
        summary = await evaluate_pipeline(
            ollama_url=settings.OLLAMA_BASE_URL,
            model=settings.OLLAMA_PRIMARY_MODEL,
            limit=limit,
        )
        _write_evaluation_snapshot(summary)
        logger.info("evaluation_run_complete", limit=limit, completed=summary.get("completed"))
    except Exception as e:  # noqa: BLE001 — background task must never crash the loop
        logger.error("evaluation_run_failed", limit=limit, error=str(e))


@router.post("/evaluation/run", status_code=202)
async def run_evaluation(limit: int = DEFAULT_EVAL_SMOKE_LIMIT):
    """Trigger a golden-set evaluation run in the background (admin only).

    Runs the full golden-set pipeline (LLM generation + guardrail + RAGAS)
    against `data/evaluation_results.json` and a new `EvalRun` row. Defaults
    to a small smoke run (`limit=5`) so the endpoint stays fast to trigger;
    pass `?limit=` for a larger (or full, `limit=0`/omit to use default)
    pass. The run itself is slow (LLM calls per entry) so it's dispatched as
    a fire-and-forget background task — this endpoint returns immediately.
    """
    asyncio.create_task(_run_golden_eval_background(limit))

    return {
        "status": "queued",
        "message": f"Golden-set evaluation queued ({limit} entries).",
        "limit": limit,
    }


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
                last_login_at=u.last_login_at,
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
    if not user.is_active:
        await revoke_all_refresh_tokens(
            db,
            user_id=user.id,
            reason="admin_deactivated",
        )

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
    await revoke_all_refresh_tokens(
        db,
        user_id=user.id,
        reason="admin_deactivated",
    )

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


# ─── Usage & Cost Reporting ─────────────────────────────────────────

UsageGroupBy = Literal["user", "workspace", "model"]


def _parse_model_pricing() -> dict[str, dict[str, float]]:
    """Parse `settings.MODEL_PRICING_JSON` into a rate map.

    Malformed JSON, a non-dict top level, or a malformed per-model entry is
    dropped (never raises) — an unrecognized/unparseable model simply costs
    $0, same as a local Ollama model that was never priced.
    """
    try:
        raw = json.loads(settings.MODEL_PRICING_JSON or "{}")
    except (json.JSONDecodeError, TypeError):
        return {}
    if not isinstance(raw, dict):
        return {}

    parsed: dict[str, dict[str, float]] = {}
    for model, rates in raw.items():
        if not isinstance(rates, dict):
            continue
        try:
            parsed[model] = {
                "input_per_1k": float(rates.get("input_per_1k", 0) or 0),
                "output_per_1k": float(rates.get("output_per_1k", 0) or 0),
            }
        except (TypeError, ValueError):
            continue
    return parsed


def _model_cost(model: str, prompt_tokens: int, output_tokens: int, pricing: dict[str, dict[str, float]]) -> float:
    """Estimated cost for one model's token usage; $0 for an unpriced model."""
    rates = pricing.get(model)
    if not rates:
        return 0.0
    return (prompt_tokens / 1000) * rates.get("input_per_1k", 0.0) + (output_tokens / 1000) * rates.get("output_per_1k", 0.0)


async def _usage_rollup(
    db: AsyncSession,
    group_by: UsageGroupBy,
    date_from: datetime | None,
    date_to: datetime | None,
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, dict[str, float]]]:
    """Aggregate query usage grouped by user/workspace/model.

    The grouped `select(...)` always breaks out `model` as an extra grouping
    dimension (in addition to the requested `group_by` key) so that a group
    spanning more than one model (e.g. a user who queried both a local and a
    priced model) still gets a correct, per-model-weighted `est_cost_usd`
    instead of one blended rate applied to a mixed token pool. The per-model
    rows for the same key are merged in Python after the single query runs.
    """
    model_col = func.coalesce(Query.model_used, "unknown")
    # Heterogeneous across branches (labeled `coalesce(...)` expressions vs.
    # plain mapped columns) — typed loosely on purpose, only used to build
    # the SELECT/GROUP BY below.
    key_col: Any
    label_col: Any

    if group_by == "user":
        key_col = func.coalesce(Query.user_id, "unattributed")
        label_col = func.coalesce(User.username, "Unattributed")
        stmt = select(
            key_col.label("key"),
            label_col.label("label"),
            model_col.label("model"),
            func.count(Query.id).label("queries"),
            func.coalesce(func.sum(Query.token_count), 0).label("output_tokens"),
            func.coalesce(func.sum(Query.prompt_tokens), 0).label("prompt_tokens"),
            func.coalesce(func.sum(Query.latency_ms), 0).label("latency_sum"),
            func.coalesce(func.sum(Query.cache_hit_count), 0).label("cache_hits"),
        ).outerjoin(User, Query.user_id == User.id)
    elif group_by == "workspace":
        key_col = Workspace.id
        label_col = Workspace.name
        stmt = select(
            key_col.label("key"),
            label_col.label("label"),
            model_col.label("model"),
            func.count(Query.id).label("queries"),
            func.coalesce(func.sum(Query.token_count), 0).label("output_tokens"),
            func.coalesce(func.sum(Query.prompt_tokens), 0).label("prompt_tokens"),
            func.coalesce(func.sum(Query.latency_ms), 0).label("latency_sum"),
            func.coalesce(func.sum(Query.cache_hit_count), 0).label("cache_hits"),
        ).outerjoin(Workspace, Query.workspace_id == Workspace.id)
    else:  # model
        key_col = model_col
        label_col = model_col
        stmt = select(
            key_col.label("key"),
            label_col.label("label"),
            model_col.label("model"),
            func.count(Query.id).label("queries"),
            func.coalesce(func.sum(Query.token_count), 0).label("output_tokens"),
            func.coalesce(func.sum(Query.prompt_tokens), 0).label("prompt_tokens"),
            func.coalesce(func.sum(Query.latency_ms), 0).label("latency_sum"),
            func.coalesce(func.sum(Query.cache_hit_count), 0).label("cache_hits"),
        )

    naive_from = _to_naive_utc(date_from)
    if naive_from:
        stmt = stmt.where(Query.created_at >= naive_from)
    naive_to = _to_naive_utc(date_to)
    if naive_to:
        stmt = stmt.where(Query.created_at <= naive_to)

    stmt = stmt.group_by(key_col, label_col, model_col)
    result = await db.execute(stmt)
    raw_rows = result.all()

    pricing = _parse_model_pricing()
    merged: dict[str, dict[str, Any]] = {}
    for row in raw_rows:
        entry = merged.setdefault(row.key, {
            "key": row.key,
            "label": row.label,
            "queries": 0,
            "output_tokens": 0,
            "prompt_tokens": 0,
            "latency_sum": 0,
            "cache_hits": 0,
            "est_cost_usd": 0.0,
        })
        entry["queries"] += row.queries
        entry["output_tokens"] += row.output_tokens
        entry["prompt_tokens"] += row.prompt_tokens
        entry["latency_sum"] += row.latency_sum
        entry["cache_hits"] += row.cache_hits
        entry["est_cost_usd"] += _model_cost(row.model, row.prompt_tokens, row.output_tokens, pricing)

    rows_out: list[dict[str, Any]] = []
    totals = {"queries": 0, "output_tokens": 0, "prompt_tokens": 0, "latency_sum": 0, "cache_hits": 0, "est_cost_usd": 0.0}
    for entry in merged.values():
        avg_latency = round(entry["latency_sum"] / entry["queries"], 2) if entry["queries"] else None
        rows_out.append({
            "key": str(entry["key"]),
            "label": str(entry["label"]),
            "queries": entry["queries"],
            "output_tokens": entry["output_tokens"],
            "prompt_tokens": entry["prompt_tokens"],
            "avg_latency_ms": avg_latency,
            "cache_hits": entry["cache_hits"],
            "est_cost_usd": round(entry["est_cost_usd"], 8),
        })
        for k in ("queries", "output_tokens", "prompt_tokens", "latency_sum", "cache_hits"):
            totals[k] += entry[k]
        totals["est_cost_usd"] += entry["est_cost_usd"]

    rows_out.sort(key=lambda r: r["label"])
    totals_out = {
        "queries": totals["queries"],
        "output_tokens": totals["output_tokens"],
        "prompt_tokens": totals["prompt_tokens"],
        "avg_latency_ms": round(totals["latency_sum"] / totals["queries"], 2) if totals["queries"] else None,
        "cache_hits": totals["cache_hits"],
        "est_cost_usd": round(totals["est_cost_usd"], 8),
    }
    return rows_out, totals_out, pricing


@router.get("/usage", response_model=UsageReportResponse)
async def get_usage_report(
    group_by: UsageGroupBy = "model",
    date_from: datetime | None = None,
    date_to: DateToQuery = None,
    db: AsyncSession = Depends(get_db),
):
    """Usage & estimated cost rolled up by user/workspace/model (admin only).

    Cost is an *estimate*: `token_count` is currently output word-count (see
    `generator.py`) rather than true provider tokens, and only models present
    in `MODEL_PRICING_JSON` are priced — everything else (e.g. local Ollama
    models) costs $0.

    `date_from`/`date_to` bound `created_at` inclusively. A bare date (no
    time component) given for `date_from` anchors at the start of that day
    (00:00:00); a bare date given for `date_to` is widened to the end of
    that day (23:59:59.999999) so the whole day is included. Either bound
    with an explicit time component (e.g. `...T00:00:00` or the frontend's
    `...T23:59:59.999`) is used exactly as given.
    """
    rows, totals, pricing = await _usage_rollup(db, group_by, date_from, date_to)
    return UsageReportResponse(
        rows=[UsageRow(**row) for row in rows],
        totals=UsageTotals(**totals),
        pricing_source="config" if pricing else "none",
        period={"from": utc_iso(date_from), "to": utc_iso(date_to)},
    )


@router.get("/usage/pricing", response_model=PricingResponse)
async def get_usage_pricing():
    """Return the parsed `MODEL_PRICING_JSON` rate map (admin only)."""
    return PricingResponse(pricing=_parse_model_pricing())


@router.get("/usage/export")
async def export_usage_report(
    format: Literal["csv"] = "csv",
    group_by: UsageGroupBy = "model",
    date_from: datetime | None = None,
    date_to: DateToQuery = None,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Export the usage & cost rollup as CSV (admin only). Audited.

    See `get_usage_report` for `date_from`/`date_to` bare-date-vs-explicit-
    time semantics.
    """
    rows, _totals, _pricing = await _usage_rollup(db, group_by, date_from, date_to)

    headers = ["key", "label", "queries", "output_tokens", "prompt_tokens", "avg_latency_ms", "cache_hits", "est_cost_usd"]
    csv_rows = [
        [r["key"], r["label"], r["queries"], r["output_tokens"], r["prompt_tokens"], r["avg_latency_ms"], r["cache_hits"], r["est_cost_usd"]]
        for r in rows
    ]
    content = rows_to_csv(headers, csv_rows)
    filename = f"usage-{group_by}-{_export_timestamp()}.csv"

    db.add(AuditLog(
        user_id=current_user.id,
        action="usage.export",
        resource_type="usage_report",
        details=json.dumps({
            "group_by": group_by,
            "row_count": len(rows),
            "date_from": utc_iso(date_from),
            "date_to": utc_iso(date_to),
        }),
    ))

    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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
                notes=r.notes,
                status=r.status,
                prompt_version_id=r.prompt_version_id,
                model_used=r.model_used,
                subset=r.subset,
                verdict=r.verdict,
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


# ─── Golden set (F7b) ────────────────────────────────────────────────


def _builtin_golden_responses() -> list[GoldenEntryResponse]:
    """Builtin dataset entries in the same response shape as promoted rows.

    Synthetic ``builtin:<n>`` ids: the hard-coded dataset has no primary keys,
    and DELETE only ever matches a real ``golden_entries`` row, so a builtin
    entry can never be removed through this API.
    """
    from evaluation.golden_dataset import get_golden_dataset

    return [
        GoldenEntryResponse(
            id=f"builtin:{index}",
            question=entry.question,
            reference_answer=entry.reference_answer,
            source_documents=list(entry.source_documents),
            expected_grounding=entry.expected_grounding,
            category=entry.category,
            difficulty=entry.difficulty,
            notes=entry.notes or None,
            source="builtin",
        )
        for index, entry in enumerate(get_golden_dataset())
    ]


@router.get("/golden", response_model=PaginatedResponse[GoldenEntryResponse])
async def list_golden_entries(
    source: Literal["promoted", "builtin", "all"] = "promoted",
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """List golden-set entries with the version + builtin/promoted counts.

    Paginates over an in-memory merge: the builtin dataset is a fixed ~100-entry
    Python list, so there is nothing to gain from pushing this into SQL.
    """
    page = max(1, page)
    page_size = max(MIN_PAGE_SIZE, min(page_size, MAX_PAGE_SIZE))
    entries: list[GoldenEntryResponse] = []
    if source in ("builtin", "all"):
        entries.extend(_builtin_golden_responses())
    if source in ("promoted", "all"):
        entries.extend(GoldenEntryResponse.from_row(row) for row in await load_promoted_entries(db))
    offset = (page - 1) * page_size
    counts = await golden_counts(db)
    return PaginatedResponse(
        data=entries[offset:offset + page_size],
        meta={
            "page": page,
            "page_size": page_size,
            "total": len(entries),
            "source": source,
            "builtin_count": counts["builtin"],
            "promoted_count": counts["promoted"],
            "golden_set_version": await golden_set_version(db),
        },
    )


@router.delete("/golden/{entry_id}", status_code=204)
async def delete_golden_entry(
    entry_id: str,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Retire a promoted golden entry (builtin entries are not deletable)."""
    entry = (await db.execute(
        select(GoldenEntry).where(GoldenEntry.id == entry_id)
    )).scalar_one_or_none()
    if not entry:
        raise NotFoundException("GoldenEntry", entry_id)

    # Snapshot before the delete: the instance is unusable once flushed.
    details = json.dumps({
        "source_query_id": entry.source_query_id,
        "category": entry.category,
        "workspace_id": entry.workspace_id,
    })
    await db.delete(entry)
    await db.flush()
    db.add(AuditLog(
        user_id=current_user.id,
        action="golden.delete",
        resource_type="golden_entry",
        resource_id=entry_id,
        details=details,
    ))
    return None
