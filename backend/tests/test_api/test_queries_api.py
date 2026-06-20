"""HTTP tests for query list/get/delete/sources."""

from __future__ import annotations

import json
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token
from app.models.query import Query
from app.models.user import User


@pytest.fixture
async def seeded_query(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
) -> tuple[str, str]:
    """Create workspace + seed query, return (workspace_id, query_id)."""
    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "Query WS", "description": ""},
        headers=auth_headers,
    )
    ws_id = ws_resp.json()["id"]

    query = Query(
        workspace_id=ws_id,
        user_id="test-user",
        query_text="What is RAG?",
        rewritten_query="Explain RAG in detail",
        response_text="RAG stands for Retrieval Augmented Generation.",
        response_sources=json.dumps([
            {
                "chunk_id": "c1",
                "document_id": "d1",
                "document_name": "doc1.pdf",
                "excerpt": "RAG is a technique...",
                "score": 0.95,
            }
        ]),
        trust_score=0.92,
        guardrail_score=0.98,
        guardrail_passed=True,
        model_used="qwen3:4b",
        latency_ms=250,
        token_count=12,
    )
    test_db.add(query)
    await test_db.commit()
    await test_db.refresh(query)
    return ws_id, query.id


# ── List ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_queries(
    client: AsyncClient,
    auth_headers: dict[str, str],
    seeded_query: tuple[str, str],
):
    """List queries returns paginated response."""
    ws_id, q_id = seeded_query
    resp = await client.get(
        f"/api/workspaces/{ws_id}/queries",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "data" in body
    assert "meta" in body
    assert body["meta"]["total"] >= 1


@pytest.mark.asyncio
async def test_list_queries_no_auth(client: AsyncClient):
    """List queries without auth returns 401."""
    resp = await client.get("/api/workspaces/any/queries")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_list_queries_empty(
    client: AsyncClient,
    auth_headers: dict[str, str],
):
    """List queries when none exist returns empty list."""
    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "Empty WS"},
        headers=auth_headers,
    )
    ws_id = ws_resp.json()["id"]

    resp = await client.get(
        f"/api/workspaces/{ws_id}/queries",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["meta"]["total"] == 0


# ── Get ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_query(
    client: AsyncClient,
    auth_headers: dict[str, str],
    seeded_query: tuple[str, str],
):
    """Get query returns detail."""
    ws_id, q_id = seeded_query
    resp = await client.get(
        f"/api/workspaces/{ws_id}/queries/{q_id}",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == q_id
    assert data["query_text"] == "What is RAG?"
    assert data["trust_score"] == 0.92
    assert data["guardrail_passed"] is True


@pytest.mark.asyncio
async def test_get_query_not_found(
    client: AsyncClient,
    auth_headers: dict[str, str],
    seeded_query: tuple[str, str],
):
    """Get non-existent query returns 404."""
    ws_id, q_id = seeded_query
    resp = await client.get(
        f"/api/workspaces/{ws_id}/queries/nonexistent",
        headers=auth_headers,
    )
    assert resp.status_code == 404


# ── Sources ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_query_sources(
    client: AsyncClient,
    auth_headers: dict[str, str],
    seeded_query: tuple[str, str],
):
    """Get query sources returns source list."""
    ws_id, q_id = seeded_query
    resp = await client.get(
        f"/api/workspaces/{ws_id}/queries/{q_id}/sources",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "data" in body
    assert len(body["data"]) >= 1
    assert body["data"][0]["chunk_id"] == "c1"


@pytest.mark.asyncio
async def test_get_sources_not_found(
    client: AsyncClient,
    auth_headers: dict[str, str],
    seeded_query: tuple[str, str],
):
    """Get sources for non-existent query returns 404."""
    ws_id, q_id = seeded_query
    resp = await client.get(
        f"/api/workspaces/{ws_id}/queries/nonexistent/sources",
        headers=auth_headers,
    )
    assert resp.status_code == 404


# ── Delete ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_query(
    client: AsyncClient,
    auth_headers: dict[str, str],
    seeded_query: tuple[str, str],
):
    """Delete query returns 204."""
    ws_id, q_id = seeded_query
    resp = await client.delete(
        f"/api/workspaces/{ws_id}/queries/{q_id}",
        headers=auth_headers,
    )
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_query_not_found(
    client: AsyncClient,
    auth_headers: dict[str, str],
    seeded_query: tuple[str, str],
):
    """Delete non-existent query returns 404."""
    ws_id, q_id = seeded_query
    resp = await client.delete(
        f"/api/workspaces/{ws_id}/queries/nonexistent",
        headers=auth_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_query_no_access(
    client: AsyncClient,
    test_db: AsyncSession,
    seeded_query: tuple[str, str],
):
    """Delete query without workspace access returns 403."""
    ws_id, q_id = seeded_query

    other = User(
        email="qdel@example.com",
        username="qdel",
        password_hash="hash",
        role="user",
        is_active=True,
    )
    test_db.add(other)
    await test_db.commit()
    await test_db.refresh(other)
    other_token = create_access_token(other.id, other.role)
    other_headers = {"Authorization": f"Bearer {other_token}"}

    resp = await client.delete(
        f"/api/workspaces/{ws_id}/queries/{q_id}",
        headers=other_headers,
    )
    assert resp.status_code == 403
