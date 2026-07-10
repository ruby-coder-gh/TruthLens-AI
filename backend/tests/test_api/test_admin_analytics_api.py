"""Smoke tests for admin analytics aggregation endpoints.

These endpoints run grouped SQL aggregations directly (no timeout fallback),
so they must return well-formed data — not silently-empty results — even when
there are no queries yet.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_queries_over_time_returns_list(client: AsyncClient, admin_headers: dict[str, str]):
    """/admin/analytics/queries-over-time returns a JSON list (empty when no data)."""
    resp = await client.get("/api/admin/analytics/queries-over-time?days=30", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, list)
    # Each row (if any) carries a date and a query_count.
    for row in body:
        assert "date" in row
        assert "query_count" in row


@pytest.mark.asyncio
async def test_trust_score_distribution_always_four_buckets(
    client: AsyncClient, admin_headers: dict[str, str]
):
    """/admin/analytics/trust-score-distribution always returns the 4 fixed buckets."""
    resp = await client.get("/api/admin/analytics/trust-score-distribution", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, list)
    ranges = [row["range"] for row in body]
    assert ranges == ["0-25", "26-50", "51-75", "76-100"]
    for row in body:
        assert isinstance(row["count"], int)
        assert row["count"] >= 0


@pytest.mark.asyncio
async def test_analytics_requires_admin(client: AsyncClient, auth_headers: dict[str, str]):
    """Non-admin users are forbidden from analytics endpoints."""
    resp = await client.get("/api/admin/analytics/trust-score-distribution", headers=auth_headers)
    assert resp.status_code == 403
