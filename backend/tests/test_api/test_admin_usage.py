"""Usage & cost reporting API coverage (F2)."""

from __future__ import annotations

import csv
import io
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth import hash_password
from app.models.audit_log import AuditLog
from app.models.query import Query
from app.models.user import User
from app.models.workspace import Workspace

PRICING_JSON = '{"gpt-4o-mini": {"input_per_1k": 0.00015, "output_per_1k": 0.0006}}'


async def _seed_usage_fixture(test_db: AsyncSession) -> dict:
    """Seed 2 users (one None), 2 workspaces, 2 models across 6 queries.

    One query is dated 40 days in the past so date-range filtering can be
    verified against the other five (created "now").
    """
    user_a = User(email="usage-a@example.com", username="usage-a", password_hash=hash_password("Pass1234"), role="user", is_active=True)
    user_b = User(email="usage-b@example.com", username="usage-b", password_hash=hash_password("Pass1234"), role="user", is_active=True)
    test_db.add_all([user_a, user_b])
    await test_db.flush()

    ws_a = Workspace(name="Workspace A", owner_id=user_a.id)
    ws_b = Workspace(name="Workspace B", owner_id=user_b.id)
    test_db.add_all([ws_a, ws_b])
    await test_db.flush()

    now = datetime.now(timezone.utc)
    old = now - timedelta(days=40)

    queries = [
        Query(workspace_id=ws_a.id, user_id=user_a.id, query_text="q1", model_used="gpt-4o-mini",
              token_count=100, prompt_tokens=50, latency_ms=200, cache_hit_count=0, created_at=now),
        Query(workspace_id=ws_a.id, user_id=user_a.id, query_text="q2", model_used="gpt-4o-mini",
              token_count=200, prompt_tokens=100, latency_ms=300, cache_hit_count=1, created_at=now),
        Query(workspace_id=ws_b.id, user_id=user_b.id, query_text="q3", model_used="qwen3:4b",
              token_count=150, prompt_tokens=75, latency_ms=100, cache_hit_count=0, created_at=now),
        Query(workspace_id=ws_b.id, user_id=None, query_text="q4", model_used="qwen3:4b",
              token_count=50, prompt_tokens=25, latency_ms=50, cache_hit_count=2, created_at=now),
        Query(workspace_id=ws_a.id, user_id=user_b.id, query_text="q5", model_used="gpt-4o-mini",
              token_count=300, prompt_tokens=150, latency_ms=400, cache_hit_count=0, created_at=now),
        Query(workspace_id=ws_b.id, user_id=user_a.id, query_text="q6-old", model_used="qwen3:4b",
              token_count=80, prompt_tokens=40, latency_ms=150, cache_hit_count=1, created_at=old),
    ]
    test_db.add_all(queries)
    await test_db.commit()

    return {
        "user_a": user_a, "user_b": user_b,
        "ws_a": ws_a, "ws_b": ws_b,
    }


@pytest.fixture
def pricing_configured(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "MODEL_PRICING_JSON", PRICING_JSON)


@pytest.mark.asyncio
async def test_usage_group_by_model_sums_and_cost(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession, pricing_configured
):
    await _seed_usage_fixture(test_db)
    date_from = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()

    resp = await client.get(
        "/api/admin/usage", params={"group_by": "model", "date_from": date_from}, headers=admin_headers
    )
    assert resp.status_code == 200
    body = resp.json()
    rows_by_key = {row["key"]: row for row in body["rows"]}

    assert rows_by_key["gpt-4o-mini"]["queries"] == 3
    assert rows_by_key["gpt-4o-mini"]["output_tokens"] == 600
    assert rows_by_key["gpt-4o-mini"]["prompt_tokens"] == 300
    assert rows_by_key["gpt-4o-mini"]["avg_latency_ms"] == pytest.approx(300.0)
    assert rows_by_key["gpt-4o-mini"]["cache_hits"] == 1
    assert rows_by_key["gpt-4o-mini"]["est_cost_usd"] == pytest.approx(0.000405)

    assert rows_by_key["qwen3:4b"]["queries"] == 2
    assert rows_by_key["qwen3:4b"]["output_tokens"] == 200
    assert rows_by_key["qwen3:4b"]["prompt_tokens"] == 100
    assert rows_by_key["qwen3:4b"]["cache_hits"] == 2
    assert rows_by_key["qwen3:4b"]["est_cost_usd"] == 0.0

    totals = body["totals"]
    assert totals["queries"] == 5
    assert totals["output_tokens"] == 800
    assert totals["prompt_tokens"] == 400
    assert totals["cache_hits"] == 3
    assert totals["est_cost_usd"] == pytest.approx(0.000405)

    assert body["pricing_source"] == "config"
    assert body["period"]["from"] is not None


@pytest.mark.asyncio
async def test_usage_group_by_user_unattributed_bucket(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession, pricing_configured
):
    seed = await _seed_usage_fixture(test_db)
    date_from = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()

    resp = await client.get(
        "/api/admin/usage", params={"group_by": "user", "date_from": date_from}, headers=admin_headers
    )
    assert resp.status_code == 200
    body = resp.json()
    rows_by_key = {row["key"]: row for row in body["rows"]}

    assert rows_by_key[seed["user_a"].id]["queries"] == 2
    assert rows_by_key[seed["user_a"].id]["output_tokens"] == 300
    assert rows_by_key[seed["user_a"].id]["est_cost_usd"] == pytest.approx(0.0002025)

    assert rows_by_key[seed["user_b"].id]["queries"] == 2
    assert rows_by_key[seed["user_b"].id]["output_tokens"] == 450

    assert rows_by_key["unattributed"]["queries"] == 1
    assert rows_by_key["unattributed"]["output_tokens"] == 50
    assert rows_by_key["unattributed"]["label"] == "Unattributed"


@pytest.mark.asyncio
async def test_usage_group_by_workspace(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession, pricing_configured
):
    seed = await _seed_usage_fixture(test_db)
    date_from = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()

    resp = await client.get(
        "/api/admin/usage", params={"group_by": "workspace", "date_from": date_from}, headers=admin_headers
    )
    assert resp.status_code == 200
    body = resp.json()
    rows_by_key = {row["key"]: row for row in body["rows"]}

    assert rows_by_key[seed["ws_a"].id]["queries"] == 3
    assert rows_by_key[seed["ws_a"].id]["label"] == "Workspace A"
    assert rows_by_key[seed["ws_b"].id]["queries"] == 2
    assert rows_by_key[seed["ws_b"].id]["label"] == "Workspace B"


@pytest.mark.asyncio
async def test_usage_date_filter_excludes_out_of_range(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession
):
    await _seed_usage_fixture(test_db)
    date_from = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()

    resp = await client.get(
        "/api/admin/usage", params={"group_by": "model", "date_from": date_from}, headers=admin_headers
    )
    body = resp.json()
    assert body["totals"]["queries"] == 5  # the 40-day-old row is excluded

    resp_all = await client.get("/api/admin/usage?group_by=model", headers=admin_headers)
    body_all = resp_all.json()
    assert body_all["totals"]["queries"] == 6  # no filter includes it


@pytest.mark.asyncio
async def test_usage_pricing_endpoint(client: AsyncClient, admin_headers: dict[str, str], pricing_configured):
    resp = await client.get("/api/admin/usage/pricing", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["pricing"]["gpt-4o-mini"]["input_per_1k"] == pytest.approx(0.00015)
    assert body["pricing"]["gpt-4o-mini"]["output_per_1k"] == pytest.approx(0.0006)


@pytest.mark.asyncio
async def test_usage_pricing_defaults_to_empty(client: AsyncClient, admin_headers: dict[str, str]):
    resp = await client.get("/api/admin/usage/pricing", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["pricing"] == {}


@pytest.mark.asyncio
async def test_usage_export_csv(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession, pricing_configured
):
    await _seed_usage_fixture(test_db)

    resp = await client.get("/api/admin/usage/export?format=csv&group_by=model", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")
    assert "usage-model-" in resp.headers["content-disposition"]
    assert ".csv" in resp.headers["content-disposition"]

    reader = csv.reader(io.StringIO(resp.text))
    rows = list(reader)
    assert rows[0] == ["key", "label", "queries", "output_tokens", "prompt_tokens", "avg_latency_ms", "cache_hits", "est_cost_usd"]
    assert len(rows) == 3  # header + 2 model groups

    audit_result = await test_db.execute(select(AuditLog).where(AuditLog.action == "usage.export"))
    audit_row = audit_result.scalar_one_or_none()
    assert audit_row is not None


@pytest.mark.asyncio
async def test_usage_requires_admin(client: AsyncClient, auth_headers: dict[str, str]):
    resp = await client.get("/api/admin/usage?group_by=model", headers=auth_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_usage_invalid_group_by_422(client: AsyncClient, admin_headers: dict[str, str]):
    resp = await client.get("/api/admin/usage?group_by=bogus", headers=admin_headers)
    assert resp.status_code == 422
