"""HTTP tests for the admin-only user directory (app/api/users.py).

All /api/users routes require the admin role via get_current_admin, so these
tests exercise both the admin (200) and non-admin (403) paths plus pagination
and the 404 branch. Pure DB — no models/network.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import hash_password
from app.models.user import User


# ── list users ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_users_as_admin(
    client: AsyncClient, admin_headers: dict[str, str]
):
    """Admin can list users; the response is a paginated envelope."""
    resp = await client.get("/api/users", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert "data" in body
    assert "meta" in body
    # The admin fixture user itself must appear.
    assert body["meta"]["total"] >= 1
    assert any(u["role"] == "admin" for u in body["data"])


@pytest.mark.asyncio
async def test_list_users_forbidden_for_non_admin(
    client: AsyncClient, auth_headers: dict[str, str]
):
    """A regular user is forbidden from the admin user directory."""
    resp = await client.get("/api/users", headers=auth_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_list_users_requires_auth(client: AsyncClient):
    """Unauthenticated request returns 401."""
    resp = await client.get("/api/users")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_list_users_pagination_clamped(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession
):
    """page_size above MAX_PAGE_SIZE is clamped to 100."""
    # Seed a handful of extra users.
    for i in range(5):
        test_db.add(
            User(
                email=f"seed{i}@example.com",
                username=f"seeduser{i}",
                password_hash=hash_password("SeedPass1"),
                role="user",
                is_active=True,
            )
        )
    await test_db.commit()

    resp = await client.get("/api/users?page=1&page_size=999", headers=admin_headers)
    assert resp.status_code == 200
    meta = resp.json()["meta"]
    assert meta["page_size"] == 100  # MAX_PAGE_SIZE
    assert meta["page"] == 1


@pytest.mark.asyncio
async def test_list_users_second_page(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession
):
    """A small page_size returns at most that many rows."""
    for i in range(4):
        test_db.add(
            User(
                email=f"page{i}@example.com",
                username=f"pageuser{i}",
                password_hash=hash_password("SeedPass1"),
                role="user",
                is_active=True,
            )
        )
    await test_db.commit()

    resp = await client.get("/api/users?page=1&page_size=2", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["data"]) <= 2
    assert body["meta"]["page_size"] == 2


# ── get single user ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_user_as_admin(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession
):
    """Admin can fetch a specific user by id."""
    target = User(
        email="target@example.com",
        username="targetuser",
        password_hash=hash_password("TargetPass1"),
        role="user",
        is_active=True,
    )
    test_db.add(target)
    await test_db.commit()
    await test_db.refresh(target)

    resp = await client.get(f"/api/users/{target.id}", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == target.id
    assert data["email"] == "target@example.com"
    assert data["username"] == "targetuser"
    assert data["is_active"] is True


@pytest.mark.asyncio
async def test_get_user_not_found(
    client: AsyncClient, admin_headers: dict[str, str]
):
    """Unknown user id returns 404."""
    resp = await client.get("/api/users/does-not-exist", headers=admin_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_user_forbidden_for_non_admin(
    client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession
):
    """A regular user cannot fetch arbitrary user records."""
    target = User(
        email="hidden@example.com",
        username="hiddenuser",
        password_hash=hash_password("HiddenPass1"),
        role="user",
        is_active=True,
    )
    test_db.add(target)
    await test_db.commit()
    await test_db.refresh(target)

    resp = await client.get(f"/api/users/{target.id}", headers=auth_headers)
    assert resp.status_code == 403
