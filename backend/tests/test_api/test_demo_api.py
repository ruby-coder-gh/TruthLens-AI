"""Tests for the demo-mode API: /auth/demo-login, /health/ready, /suggestions."""

from __future__ import annotations

from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import settings
from app.core.auth import hash_password
from app.core.deps import get_db
from app.demo.corpus_builder import load_manifest
from app.main import create_app
from app.models.document import Document
from app.models.user import User
from app.models.workspace import Workspace


def _remote_client_factory(test_engine, client_addr: tuple[str, int]):
    """Same DB wiring as the `client` fixture, but with a chosen ASGI client address —
    for exercising loopback-only routes (demo-login) from a non-loopback caller."""

    async def _make() -> AsyncGenerator[AsyncClient, None]:
        app = create_app()
        session_factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

        async def _get_db_override():
            async with session_factory() as session:
                try:
                    yield session
                    await session.commit()
                except Exception:
                    await session.rollback()
                    raise

        app.dependency_overrides[get_db] = _get_db_override
        transport = ASGITransport(app=app, client=client_addr)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
        app.dependency_overrides.clear()

    return _make()


@pytest_asyncio.fixture
async def remote_client(test_engine) -> AsyncGenerator[AsyncClient, None]:
    """A client whose ASGI scope reports a LAN address, not loopback."""
    async for ac in _remote_client_factory(test_engine, ("203.0.113.5", 51715)):
        yield ac


@pytest_asyncio.fixture
async def ipv6_loopback_client(test_engine) -> AsyncGenerator[AsyncClient, None]:
    """A client whose ASGI scope reports the IPv6 loopback address."""
    async for ac in _remote_client_factory(test_engine, ("::1", 51715)):
        yield ac


async def _seed_demo_user(test_db: AsyncSession, *, email: str, username: str, role: str) -> User:
    user = User(
        email=email,
        username=username,
        password_hash=hash_password("Password123!"),
        role=role,
        is_active=True,
    )
    test_db.add(user)
    await test_db.commit()
    await test_db.refresh(user)
    return user


# ── demo-login ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_demo_login_404_when_demo_mode_disabled(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "DEMO_MODE", False)

    resp = await client.post("/api/auth/demo-login", json={"persona": "analyst"})

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_demo_login_404_in_production_even_if_demo_mode_set(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(settings, "DEMO_MODE", True)
    monkeypatch.setattr(settings, "APP_ENV", "production")

    resp = await client.post("/api/auth/demo-login", json={"persona": "analyst"})

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_demo_login_sets_cookies_for_seeded_persona(
    client: AsyncClient, test_db: AsyncSession, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(settings, "DEMO_MODE", True)
    monkeypatch.setattr(settings, "APP_ENV", "development")
    await _seed_demo_user(test_db, email="analyst@truthlens.dev", username="demo_analyst", role="user")

    resp = await client.post("/api/auth/demo-login", json={"persona": "analyst"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["user"]["email"] == "analyst@truthlens.dev"
    assert "access_token" in resp.cookies
    assert "refresh_token" in resp.cookies


@pytest.mark.asyncio
async def test_demo_login_unknown_persona_422(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "DEMO_MODE", True)
    monkeypatch.setattr(settings, "APP_ENV", "development")

    resp = await client.post("/api/auth/demo-login", json={"persona": "root"})

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_demo_login_401_when_persona_not_seeded(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "DEMO_MODE", True)
    monkeypatch.setattr(settings, "APP_ENV", "development")

    resp = await client.post("/api/auth/demo-login", json={"persona": "admin"})

    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_demo_login_404_for_non_loopback_client(
    remote_client: AsyncClient, test_db: AsyncSession, monkeypatch: pytest.MonkeyPatch
):
    """`run.sh --demo` binds uvicorn to 0.0.0.0; anyone on the LAN reaching this
    route would otherwise get an unauthenticated admin session. 404, not 403 —
    the route must reveal nothing about its existence to a non-loopback caller."""
    monkeypatch.setattr(settings, "DEMO_MODE", True)
    monkeypatch.setattr(settings, "APP_ENV", "development")
    await _seed_demo_user(test_db, email="admin@truthlens.dev", username="demo_admin", role="admin")

    resp = await remote_client.post("/api/auth/demo-login", json={"persona": "admin"})

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_demo_login_200_for_ipv6_loopback_client(
    ipv6_loopback_client: AsyncClient, test_db: AsyncSession, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(settings, "DEMO_MODE", True)
    monkeypatch.setattr(settings, "APP_ENV", "development")
    await _seed_demo_user(test_db, email="admin@truthlens.dev", username="demo_admin", role="admin")

    resp = await ipv6_loopback_client.post("/api/auth/demo-login", json={"persona": "admin"})

    assert resp.status_code == 200


# ── /health/ready ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_health_ready_reports_ollama_reachable(client: AsyncClient):
    fake_response = MagicMock()
    fake_response.status_code = 200
    fake_response.json.return_value = {"models": [{"name": settings.OLLAMA_PRIMARY_MODEL}]}

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=fake_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.api.demo.httpx.AsyncClient", return_value=mock_client):
        resp = await client.get("/api/health/ready")

    assert resp.status_code == 200
    body = resp.json()
    assert body["ollama"]["reachable"] is True
    assert body["ollama"]["model_present"] is True
    assert body["ollama"]["model"] == settings.OLLAMA_PRIMARY_MODEL
    assert "models" in body
    assert set(body["models"].keys()) == {"embedder", "reranker", "nli"}
    # No secrets: DEMO_PASSWORD (or anything resembling it) must never appear.
    assert "DEMO_PASSWORD" not in resp.text


@pytest.mark.asyncio
async def test_health_ready_reports_ollama_unreachable_on_error(client: AsyncClient):
    with patch("app.api.demo.httpx.AsyncClient", side_effect=RuntimeError("connection refused")):
        resp = await client.get("/api/health/ready")

    assert resp.status_code == 200
    body = resp.json()
    assert body["ollama"]["reachable"] is False
    assert body["ollama"]["model_present"] is False


# ── suggestions ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_suggestions_returns_manifest_questions_for_demo_workspace(
    client: AsyncClient, test_db: AsyncSession, auth_headers: dict[str, str]
):
    from app.core.auth import decode_token

    token = auth_headers["Authorization"].split(" ", 1)[1]
    user_id = decode_token(token)["sub"]
    manifest = load_manifest()
    workspace = Workspace(name=manifest["workspace_name"], owner_id=user_id)
    test_db.add(workspace)
    await test_db.commit()
    await test_db.refresh(workspace)

    resp = await client.get(f"/api/workspaces/{workspace.id}/suggestions", headers=auth_headers)

    assert resp.status_code == 200
    assert resp.json()["questions"] == manifest["suggested_questions"]


@pytest.mark.asyncio
async def test_suggestions_derives_from_ready_document_titles_capped_at_four(
    client: AsyncClient, test_db: AsyncSession, auth_headers: dict[str, str]
):
    from app.core.auth import decode_token

    token = auth_headers["Authorization"].split(" ", 1)[1]
    user_id = decode_token(token)["sub"]
    workspace = Workspace(name="Regular workspace", owner_id=user_id)
    test_db.add(workspace)
    await test_db.flush()
    for i, title in enumerate(["Contract A.pdf", "Contract B.pdf", "Contract C.pdf"]):
        test_db.add(Document(
            id=f"doc-{i}",
            workspace_id=workspace.id,
            filename=f"f{i}.pdf",
            original_filename=title,
            mime_type="application/pdf",
            file_size=10,
            status="ready",
            uploaded_by=user_id,
        ))
    await test_db.commit()

    resp = await client.get(f"/api/workspaces/{workspace.id}/suggestions", headers=auth_headers)

    assert resp.status_code == 200
    questions = resp.json()["questions"]
    # Exactly 2 documents' worth (Summarize + key-figures each) — which two,
    # among 3 candidates, is an ordering detail this test doesn't pin down.
    assert len(questions) == 4
    assert all(q.startswith("Summarize ") or q.startswith("What are the key figures in ") for q in questions)
    summarized = {q.removeprefix("Summarize ") for q in questions if q.startswith("Summarize ")}
    assert len(summarized) == 2
    assert summarized <= {"Contract A", "Contract B", "Contract C"}


@pytest.mark.asyncio
async def test_suggestions_empty_list_when_no_documents(
    client: AsyncClient, test_db: AsyncSession, auth_headers: dict[str, str]
):
    from app.core.auth import decode_token

    token = auth_headers["Authorization"].split(" ", 1)[1]
    user_id = decode_token(token)["sub"]
    workspace = Workspace(name="Empty workspace", owner_id=user_id)
    test_db.add(workspace)
    await test_db.commit()

    resp = await client.get(f"/api/workspaces/{workspace.id}/suggestions", headers=auth_headers)

    assert resp.status_code == 200
    assert resp.json()["questions"] == []


@pytest.mark.asyncio
async def test_suggestions_requires_workspace_access(
    client: AsyncClient, test_db: AsyncSession, auth_headers: dict[str, str], admin_headers: dict[str, str]
):
    """A user with no membership in the workspace is forbidden — access
    control, not just authentication."""
    from app.core.auth import decode_token

    admin_token = admin_headers["Authorization"].split(" ", 1)[1]
    admin_id = decode_token(admin_token)["sub"]
    workspace = Workspace(name="Someone else's workspace", owner_id=admin_id)
    test_db.add(workspace)
    await test_db.commit()

    resp = await client.get(f"/api/workspaces/{workspace.id}/suggestions", headers=auth_headers)

    assert resp.status_code == 403
