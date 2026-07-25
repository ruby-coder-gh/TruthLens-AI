"""HTTP coverage for permission-scoped global search."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token
from app.models.document import Document
from app.models.query import Query
from app.models.user import User


async def _workspace(client: AsyncClient, headers: dict[str, str], name: str) -> str:
    response = await client.post("/api/workspaces", json={"name": name}, headers=headers)
    assert response.status_code == 201
    return response.json()["id"]


@pytest.mark.asyncio
async def test_global_search_scopes_results_to_accessible_workspaces(
    client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession
):
    own_workspace = await _workspace(client, auth_headers, "Accessible research")
    test_db.add_all([
        Query(workspace_id=own_workspace, query_text="What does Aurora say?", response_text="Aurora is approved."),
        Document(workspace_id=own_workspace, filename="aurora.txt", original_filename="aurora-policy.txt", mime_type="text/plain", file_size=5),
    ])

    outsider = User(email="search-out@example.com", username="searchout", password_hash="hash", is_active=True)
    test_db.add(outsider)
    await test_db.commit()
    await test_db.refresh(outsider)
    outsider_headers = {"Authorization": f"Bearer {create_access_token(outsider.id, outsider.role)}"}
    private_workspace = await _workspace(client, outsider_headers, "Private research")
    test_db.add_all([
        Query(workspace_id=private_workspace, query_text="Aurora private plan", response_text="Never disclose Aurora."),
        Document(workspace_id=private_workspace, filename="secret.txt", original_filename="aurora-secret.txt", mime_type="text/plain", file_size=5),
    ])
    await test_db.commit()

    response = await client.get("/api/search?q=Aurora&per_workspace=10", headers=auth_headers)
    assert response.status_code == 200
    results = response.json()["data"]
    assert {result["workspace_id"] for result in results} == {own_workspace}
    assert {result["resource_type"] for result in results} == {"query", "document"}
    assert all(result["workspace_name"] == "Accessible research" for result in results)


@pytest.mark.asyncio
async def test_global_search_empty_query_and_pagination(
    client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession
):
    workspace_id = await _workspace(client, auth_headers, "Paginated search")
    test_db.add_all([
        Query(workspace_id=workspace_id, query_text=f"Policy question {index}", response_text="Policy answer")
        for index in range(4)
    ])
    await test_db.commit()

    missing = await client.get("/api/search", headers=auth_headers)
    blank = await client.get("/api/search?q=%20%20", headers=auth_headers)
    assert missing.status_code == 422
    assert blank.status_code >= 400

    response = await client.get("/api/search?q=Policy&page=2&page_size=1&per_workspace=4", headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["meta"]["total"] == 4
    assert body["meta"]["page"] == 2
    assert len(body["data"]) == 1
