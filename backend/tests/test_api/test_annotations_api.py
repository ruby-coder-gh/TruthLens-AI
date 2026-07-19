"""Collaborative annotation CRUD, authorization, and soft-delete coverage."""

from __future__ import annotations

import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token
from app.models.annotation import Annotation
from app.models.query import Query
from app.models.user import User
from app.models.workspace import WorkspaceMember


@pytest.mark.asyncio
async def test_annotation_crud_scoping_and_soft_delete(
    client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession
):
    workspace_response = await client.post("/api/workspaces", json={"name": "Annotation workspace"}, headers=auth_headers)
    workspace_id = workspace_response.json()["id"]
    query = Query(
        workspace_id=workspace_id,
        query_text="What is supported?",
        response_text="Supported by source one.",
        response_sources=json.dumps([
            {"chunk_id": "source-one", "document_id": "document-one", "content": "Source one"},
            {"chunk_id": "source-two", "document_id": "document-two", "content": "Source two"},
        ]),
    )
    test_db.add(query)
    await test_db.commit()
    await test_db.refresh(query)

    answer = await client.post(
        f"/api/workspaces/{workspace_id}/queries/{query.id}/annotations",
        json={"body": "Looks acceptable"}, headers=auth_headers,
    )
    source = await client.post(
        f"/api/workspaces/{workspace_id}/queries/{query.id}/annotations",
        json={"body": "Check the context", "source_id": "source-one"}, headers=auth_headers,
    )
    assert answer.status_code == source.status_code == 201
    annotation_id = source.json()["id"]

    other_member = User(email="comment-member@example.com", username="commentmember", password_hash="hash", is_active=True)
    test_db.add(other_member)
    await test_db.flush()
    test_db.add(WorkspaceMember(workspace_id=workspace_id, user_id=other_member.id, role="editor"))
    await test_db.commit()
    member_headers = {"Authorization": f"Bearer {create_access_token(other_member.id, other_member.role)}"}
    denied_edit = await client.patch(
        f"/api/workspaces/{workspace_id}/queries/{query.id}/annotations/{annotation_id}",
        json={"body": "Not the author"}, headers=member_headers,
    )
    denied_delete = await client.delete(
        f"/api/workspaces/{workspace_id}/queries/{query.id}/annotations/{annotation_id}", headers=member_headers,
    )
    assert denied_edit.status_code == denied_delete.status_code == 403

    scoped = await client.get(
        f"/api/workspaces/{workspace_id}/queries/{query.id}/annotations?source_id=source-one",
        headers=auth_headers,
    )
    assert [item["id"] for item in scoped.json()["data"]] == [annotation_id]
    count = await client.get(
        f"/api/workspaces/{workspace_id}/queries/{query.id}/annotations/count?answer_only=true",
        headers=auth_headers,
    )
    assert count.json()["count"] == 1

    updated = await client.patch(
        f"/api/workspaces/{workspace_id}/queries/{query.id}/annotations/{annotation_id}",
        json={"body": "Context verified"}, headers=auth_headers,
    )
    assert updated.status_code == 200
    assert updated.json()["body"] == "Context verified"

    deleted = await client.delete(
        f"/api/workspaces/{workspace_id}/queries/{query.id}/annotations/{annotation_id}", headers=auth_headers,
    )
    assert deleted.status_code == 200
    assert deleted.json()["is_deleted"] is True
    persisted = (await test_db.execute(select(Annotation).where(Annotation.id == annotation_id))).scalar_one()
    assert persisted.deleted_at is not None

    listed = await client.get(
        f"/api/workspaces/{workspace_id}/queries/{query.id}/annotations?source_id=source-one", headers=auth_headers,
    )
    assert listed.json()["data"][0]["body"] is None
    assert listed.json()["data"][0]["is_deleted"] is True


@pytest.mark.asyncio
async def test_annotation_requires_workspace_membership_and_valid_cited_source(
    client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession
):
    workspace_response = await client.post("/api/workspaces", json={"name": "Private comments"}, headers=auth_headers)
    workspace_id = workspace_response.json()["id"]
    query = Query(workspace_id=workspace_id, query_text="Q", response_text="A", response_sources="[]")
    test_db.add(query)
    await test_db.commit()
    await test_db.refresh(query)

    invalid_source = await client.post(
        f"/api/workspaces/{workspace_id}/queries/{query.id}/annotations",
        json={"body": "No matching source", "source_id": "not-cited"}, headers=auth_headers,
    )
    assert invalid_source.status_code == 400

    outsider = User(email="comment-out@example.com", username="commentout", password_hash="hash", is_active=True)
    test_db.add(outsider)
    await test_db.commit()
    outsider_headers = {"Authorization": f"Bearer {create_access_token(outsider.id, outsider.role)}"}
    assert (await client.get(f"/api/workspaces/{workspace_id}/queries/{query.id}/annotations", headers=outsider_headers)).status_code == 403
    assert (await client.post(
        f"/api/workspaces/{workspace_id}/queries/{query.id}/annotations",
        json={"body": "Cannot post"}, headers=outsider_headers,
    )).status_code == 403
