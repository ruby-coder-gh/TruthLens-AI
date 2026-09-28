"""Demo mode — owned by lane L9.

Routes: `GET /api/health/ready` (public), `POST /api/auth/demo-login`,
`GET /api/workspaces/{wid}/suggestions`.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import httpx
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import APIRouter, Depends, Request, Response

from app.api.auth import _set_auth_cookies
from app.config import settings
from app.core.auth import create_access_token
from app.core.deps import check_workspace_access, get_db
from app.core.exceptions import NotFoundException, UnauthorizedException
from app.core.refresh_tokens import issue_refresh_token
from app.demo import warmup
from app.demo.corpus_builder import load_manifest
from app.models.audit_log import AuditLog
from app.models.document import Document
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.auth import AuthResponse, UserInfo
from app.utils.logger import logger

router = APIRouter(tags=["demo"])

_DEMO_PERSONA_EMAILS = {
    "admin": "admin@truthlens.dev",
    "analyst": "analyst@truthlens.dev",
}

_MAX_DERIVED_SUGGESTIONS = 4
_SUGGESTIONS_PER_DOC = 2

# demo-login grants a full session with no credentials. run.sh --demo binds
# uvicorn to 0.0.0.0, so without this any LAN peer could self-serve an admin
# session; the Vite dev proxy always connects from loopback.
_LOOPBACK_HOSTS = {"127.0.0.1", "::1"}


class DemoLoginRequest(BaseModel):
    persona: Literal["analyst", "admin"]


class SuggestionsResponse(BaseModel):
    questions: list[str]


class OllamaHealth(BaseModel):
    reachable: bool
    model: str
    model_present: bool


class ModelsHealth(BaseModel):
    embedder: str
    reranker: str
    nli: str


class ReadyResponse(BaseModel):
    status: Literal["ok"]
    demo_mode: bool
    warm: bool
    ollama: OllamaHealth
    models: ModelsHealth
    demo_workspace_id: str | None


@router.post("/auth/demo-login", response_model=AuthResponse)
async def demo_login(
    body: DemoLoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """One-click login for a seeded demo persona.

    404 outside demo mode (never in production, even if DEMO_MODE was left
    on by mistake) and 404 for any non-loopback caller (it hands out a full
    session with no credentials) — both reveal nothing about the deployment.
    """
    if not settings.DEMO_MODE or settings.APP_ENV == "production":
        raise NotFoundException()
    if request.client is None or request.client.host not in _LOOPBACK_HOSTS:
        raise NotFoundException()

    email = _DEMO_PERSONA_EMAILS[body.persona]
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        raise UnauthorizedException("Demo user not seeded — run `python -m app.demo seed`")

    user.last_login_at = datetime.now(timezone.utc)

    access_token = create_access_token(user.id, user.role)
    refresh_token = await issue_refresh_token(db, user_id=user.id)
    _set_auth_cookies(response, access_token, refresh_token)

    db.add(AuditLog(
        user_id=user.id,
        action="auth.demo_login",
        resource_type="user",
        resource_id=user.id,
        details=json.dumps({"persona": body.persona}),
    ))

    return AuthResponse(
        user=UserInfo(
            id=user.id,
            email=user.email,
            username=user.username,
            role=user.role,
            created_at=user.created_at,
        ),
        expires_in=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.get("/health/ready", response_model=ReadyResponse)
async def health_ready(db: AsyncSession = Depends(get_db)) -> ReadyResponse:
    """Public readiness probe: is Ollama reachable with the primary model
    pulled, and have the embedder/reranker/NLI models finished warming up.
    No secrets (e.g. DEMO_PASSWORD) are ever included in the response.
    """
    ollama_reachable = False
    model_present = False
    try:
        async with httpx.AsyncClient(timeout=1.5) as http_client:
            resp = await http_client.get(f"{settings.OLLAMA_BASE_URL}/api/tags")
        if resp.status_code == 200:
            ollama_reachable = True
            names = {m.get("name", "") for m in resp.json().get("models", [])}
            model_present = any(
                name == settings.OLLAMA_PRIMARY_MODEL or name.startswith(f"{settings.OLLAMA_PRIMARY_MODEL}:")
                for name in names
            )
    except Exception as e:
        logger.debug("health_ready_ollama_probe_failed", error=str(e))

    demo_workspace_id = None
    if settings.DEMO_MODE:
        manifest = load_manifest()
        result = await db.execute(select(Workspace.id).where(Workspace.name == manifest["workspace_name"]))
        demo_workspace_id = result.scalar_one_or_none()

    return ReadyResponse(
        status="ok",
        demo_mode=settings.DEMO_MODE,
        warm=warmup.is_warm(),
        ollama=OllamaHealth(
            reachable=ollama_reachable,
            model=settings.OLLAMA_PRIMARY_MODEL,
            model_present=model_present,
        ),
        models=ModelsHealth(**warmup.get_state()),
        demo_workspace_id=demo_workspace_id,
    )


@router.get("/workspaces/{workspace_id}/suggestions", response_model=SuggestionsResponse)
async def get_suggestions(
    workspace_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    db: AsyncSession = Depends(get_db),
):
    """Suggested starter questions: the manifest's curated set for the demo
    workspace, otherwise up to 4 questions derived from ready documents'
    titles (empty list when the workspace has none)."""
    manifest = load_manifest()
    if workspace.name == manifest["workspace_name"]:
        return SuggestionsResponse(questions=manifest["suggested_questions"])

    result = await db.execute(
        select(Document.original_filename)
        .where(Document.workspace_id == workspace_id, Document.status == "ready")
        .order_by(Document.created_at.desc())
    )
    titles = [Path(name).stem for (name,) in result.all()]

    questions: list[str] = []
    for title in titles:
        questions.append(f"Summarize {title}")
        questions.append(f"What are the key figures in {title}?")
        if len(questions) >= _MAX_DERIVED_SUGGESTIONS:
            break

    return SuggestionsResponse(questions=questions[:_MAX_DERIVED_SUGGESTIONS])
