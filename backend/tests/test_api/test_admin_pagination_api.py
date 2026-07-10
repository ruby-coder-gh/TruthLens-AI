"""Pagination bounds tests for admin/user paginated routes."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.api.admin import MAX_PAGE_SIZE as ADMIN_MAX_PAGE_SIZE
from app.api.admin import MIN_PAGE_SIZE as ADMIN_MIN_PAGE_SIZE
from app.api.users import MAX_PAGE_SIZE as USERS_MAX_PAGE_SIZE
from app.api.users import MIN_PAGE_SIZE as USERS_MIN_PAGE_SIZE


@pytest.mark.asyncio
async def test_users_route_page_size_clamped(client: AsyncClient, admin_headers: dict[str, str]):
    """/api/users clamps page_size to configured bounds."""
    upper = await client.get("/api/users?page_size=999", headers=admin_headers)
    assert upper.status_code == 200
    assert upper.json()["meta"]["page_size"] == USERS_MAX_PAGE_SIZE

    lower = await client.get("/api/users?page_size=0", headers=admin_headers)
    assert lower.status_code == 200
    assert lower.json()["meta"]["page_size"] == USERS_MIN_PAGE_SIZE


@pytest.mark.asyncio
async def test_admin_logs_page_size_clamped(client: AsyncClient, admin_headers: dict[str, str]):
    """/api/admin/logs clamps page_size to configured bounds."""
    upper = await client.get("/api/admin/logs?page_size=999", headers=admin_headers)
    assert upper.status_code == 200
    assert upper.json()["meta"]["page_size"] == ADMIN_MAX_PAGE_SIZE

    lower = await client.get("/api/admin/logs?page_size=0", headers=admin_headers)
    assert lower.status_code == 200
    assert lower.json()["meta"]["page_size"] == ADMIN_MIN_PAGE_SIZE


@pytest.mark.asyncio
async def test_other_admin_paginated_routes_page_size_clamped(client: AsyncClient, admin_headers: dict[str, str]):
    """Other admin paginated routes clamp page_size as well."""
    users_resp = await client.get("/api/users?page_size=1", headers=admin_headers)
    assert users_resp.status_code == 200
    user_id = users_resp.json()["data"][0]["id"]

    routes = [
        "/api/admin/users",
        "/api/admin/evaluation/history",
        "/api/admin/analytics/flagged-answers",
        f"/api/admin/users/{user_id}/activity",
    ]

    for route in routes:
        upper = await client.get(f"{route}?page_size=999", headers=admin_headers)
        assert upper.status_code == 200
        assert upper.json()["meta"]["page_size"] == ADMIN_MAX_PAGE_SIZE

        lower = await client.get(f"{route}?page_size=0", headers=admin_headers)
        assert lower.status_code == 200
        assert lower.json()["meta"]["page_size"] == ADMIN_MIN_PAGE_SIZE
