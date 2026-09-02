"""Review queue -> golden set promotion: endpoint contract, audit, and admin views."""

from __future__ import annotations

import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token
from app.models.audit_log import AuditLog
from app.models.golden_entry import GoldenEntry as GoldenEntryRow
from app.models.query import Query
from app.models.user import User

SOURCES = json.dumps([
    {"chunk_id": "c1", "document_id": "d1", "document_name": "handbook.pdf", "content": "..."},
    {"chunk_id": "c2", "document_id": "d1", "document_name": "handbook.pdf", "content": "..."},
    {"chunk_id": "c3", "document_id": "d2", "document_name": "policy.md", "content": "..."},
])


async def _workspace(client: AsyncClient, headers: dict[str, str], name: str = "Golden workspace") -> str:
    response = await client.post("/api/workspaces", json={"name": name}, headers=headers)
    assert response.status_code in (200, 201)
    return response.json()["id"]


async def _query(db: AsyncSession, workspace_id: str, **overrides) -> Query:
    fields = {
        "workspace_id": workspace_id,
        "query_text": "What is the PTO carryover limit?",
        "response_text": "Employees may carry over up to 5 days.",
        "response_sources": SOURCES,
        "trust_score": 0.3,
        "review_status": "reviewed",
        **overrides,
    }
    query = Query(**fields)
    db.add(query)
    await db.commit()
    await db.refresh(query)
    return query


@pytest.mark.asyncio
async def test_promote_creates_golden_entry_from_the_reviewed_answer(
    client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession
):
    """Promotion copies question/answer/sources and stamps an audit row."""
    workspace_id = await _workspace(client, auth_headers)
    query = await _query(test_db, workspace_id)

    response = await client.post(
        f"/api/workspaces/{workspace_id}/review-queue/{query.id}/promote-golden",
        json={"category": "answerable", "difficulty": 2, "notes": "checked by legal"},
        headers=auth_headers,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["question"] == "What is the PTO carryover limit?"
    assert body["reference_answer"] == "Employees may carry over up to 5 days."
    assert body["source_documents"] == ["handbook.pdf", "policy.md"]
    assert body["expected_grounding"] is True
    assert body["category"] == "answerable"
    assert body["difficulty"] == 2
    assert body["notes"] == "checked by legal"
    assert body["source_query_id"] == query.id
    assert body["workspace_id"] == workspace_id
    assert body["source"] == "promoted"

    row = (await test_db.execute(
        select(GoldenEntryRow).where(GoldenEntryRow.source_query_id == query.id)
    )).scalar_one()
    assert row.created_by is not None

    audit = (await test_db.execute(
        select(AuditLog).where(AuditLog.action == "query.promote_golden", AuditLog.resource_id == query.id)
    )).scalar_one()
    details = json.loads(audit.details or "{}")
    assert details["golden_entry_id"] == row.id
    assert details["category"] == "answerable"


@pytest.mark.asyncio
async def test_promote_bumps_the_golden_set_version(
    client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession
):
    """A promotion must change golden_set_version so EvalRuns stay comparable."""
    from app.evaluation.golden_store import golden_set_version

    workspace_id = await _workspace(client, auth_headers, "Version workspace")
    query = await _query(test_db, workspace_id)
    before = await golden_set_version(test_db)

    response = await client.post(
        f"/api/workspaces/{workspace_id}/review-queue/{query.id}/promote-golden",
        json={"category": "answerable"},
        headers=auth_headers,
    )
    assert response.status_code == 201

    assert await golden_set_version(test_db) != before


@pytest.mark.asyncio
async def test_promote_uses_reviewer_correction_over_the_generated_answer(
    client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession
):
    """An explicit reference_answer overrides the model's response text."""
    workspace_id = await _workspace(client, auth_headers, "Correction workspace")
    query = await _query(test_db, workspace_id)

    response = await client.post(
        f"/api/workspaces/{workspace_id}/review-queue/{query.id}/promote-golden",
        json={"category": "answerable", "reference_answer": "Up to 5 days, expiring on 31 March."},
        headers=auth_headers,
    )

    assert response.status_code == 201
    assert response.json()["reference_answer"] == "Up to 5 days, expiring on 31 March."


@pytest.mark.asyncio
async def test_promote_unanswerable_entry_expects_no_grounding(
    client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession
):
    """Only ``answerable`` entries assert grounded retrieval in the eval."""
    workspace_id = await _workspace(client, auth_headers, "Unanswerable workspace")
    query = await _query(test_db, workspace_id)

    response = await client.post(
        f"/api/workspaces/{workspace_id}/review-queue/{query.id}/promote-golden",
        json={"category": "unanswerable", "reference_answer": "Not covered by the handbook."},
        headers=auth_headers,
    )

    assert response.status_code == 201
    assert response.json()["expected_grounding"] is False


@pytest.mark.asyncio
async def test_promote_twice_for_the_same_query_conflicts(
    client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession
):
    """The unique source_query_id keeps one golden entry per reviewed answer."""
    workspace_id = await _workspace(client, auth_headers, "Duplicate workspace")
    query = await _query(test_db, workspace_id)
    payload = {"category": "answerable"}
    url = f"/api/workspaces/{workspace_id}/review-queue/{query.id}/promote-golden"

    assert (await client.post(url, json=payload, headers=auth_headers)).status_code == 201
    duplicate = await client.post(url, json=payload, headers=auth_headers)

    assert duplicate.status_code == 409
    assert (await test_db.execute(
        select(GoldenEntryRow).where(GoldenEntryRow.source_query_id == query.id)
    )).scalars().all().__len__() == 1


@pytest.mark.asyncio
async def test_promote_rejects_an_answer_with_no_text_to_reference(
    client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession
):
    """An empty answer and no reviewer correction is not a golden reference."""
    workspace_id = await _workspace(client, auth_headers, "Empty workspace")
    query = await _query(test_db, workspace_id, response_text=None)

    response = await client.post(
        f"/api/workspaces/{workspace_id}/review-queue/{query.id}/promote-golden",
        json={"category": "answerable"},
        headers=auth_headers,
    )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_promote_is_forbidden_for_a_workspace_viewer(
    client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession
):
    """Golden-set writes are an editor privilege."""
    workspace_id = await _workspace(client, auth_headers, "Viewer workspace")
    query = await _query(test_db, workspace_id)

    viewer = User(
        email="goldenviewer@example.com",
        username="goldenviewer",
        password_hash="hash",
        role="user",
        is_active=True,
    )
    test_db.add(viewer)
    await test_db.commit()
    await test_db.refresh(viewer)
    add_member = await client.post(
        f"/api/workspaces/{workspace_id}/members",
        json={"user_id": viewer.id, "role": "viewer"},
        headers=auth_headers,
    )
    assert add_member.status_code == 201
    viewer_headers = {"Authorization": f"Bearer {create_access_token(viewer.id, viewer.role)}"}

    response = await client.post(
        f"/api/workspaces/{workspace_id}/review-queue/{query.id}/promote-golden",
        json={"category": "answerable"},
        headers=viewer_headers,
    )

    assert response.status_code == 403
    assert (await test_db.execute(select(GoldenEntryRow))).scalars().all() == []


@pytest.mark.asyncio
async def test_promote_cannot_reach_a_query_in_another_workspace(
    client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession
):
    """Query ids are scoped to the workspace in the path."""
    workspace_id = await _workspace(client, auth_headers, "Owner workspace")
    other_workspace_id = await _workspace(client, auth_headers, "Other workspace")
    query = await _query(test_db, other_workspace_id)

    response = await client.post(
        f"/api/workspaces/{workspace_id}/review-queue/{query.id}/promote-golden",
        json={"category": "answerable"},
        headers=auth_headers,
    )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_review_queue_list_marks_already_promoted_items(
    client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession
):
    """The queue tells the UI which answers already carry a golden entry."""
    workspace_id = await _workspace(client, auth_headers, "Badge workspace")
    promoted = await _query(test_db, workspace_id, review_status="needs_review")
    await _query(test_db, workspace_id, review_status="needs_review", query_text="Untouched")

    await client.post(
        f"/api/workspaces/{workspace_id}/review-queue/{promoted.id}/promote-golden",
        json={"category": "answerable"},
        headers=auth_headers,
    )

    queue = await client.get(f"/api/workspaces/{workspace_id}/review-queue", headers=auth_headers)
    items = {item["id"]: item for item in queue.json()["data"]}

    assert items[promoted.id]["golden_entry_id"] is not None
    assert [item["golden_entry_id"] for item in items.values() if item["id"] != promoted.id] == [None]


@pytest.mark.asyncio
async def test_admin_can_list_and_delete_promoted_golden_entries(
    client: AsyncClient, auth_headers: dict[str, str], admin_headers: dict[str, str], test_db: AsyncSession
):
    """Admin golden view exposes version + counts and can retire a bad entry."""
    workspace_id = await _workspace(client, auth_headers, "Admin golden workspace")
    query = await _query(test_db, workspace_id)
    created = await client.post(
        f"/api/workspaces/{workspace_id}/review-queue/{query.id}/promote-golden",
        json={"category": "ambiguous"},
        headers=auth_headers,
    )
    entry_id = created.json()["id"]

    listing = await client.get("/api/admin/golden?source=promoted", headers=admin_headers)
    assert listing.status_code == 200
    body = listing.json()
    assert [item["id"] for item in body["data"]] == [entry_id]
    assert body["meta"]["promoted_count"] == 1
    assert body["meta"]["builtin_count"] > 0
    assert len(body["meta"]["golden_set_version"]) == 12

    deleted = await client.delete(f"/api/admin/golden/{entry_id}", headers=admin_headers)
    assert deleted.status_code == 204
    assert (await test_db.execute(select(GoldenEntryRow))).scalars().all() == []
    assert (await test_db.execute(
        select(AuditLog).where(AuditLog.action == "golden.delete")
    )).scalar_one().resource_id == entry_id


@pytest.mark.asyncio
async def test_admin_golden_list_can_include_builtin_entries(
    client: AsyncClient, admin_headers: dict[str, str]
):
    """``source=builtin`` surfaces the hard-coded dataset for review in the UI."""
    listing = await client.get("/api/admin/golden?source=builtin&page_size=3", headers=admin_headers)

    assert listing.status_code == 200
    body = listing.json()
    assert len(body["data"]) == 3
    assert {item["source"] for item in body["data"]} == {"builtin"}
    assert body["meta"]["total"] == body["meta"]["builtin_count"]


@pytest.mark.asyncio
async def test_admin_golden_endpoints_reject_non_admins(
    client: AsyncClient, auth_headers: dict[str, str]
):
    """Golden-set administration is admin-only."""
    listing = await client.get("/api/admin/golden", headers=auth_headers)
    removal = await client.delete("/api/admin/golden/does-not-exist", headers=auth_headers)

    assert listing.status_code == 403
    assert removal.status_code == 403
