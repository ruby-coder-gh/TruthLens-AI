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


# ─── BUG-10: abstentions are correct behaviour, not low-trust answers ──


async def _seed_abstention_and_bad_answer(test_db, admin_headers, client):
    """Seed one gated abstention and one genuinely low-trust answer.

    A sufficiency-gated abstention scores 0.0 *by construction* (no LLM ran),
    so it lands in every naive `trust_score < threshold` filter even though
    refusing was the correct outcome.
    """
    from app.models.query import Query

    ws_resp = await client.post("/api/workspaces", json={"name": "Analytics WS"}, headers=admin_headers)
    workspace_id = ws_resp.json()["id"]

    abstention = Query(
        workspace_id=workspace_id,
        query_text="What is the boiling point of mercury?",
        response_text="I cannot find this information in the provided documents.",
        trust_score=0.0,
        model_used="abstain",
        edge_case="insufficient_evidence",
    )
    low_trust = Query(
        workspace_id=workspace_id,
        query_text="Summarise the supplier audit requirements.",
        response_text="Something poorly grounded.",
        trust_score=0.1,
        model_used="qwen3:4b",
        edge_case=None,
    )
    test_db.add_all([abstention, low_trust])
    await test_db.commit()
    return workspace_id


@pytest.mark.asyncio
async def test_flagged_answers_excludes_abstentions(
    client: AsyncClient, admin_headers: dict[str, str], test_db
):
    """An abstention must not be listed or counted as a flagged low-trust answer."""
    await _seed_abstention_and_bad_answer(test_db, admin_headers, client)

    resp = await client.get("/api/admin/analytics/flagged-answers", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()

    texts = [row["query_text"] for row in body["data"]]
    assert "Summarise the supplier audit requirements." in texts
    assert "What is the boiling point of mercury?" not in texts
    assert body["meta"]["total"] == 1


@pytest.mark.asyncio
async def test_trust_score_distribution_excludes_abstentions(
    client: AsyncClient, admin_headers: dict[str, str], test_db
):
    """The 0-25 bucket drives the UI's "low-trust share"; abstentions must not inflate it."""
    await _seed_abstention_and_bad_answer(test_db, admin_headers, client)

    resp = await client.get("/api/admin/analytics/trust-score-distribution", headers=admin_headers)
    assert resp.status_code == 200
    buckets = {row["range"]: row["count"] for row in resp.json()}

    # Only the genuinely low-trust answer (0.1) counts, not the 0.0 abstention.
    assert buckets["0-25"] == 1
