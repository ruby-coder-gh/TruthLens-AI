"""HTTP tests for query list/get/delete/sources."""

from __future__ import annotations

import json
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.queries import MAX_PAGE_SIZE
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
async def test_list_queries_page_size_bounded(
    client: AsyncClient,
    auth_headers: dict[str, str],
    seeded_query: tuple[str, str],
):
    """Out-of-range page_size is clamped to configured max."""
    ws_id, _ = seeded_query
    resp = await client.get(
        f"/api/workspaces/{ws_id}/queries?page_size=999",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["meta"]["page_size"] == MAX_PAGE_SIZE


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


# ── Export ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_export_query_markdown(
    client: AsyncClient,
    auth_headers: dict[str, str],
    seeded_query: tuple[str, str],
):
    """Export query returns a Markdown attachment with question, answer, trust score, sources."""
    ws_id, q_id = seeded_query
    resp = await client.get(
        f"/api/queries/{q_id}/export",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/markdown")

    disposition = resp.headers["content-disposition"]
    assert "attachment" in disposition
    assert f"truthlens-query-{q_id}.md" in disposition

    body = resp.text
    assert "What is RAG?" in body
    assert "RAG stands for Retrieval Augmented Generation." in body
    assert "92%" in body
    assert "doc1.pdf" in body


@pytest.mark.asyncio
async def test_export_query_markdown_normalizes_source_markers(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
    seeded_query: tuple[str, str],
):
    """BUG-9 (backend): the exported `.md` must not leak raw `[source:N]` markers."""
    ws_id, q_id = seeded_query
    query = await test_db.get(Query, q_id)
    query.response_text = "RAG combines retrieval and generation [source:1]."
    await test_db.commit()

    resp = await client.get(f"/api/queries/{q_id}/export", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.text
    assert "[source:1]" not in body
    assert "[1]" in body


@pytest.mark.asyncio
async def test_export_query_not_found(
    client: AsyncClient,
    auth_headers: dict[str, str],
    seeded_query: tuple[str, str],
):
    """Export non-existent query returns 404."""
    resp = await client.get(
        "/api/queries/nonexistent/export",
        headers=auth_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_export_query_no_access(
    client: AsyncClient,
    test_db: AsyncSession,
    seeded_query: tuple[str, str],
):
    """Export query without workspace access returns 404 (not 403)."""
    ws_id, q_id = seeded_query

    other = User(
        email="qexport@example.com",
        username="qexport",
        password_hash="hash",
        role="user",
        is_active=True,
    )
    test_db.add(other)
    await test_db.commit()
    await test_db.refresh(other)
    other_token = create_access_token(other.id, other.role)
    other_headers = {"Authorization": f"Bearer {other_token}"}

    resp = await client.get(
        f"/api/queries/{q_id}/export",
        headers=other_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_export_query_no_auth(
    client: AsyncClient,
    seeded_query: tuple[str, str],
):
    """Export query without auth returns 401."""
    ws_id, q_id = seeded_query
    resp = await client.get(f"/api/queries/{q_id}/export")
    assert resp.status_code == 401


# ── Abstention edge case (F7c) ──────────────────────────────────

@pytest.mark.asyncio
async def test_query_list_and_detail_expose_the_abstention_edge_case(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    """History has to distinguish an abstention from a normal answer so the UI
    can render the 'no sufficient evidence' card for past rows too."""
    ws_resp = await client.post("/api/workspaces", json={"name": "Abstain history"}, headers=auth_headers)
    ws_id = ws_resp.json()["id"]
    abstained = Query(
        workspace_id=ws_id,
        query_text="Who signed the 1994 lease?",
        response_text="I cannot find this information in your documents.",
        response_sources="[]",
        trust_score=0.0,
        model_used="abstain",
        edge_case="insufficient_evidence",
    )
    normal = Query(
        workspace_id=ws_id,
        query_text="What is RAG?",
        response_text="Retrieval Augmented Generation.",
        response_sources="[]",
        trust_score=0.9,
        model_used="qwen3:4b",
    )
    test_db.add_all([abstained, normal])
    await test_db.commit()
    await test_db.refresh(abstained)
    await test_db.refresh(normal)

    listing = await client.get(f"/api/workspaces/{ws_id}/queries", headers=auth_headers)
    by_id = {item["id"]: item for item in listing.json()["data"]}
    assert by_id[abstained.id]["edge_case"] == "insufficient_evidence"
    assert by_id[normal.id]["edge_case"] is None

    detail = await client.get(f"/api/queries/{abstained.id}", headers=auth_headers)
    assert detail.status_code == 200
    assert detail.json()["edge_case"] == "insufficient_evidence"


# ── Truth Lens claims ───────────────────────────────────────────

SUPPORTED_CLAIM = {
    "text": "RAG stands for Retrieval Augmented Generation.",
    "start": 0,
    "end": 46,
    "verdict": "supported",
    "entailment": 0.97,
    "contradiction": 0.01,
    "source_index": 1,
    "chunk_id": "c1",
    "document_id": "d1",
    "document_name": "doc1.pdf",
    "page_number": 2,
    "evidence": "RAG is a technique that stands for Retrieval Augmented Generation.",
}
CONTRADICTED_CLAIM = {
    **SUPPORTED_CLAIM,
    "text": "RAG was invented in 1970.",
    "start": 47,
    "end": 72,
    "verdict": "contradicted",
    "entailment": 0.01,
    "contradiction": 0.95,
    "page_number": None,
    "evidence": "RAG was introduced in 2020.",
}


@pytest.fixture
async def seeded_claims(test_db: AsyncSession, seeded_query: tuple[str, str]) -> tuple[str, str]:
    from app.models.query_claims import QueryClaims

    ws_id, q_id = seeded_query
    test_db.add(QueryClaims(query_id=q_id, claims=json.dumps([SUPPORTED_CLAIM, CONTRADICTED_CLAIM])))
    await test_db.commit()
    return ws_id, q_id


@pytest.mark.asyncio
async def test_query_detail_endpoints_return_claims(
    client: AsyncClient, auth_headers: dict[str, str], seeded_claims: tuple[str, str]
):
    ws_id, q_id = seeded_claims
    for url in (f"/api/workspaces/{ws_id}/queries/{q_id}", f"/api/queries/{q_id}"):
        resp = await client.get(url, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["claims"] == [SUPPORTED_CLAIM, CONTRADICTED_CLAIM]


@pytest.mark.asyncio
async def test_query_detail_without_claims_row_has_null_claims(
    client: AsyncClient, auth_headers: dict[str, str], seeded_query: tuple[str, str]
):
    ws_id, q_id = seeded_query
    resp = await client.get(f"/api/workspaces/{ws_id}/queries/{q_id}", headers=auth_headers)
    assert resp.json()["claims"] is None


@pytest.mark.asyncio
async def test_query_list_does_not_carry_claims(
    client: AsyncClient, auth_headers: dict[str, str], seeded_claims: tuple[str, str]
):
    ws_id, _ = seeded_claims
    resp = await client.get(f"/api/workspaces/{ws_id}/queries", headers=auth_headers)
    assert all("claims" not in item for item in resp.json()["data"])


@pytest.mark.asyncio
async def test_delete_query_removes_its_claims_row(
    client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession, seeded_claims: tuple[str, str]
):
    from sqlalchemy import select

    from app.models.query_claims import QueryClaims

    ws_id, q_id = seeded_claims
    resp = await client.delete(f"/api/workspaces/{ws_id}/queries/{q_id}", headers=auth_headers)
    assert resp.status_code == 204
    remaining = (await test_db.execute(select(QueryClaims).where(QueryClaims.query_id == q_id))).all()
    assert remaining == []


@pytest.mark.asyncio
async def test_export_includes_claim_verification(
    client: AsyncClient, auth_headers: dict[str, str], seeded_claims: tuple[str, str]
):
    _, q_id = seeded_claims
    body = (await client.get(f"/api/queries/{q_id}/export", headers=auth_headers)).text
    assert "## Claim verification" in body
    assert "✅ Supported: RAG stands for Retrieval Augmented Generation. (source 1: doc1.pdf, p. 2)" in body
    assert "⛔ Contradicted: RAG was invented in 1970. (source 1: doc1.pdf)" in body
    assert "> RAG was introduced in 2020." in body
    # Section sits between the trust score and the sources.
    assert body.index("## Trust Score") < body.index("## Claim verification") < body.index("## Sources")


@pytest.mark.asyncio
async def test_export_without_claims_has_no_claim_section(
    client: AsyncClient, auth_headers: dict[str, str], seeded_query: tuple[str, str]
):
    _, q_id = seeded_query
    body = (await client.get(f"/api/queries/{q_id}/export", headers=auth_headers)).text
    assert "Claim verification" not in body
