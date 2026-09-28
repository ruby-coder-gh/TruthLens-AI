"""Tests for PUT /api/admin/users/{id}/role and /status: last_login_at must
survive the response (R2-11).

A confirmed role or status change returned `last_login_at: null` regardless
of the real value, so the frontend's `{...prev, ...updated}` merge overwrote
"Sep 28, 2026, 09:41 PM" with "Never".
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import hash_password
from app.models.user import User


LOGGED_IN_AT = datetime(2026, 9, 28, 21, 41, 0, tzinfo=timezone.utc)


@pytest.fixture
async def logged_in_user(test_db: AsyncSession) -> User:
    user = User(
        email="everloggedin@example.com",
        username="everloggedinuser",
        password_hash=hash_password("LoginPass1"),
        role="user",
        is_active=True,
        last_login_at=LOGGED_IN_AT,
    )
    test_db.add(user)
    await test_db.commit()
    await test_db.refresh(user)
    return user


@pytest.mark.asyncio
async def test_role_update_response_keeps_last_login_at(
    client: AsyncClient, admin_headers: dict[str, str], logged_in_user: User
):
    resp = await client.put(
        f"/api/admin/users/{logged_in_user.id}/role",
        json={"role": "admin"},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["last_login_at"] is not None
    parsed = datetime.fromisoformat(body["last_login_at"].replace("Z", "+00:00"))
    assert parsed == LOGGED_IN_AT


@pytest.mark.asyncio
async def test_status_update_response_keeps_last_login_at(
    client: AsyncClient, admin_headers: dict[str, str], logged_in_user: User
):
    resp = await client.put(
        f"/api/admin/users/{logged_in_user.id}/status",
        json={"is_active": False},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["last_login_at"] is not None
    parsed = datetime.fromisoformat(body["last_login_at"].replace("Z", "+00:00"))
    assert parsed == LOGGED_IN_AT


@pytest.mark.asyncio
async def test_role_update_response_is_null_when_never_logged_in(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession
):
    """A user who has genuinely never logged in still gets a correct (null,
    not fabricated) value back."""
    user = User(
        email="neverloggedin2@example.com",
        username="neverloggedinuser2",
        password_hash=hash_password("NeverPass1"),
        role="user",
        is_active=True,
    )
    test_db.add(user)
    await test_db.commit()
    await test_db.refresh(user)

    resp = await client.put(
        f"/api/admin/users/{user.id}/role",
        json={"role": "admin"},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["last_login_at"] is None
