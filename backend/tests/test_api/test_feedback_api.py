"""HTTP tests for feedback — submit and list feedback on queries."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token
from app.models.query import Query
from app.models.user import User


@pytest.fixture
async def workspace_query(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
) -> tuple[str, str]:
    """Create workspace + query, return (workspace_id, query_id)."""
    # Create workspace
    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "Feedback WS", "description": ""},
        headers=auth_headers,
    )
    ws_id = ws_resp.json()["id"]

    # Seed a query directly in DB
    query = Query(
        workspace_id=ws_id,
        user_id="test-user",
        query_text="What is RAG?",
        response_text="RAG is Retrieval Augmented Generation.",
        response_sources="[]",
        trust_score=0.95,
        guardrail_score=1.0,
        guardrail_passed=True,
        model_used="test-model",
        latency_ms=100,
        token_count=10,
    )
    test_db.add(query)
    await test_db.commit()
    await test_db.refresh(query)
    return ws_id, query.id


# ── Submit Feedback ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_submit_feedback(
    client: AsyncClient,
    auth_headers: dict[str, str],
    workspace_query: tuple[str, str],
):
    """Submit feedback returns 201."""
    ws_id, q_id = workspace_query
    resp = await client.post(
        f"/api/queries/{q_id}/feedback",
        json={"rating": 4, "comment": "Good answer"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["rating"] == 4
    assert data["comment"] == "Good answer"
    assert data["query_id"] == q_id


@pytest.mark.asyncio
async def test_submit_feedback_no_auth(
    client: AsyncClient,
    workspace_query: tuple[str, str],
):
    """Submit feedback without auth returns 401."""
    ws_id, q_id = workspace_query
    resp = await client.post(
        f"/api/queries/{q_id}/feedback",
        json={"rating": 3},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_submit_feedback_not_found(
    client: AsyncClient,
    auth_headers: dict[str, str],
):
    """Submit feedback for non-existent query returns 404."""
    resp = await client.post(
        "/api/queries/nonexistent-id/feedback",
        json={"rating": 3},
        headers=auth_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_submit_feedback_invalid_rating(
    client: AsyncClient,
    auth_headers: dict[str, str],
    workspace_query: tuple[str, str],
):
    """Submit feedback with invalid rating returns 422."""
    ws_id, q_id = workspace_query
    resp = await client.post(
        f"/api/queries/{q_id}/feedback",
        json={"rating": 99},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_submit_feedback_no_workspace_access(
    client: AsyncClient,
    test_db: AsyncSession,
    workspace_query: tuple[str, str],
):
    """Submit feedback without workspace access returns 403."""
    ws_id, q_id = workspace_query

    other = User(
        email="fbnoaccess@example.com",
        username="fbnoaccess",
        password_hash="hash",
        role="user",
        is_active=True,
    )
    test_db.add(other)
    await test_db.commit()
    await test_db.refresh(other)
    other_token = create_access_token(other.id, other.role)
    other_headers = {"Authorization": f"Bearer {other_token}"}

    resp = await client.post(
        f"/api/queries/{q_id}/feedback",
        json={"rating": 3},
        headers=other_headers,
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_submit_feedback_update_existing(
    client: AsyncClient,
    auth_headers: dict[str, str],
    workspace_query: tuple[str, str],
):
    """Submitting feedback twice updates existing entry."""
    ws_id, q_id = workspace_query

    # First submission
    await client.post(
        f"/api/queries/{q_id}/feedback",
        json={"rating": 2, "comment": "Bad"},
        headers=auth_headers,
    )

    # Second submission (update)
    resp = await client.post(
        f"/api/queries/{q_id}/feedback",
        json={"rating": 5, "comment": "Updated to excellent"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["rating"] == 5
    assert resp.json()["comment"] == "Updated to excellent"


# ── List Feedback ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_feedback(
    client: AsyncClient,
    auth_headers: dict[str, str],
    workspace_query: tuple[str, str],
):
    """List feedback for a query."""
    ws_id, q_id = workspace_query

    # Submit some feedback first
    await client.post(
        f"/api/queries/{q_id}/feedback",
        json={"rating": 5, "comment": "Great!"},
        headers=auth_headers,
    )

    resp = await client.get(
        f"/api/queries/{q_id}/feedback",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "data" in body
    assert len(body["data"]) >= 1


@pytest.mark.asyncio
async def test_list_feedback_no_auth(
    client: AsyncClient,
    workspace_query: tuple[str, str],
):
    """List feedback without auth returns 401."""
    ws_id, q_id = workspace_query
    resp = await client.get(f"/api/queries/{q_id}/feedback")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_list_feedback_not_found(
    client: AsyncClient,
    auth_headers: dict[str, str],
):
    """List feedback for non-existent query returns 404."""
    resp = await client.get(
        "/api/queries/nonexistent/feedback",
        headers=auth_headers,
    )
    assert resp.status_code == 404
