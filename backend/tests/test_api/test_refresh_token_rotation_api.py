"""Regression tests for stateful refresh-token rotation and revocation."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token, decode_token, hash_password
from app.models.refresh_token_session import RefreshTokenSession
from app.models.user import User


async def _register(client: AsyncClient, *, email: str = "rotation@example.com") -> dict:
    response = await client.post(
        "/api/auth/register",
        json={
            "email": email,
            "username": email.split("@")[0].replace(".", "").replace("-", "")[:32],
            "password": "SecureP@ss1",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _refresh_cookie(client: AsyncClient) -> str:
    token = client.cookies.get("refresh_token")
    assert token, "Expected the auth flow to set a refresh_token cookie"
    return token


async def _session(test_db: AsyncSession, token: str) -> RefreshTokenSession:
    token_id = decode_token(token)["jti"]
    result = await test_db.execute(
        select(RefreshTokenSession).where(RefreshTokenSession.id == token_id)
    )
    session = result.scalar_one_or_none()
    assert session is not None
    return session


@pytest.mark.asyncio
async def test_refresh_rotation_consumes_token_and_reuse_revokes_all_sessions(
    client: AsyncClient,
    test_db: AsyncSession,
):
    """A consumed refresh JWT cannot be reused to mint another token."""
    await _register(client)
    original_token = _refresh_cookie(client)

    rotated = await client.post(
        "/api/auth/refresh",
        json={"refresh_token": original_token},
    )
    assert rotated.status_code == 200, rotated.text
    replacement_token = _refresh_cookie(client)
    assert replacement_token != original_token

    original_session = await _session(test_db, original_token)
    replacement_session = await _session(test_db, replacement_token)
    assert original_session.revoked_at is not None
    assert original_session.revoked_reason == "rotated"
    assert original_session.replaced_by_id == replacement_session.id
    assert replacement_session.revoked_at is None

    # Replaying a consumed token is treated as a compromise signal and revokes
    # the still-active replacement session as well.
    replay = await client.post(
        "/api/auth/refresh",
        json={"refresh_token": original_token},
    )
    assert replay.status_code == 401
    assert replay.json()["error"]["code"] == "UNAUTHORIZED"

    await test_db.refresh(replacement_session)
    assert replacement_session.revoked_at is not None
    assert replacement_session.revoked_reason == "refresh_token_reuse_detected"

    retry_replacement = await client.post(
        "/api/auth/refresh",
        json={"refresh_token": replacement_token},
    )
    assert retry_replacement.status_code == 401


@pytest.mark.asyncio
async def test_logout_revokes_the_refresh_cookie_session(
    client: AsyncClient,
    test_db: AsyncSession,
):
    """Logout must invalidate a captured copy of the refresh JWT."""
    await _register(client, email="logout-session@example.com")
    refresh_token = _refresh_cookie(client)

    response = await client.post("/api/auth/logout", json={})
    assert response.status_code == 200, response.text

    session = await _session(test_db, refresh_token)
    assert session.revoked_at is not None
    assert session.revoked_reason == "logout"

    stolen_token_attempt = await client.post(
        "/api/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    assert stolen_token_attempt.status_code == 401


@pytest.mark.asyncio
async def test_password_change_revokes_all_refresh_sessions(
    client: AsyncClient,
    test_db: AsyncSession,
):
    """Password changes cannot leave refresh sessions usable."""
    await _register(client, email="password-session@example.com")
    refresh_token = _refresh_cookie(client)

    response = await client.post(
        "/api/auth/change-password",
        json={
            "current_password": "SecureP@ss1",
            "new_password": "ChangedP@ss2",
        },
    )
    assert response.status_code == 200, response.text

    session = await _session(test_db, refresh_token)
    assert session.revoked_at is not None
    assert session.revoked_reason == "password_changed"

    refresh_after_password_change = await client.post(
        "/api/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    assert refresh_after_password_change.status_code == 401


@pytest.mark.asyncio
async def test_admin_deactivation_revokes_refresh_sessions(
    client: AsyncClient,
    test_db: AsyncSession,
):
    """Reactivating later cannot resurrect a refresh session revoked on disable."""
    registration = await _register(client, email="deactivate-session@example.com")
    refresh_token = _refresh_cookie(client)
    target_user_id = registration["user"]["id"]

    admin = User(
        email="session-admin@example.com",
        username="sessionadmin",
        password_hash=hash_password("AdminPass1"),
        role="admin",
        is_active=True,
    )
    test_db.add(admin)
    await test_db.commit()
    admin_headers = {
        "Authorization": f"Bearer {create_access_token(admin.id, admin.role)}"
    }

    deactivated = await client.put(
        f"/api/admin/users/{target_user_id}/status",
        json={"is_active": False},
        headers=admin_headers,
    )
    assert deactivated.status_code == 200, deactivated.text

    session = await _session(test_db, refresh_token)
    assert session.revoked_at is not None
    assert session.revoked_reason == "admin_deactivated"

    reactivated = await client.put(
        f"/api/admin/users/{target_user_id}/status",
        json={"is_active": True},
        headers=admin_headers,
    )
    assert reactivated.status_code == 200, reactivated.text

    refresh_after_reactivation = await client.post(
        "/api/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    assert refresh_after_reactivation.status_code == 401
