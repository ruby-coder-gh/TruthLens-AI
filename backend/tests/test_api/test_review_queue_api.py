"""Confidence review queue lifecycle and audit coverage."""

from __future__ import annotations

import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog
from app.models.query import Query
from app.models.workspace import Workspace


@pytest.mark.asyncio
async def test_review_queue_filters_by_threshold_and_records_review_audit(
    client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession
):
    workspace_response = await client.post("/api/workspaces", json={"name": "Review workspace"}, headers=auth_headers)
    workspace_id = workspace_response.json()["id"]
    low = Query(
        workspace_id=workspace_id,
        query_text="Risky answer",
        response_text="Needs review",
        response_sources="[]",
        trust_score=0.2,
        trust_components={"faithfulness": 0.2, "relevance": 0.4},
    )
    high = Query(workspace_id=workspace_id, query_text="Strong answer", response_text="Fine", trust_score=0.9)
    dismissed = Query(workspace_id=workspace_id, query_text="Already dismissed", response_text="Fine", trust_score=0.1, review_status="dismissed")
    test_db.add_all([low, high, dismissed])
    await test_db.commit()
    await test_db.refresh(low)

    queue = await client.get(f"/api/workspaces/{workspace_id}/review-queue", headers=auth_headers)
    assert queue.status_code == 200
    assert [item["id"] for item in queue.json()["data"]] == [low.id]
    assert queue.json()["data"][0]["trust_components"]["faithfulness"] == 0.2
    # Reviewers need to know which prompt produced the answer they are judging.
    assert "prompt_version" in queue.json()["data"][0]

    review = await client.patch(
        f"/api/workspaces/{workspace_id}/review-queue/{low.id}",
        json={"review_status": "reviewed", "review_note": "acceptable for internal use"},
        headers=auth_headers,
    )
    assert review.status_code == 200
    assert review.json()["review_status"] == "reviewed"
    assert review.json()["review_note"] == "acceptable for internal use"

    audit = (await test_db.execute(
        select(AuditLog).where(AuditLog.action == "query.review_update", AuditLog.resource_id == low.id)
    )).scalar_one()
    assert json.loads(audit.details or "{}")["to"] == "reviewed"
    assert (await client.get(f"/api/workspaces/{workspace_id}/review-queue", headers=auth_headers)).json()["data"] == []


@pytest.mark.asyncio
async def test_review_queue_workspace_opt_out_hides_items_and_badge(
    client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession
):
    workspace_response = await client.post("/api/workspaces", json={"name": "Opt out workspace"}, headers=auth_headers)
    workspace_id = workspace_response.json()["id"]
    test_db.add(Query(workspace_id=workspace_id, query_text="Low", response_text="Low", trust_score=0.1))
    await test_db.commit()

    update = await client.patch(
        f"/api/workspaces/{workspace_id}/review-queue/settings",
        json={"review_queue_enabled": False},
        headers=auth_headers,
    )
    assert update.status_code == 200
    assert update.json()["review_queue_enabled"] is False

    queue = await client.get(f"/api/workspaces/{workspace_id}/review-queue", headers=auth_headers)
    count = await client.get(f"/api/workspaces/{workspace_id}/review-queue/count", headers=auth_headers)
    assert queue.json()["data"] == []
    assert queue.json()["meta"]["enabled"] is False
    assert count.json() == {"count": 0, "review_queue_enabled": False}

    workspace = await test_db.get(Workspace, workspace_id)
    assert workspace is not None and workspace.review_queue_enabled is False
