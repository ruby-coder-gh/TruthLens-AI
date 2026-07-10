"""Tests for GET /api/admin/users: last_login_at field + tz-aware timestamps.

Covers bug #7 (Users list missing "Last Login") and reinforces bug #9
(UTC-aware timestamp serialization) on the admin user list response.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import hash_password
from app.models.user import User


@pytest.mark.asyncio
async def test_admin_users_list_includes_last_login_at_when_set(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession
):
    """A user who has logged in shows a populated last_login_at, not omitted."""
    logged_in_at = datetime(2026, 7, 9, 3, 15, 0, tzinfo=timezone.utc)
    user = User(
        email="loggedin@example.com",
        username="loggedinuser",
        password_hash=hash_password("LoginPass1"),
        role="user",
        is_active=True,
        last_login_at=logged_in_at,
    )
    test_db.add(user)
    await test_db.commit()
    await test_db.refresh(user)

    resp = await client.get("/api/admin/users?page_size=100", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()

    match = next(item for item in body["data"] if item["id"] == user.id)
    assert match["last_login_at"] is not None
    parsed = datetime.fromisoformat(match["last_login_at"].replace("Z", "+00:00"))
    assert parsed.tzinfo is not None
    assert parsed == logged_in_at


@pytest.mark.asyncio
async def test_admin_users_list_last_login_at_null_when_never_logged_in(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession
):
    """A user who never logged in serializes last_login_at as null (frontend shows 'Never')."""
    user = User(
        email="neverloggedin@example.com",
        username="neverloggedinuser",
        password_hash=hash_password("NeverPass1"),
        role="user",
        is_active=True,
    )
    test_db.add(user)
    await test_db.commit()
    await test_db.refresh(user)
    assert user.last_login_at is None

    resp = await client.get("/api/admin/users?page_size=100", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()

    match = next(item for item in body["data"] if item["id"] == user.id)
    assert match["last_login_at"] is None


@pytest.mark.asyncio
async def test_admin_users_list_created_at_is_tz_aware(
    client: AsyncClient, admin_headers: dict[str, str]
):
    """created_at/updated_at on the admin users list serialize with a UTC offset (bug #9)."""
    resp = await client.get("/api/admin/users?page_size=100", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["data"], "expected at least the admin fixture user"

    for item in body["data"]:
        for field in ("created_at", "updated_at"):
            raw = item[field]
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            assert parsed.tzinfo is not None, f"{field} must be tz-aware: {raw!r}"


@pytest.mark.asyncio
async def test_admin_users_list_forbidden_for_non_admin(
    client: AsyncClient, auth_headers: dict[str, str]
):
    """Non-admin callers cannot reach the admin user directory."""
    resp = await client.get("/api/admin/users", headers=auth_headers)
    assert resp.status_code == 403
