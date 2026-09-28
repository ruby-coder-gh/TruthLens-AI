"""HTTP tests for /api/admin/settings — C6: the endpoint is the source of
truth and must actually persist (in-memory) what it accepts."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.api import admin


@pytest.fixture(autouse=True)
def _reset_settings_overrides():
    """`_settings_overrides` is process-global state; isolate each test."""
    admin._settings_overrides.clear()
    yield
    admin._settings_overrides.clear()


@pytest.mark.asyncio
async def test_get_admin_settings_shape(client: AsyncClient, admin_headers: dict[str, str]):
    resp = await client.get("/api/admin/settings", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    for field in (
        "app_name",
        "app_version",
        "max_upload_size_mb",
        "trust_score_high_threshold",
        "trust_score_low_threshold",
        "rate_limit_enabled",
        "rate_limit_requests",
        "rate_limit_window_seconds",
    ):
        assert field in body


@pytest.mark.asyncio
async def test_get_admin_settings_app_name_defaults_to_truthlens_ai(
    client: AsyncClient, admin_headers: dict[str, str]
):
    """R2-14: the product was renamed; the About section's default (no
    APP_NAME override in the environment) must not still say "VeritasRAG"."""
    resp = await client.get("/api/admin/settings", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["app_name"] == "TruthLens AI"


@pytest.mark.asyncio
async def test_put_admin_settings_persists_max_upload_size(
    client: AsyncClient, admin_headers: dict[str, str]
):
    """BUG-11: PUT accepted max_upload_size_mb but GET kept returning the
    unchanged default — the override was written but never read back."""
    resp = await client.put(
        "/api/admin/settings",
        json={"max_upload_size_mb": 77},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["max_upload_size_mb"] == 77

    follow_up = await client.get("/api/admin/settings", headers=admin_headers)
    assert follow_up.json()["max_upload_size_mb"] == 77


@pytest.mark.asyncio
async def test_put_admin_settings_persists_trust_score_high_threshold(
    client: AsyncClient, admin_headers: dict[str, str]
):
    """BUG-11: same bug for trust_score_high_threshold."""
    resp = await client.put(
        "/api/admin/settings",
        json={"trust_score_high_threshold": 0.9},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["trust_score_high_threshold"] == 0.9

    follow_up = await client.get("/api/admin/settings", headers=admin_headers)
    assert follow_up.json()["trust_score_high_threshold"] == 0.9


@pytest.mark.asyncio
async def test_put_admin_settings_requires_admin(client: AsyncClient, auth_headers: dict[str, str]):
    resp = await client.put(
        "/api/admin/settings",
        json={"max_upload_size_mb": 50},
        headers=auth_headers,
    )
    assert resp.status_code == 403
