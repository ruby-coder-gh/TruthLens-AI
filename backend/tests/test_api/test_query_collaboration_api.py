"""Pins and answer-rerun comparison API coverage."""

from __future__ import annotations

import json
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth import create_access_token
from app.models.query import Query
from app.models.user import User
from app.models.workspace import WorkspaceMember


async def _seed_queries(client: AsyncClient, headers: dict[str, str], test_db: AsyncSession, count: int = 3) -> tuple[str, list[Query]]:
    workspace_response = await client.post("/api/workspaces", json={"name": "Pins workspace"}, headers=headers)
    workspace_id = workspace_response.json()["id"]
    queries = [
        Query(
            workspace_id=workspace_id,
            query_text=f"Question {index}",
            response_text=f"Answer {index}",
            response_sources=json.dumps([{"chunk_id": f"source-{index}", "document_id": f"doc-{index}", "content": f"Source {index}", "score": 0.8}]),
            trust_score=0.5,
        )
        for index in range(count)
    ]
    test_db.add_all(queries)
    await test_db.commit()
    for query in queries:
        await test_db.refresh(query)
    return workspace_id, queries


@pytest.mark.asyncio
async def test_pins_are_private_filterable_and_enforce_limit(
    client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(settings, "QUERY_PIN_LIMIT", 2)
    workspace_id, queries = await _seed_queries(client, auth_headers, test_db)

    assert (await client.post(f"/api/workspaces/{workspace_id}/queries/{queries[0].id}/pin", headers=auth_headers)).status_code == 201
    assert (await client.post(f"/api/workspaces/{workspace_id}/queries/{queries[1].id}/pin", headers=auth_headers)).status_code == 201
    limit = await client.post(f"/api/workspaces/{workspace_id}/queries/{queries[2].id}/pin", headers=auth_headers)
    assert limit.status_code == 409
    assert "Pin limit of 2" in limit.json()["error"]["message"]

    pinned = await client.get(f"/api/workspaces/{workspace_id}/queries?pinned=true", headers=auth_headers)
    assert pinned.status_code == 200
    assert {row["id"] for row in pinned.json()["data"]} == {queries[0].id, queries[1].id}
    assert all(row["is_pinned"] for row in pinned.json()["data"])

    other = User(email="pin-member@example.com", username="pinmember", password_hash="hash", is_active=True)
    test_db.add(other)
    await test_db.flush()
    test_db.add(WorkspaceMember(workspace_id=workspace_id, user_id=other.id, role="viewer"))
    await test_db.commit()
    other_headers = {"Authorization": f"Bearer {create_access_token(other.id, other.role)}"}
    other_list = await client.get(f"/api/workspaces/{workspace_id}/queries", headers=other_headers)
    assert other_list.status_code == 200
    assert all(not row["is_pinned"] for row in other_list.json()["data"])

    assert (await client.delete(f"/api/workspaces/{workspace_id}/queries/{queries[0].id}/pin", headers=auth_headers)).status_code == 204
    updated = await client.get(f"/api/workspaces/{workspace_id}/queries?pinned=true", headers=auth_headers)
    assert [row["id"] for row in updated.json()["data"]] == [queries[1].id]


@pytest.mark.asyncio
async def test_answer_comparison_persists_rerun_and_returns_source_diff_and_trust_delta(
    client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession, monkeypatch: pytest.MonkeyPatch
):
    workspace_id, [original, *_] = await _seed_queries(client, auth_headers, test_db, count=1)

    async def fake_rerun(**_: object):
        return {
            "query_id": str(uuid.uuid4()),
            "workspace_document_version": 2,
            "rewritten_query": "Question 0 current",
            "response_text": "A revised answer",
            "contexts": [
                {"chunk_id": "source-0", "document_id": "doc-0", "content": "Shared source", "score": 0.8},
                {"chunk_id": "source-new", "document_id": "doc-new", "content": "New evidence", "score": 0.9},
            ],
            "trust_score": 0.7,
            "trust_components": {"faithfulness": 0.7},
            "guardrail_result": {"passed": True, "score": 0.9},
            "model_used": "test-model",
            "latency_ms": 23,
        }

    monkeypatch.setattr("app.api.queries._run_fresh_query", fake_rerun)
    response = await client.post(f"/api/workspaces/{workspace_id}/queries/{original.id}/compare", headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["original"]["id"] == original.id
    assert body["rerun"]["compared_to_query_id"] == original.id
    assert body["trust_score_delta"] == pytest.approx(0.2)
    assert [source["chunk_id"] for source in body["source_diff"]["new_sources"]] == ["source-new"]
    assert [source["chunk_id"] for source in body["source_diff"]["shared_sources"]] == ["source-0"]

    rerun = (await test_db.execute(select(Query).where(Query.id == body["rerun"]["id"]))).scalar_one()
    assert rerun.compared_to_query_id == original.id


@pytest.mark.asyncio
async def test_answer_comparison_handles_unchanged_sources(
    client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession, monkeypatch: pytest.MonkeyPatch
):
    workspace_id, [original, *_] = await _seed_queries(client, auth_headers, test_db, count=1)

    async def unchanged(**_: object):
        return {
            "query_id": str(uuid.uuid4()), "workspace_document_version": 1,
            "response_text": original.response_text,
            "contexts": [{"chunk_id": "source-0", "document_id": "doc-0", "content": "Source 0", "score": 0.8}],
            "trust_score": original.trust_score, "trust_components": {},
            "guardrail_result": {"passed": True, "score": 1.0}, "model_used": "test", "latency_ms": 1,
        }

    monkeypatch.setattr("app.api.queries._run_fresh_query", unchanged)
    response = await client.post(f"/api/workspaces/{workspace_id}/queries/{original.id}/compare", headers=auth_headers)
    assert response.status_code == 200
    diff = response.json()["source_diff"]
    assert diff["new_sources"] == []
    assert diff["dropped_sources"] == []
    assert [source["chunk_id"] for source in diff["shared_sources"]] == ["source-0"]
