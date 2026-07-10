"""HTTP tests for workspace CRUD — create, list, get, update, delete, members."""

from __future__ import annotations
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token
from app.models.user import User


# ── Create ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_workspace(client: AsyncClient, auth_headers: dict[str, str]):
    """Create workspace returns 201 with workspace data."""
    resp = await client.post(
        "/api/workspaces",
        json={"name": "My Workspace", "description": "Test ws"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "My Workspace"
    assert data["description"] == "Test ws"
    assert "id" in data
    assert data["member_count"] == 1  # creator is owner


@pytest.mark.asyncio
async def test_create_workspace_no_auth(client: AsyncClient):
    """Create workspace without auth returns 401."""
    resp = await client.post(
        "/api/workspaces",
        json={"name": "No Auth", "description": ""},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_create_workspace_empty_name(client: AsyncClient, auth_headers: dict[str, str]):
    """Create workspace with empty name returns 422."""
    resp = await client.post(
        "/api/workspaces",
        json={"name": "", "description": ""},
        headers=auth_headers,
    )
    assert resp.status_code == 422


# ── List ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_workspaces(client: AsyncClient, auth_headers: dict[str, str]):
    """List workspaces returns user's workspaces."""
    # Create one
    await client.post(
        "/api/workspaces",
        json={"name": "List WS", "description": ""},
        headers=auth_headers,
    )
    resp = await client.get("/api/workspaces", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert "data" in body
    assert len(body["data"]) >= 1
    names = [ws["name"] for ws in body["data"]]
    assert "List WS" in names


@pytest.mark.asyncio
async def test_list_workspaces_no_auth(client: AsyncClient):
    """List workspaces without auth returns 401."""
    resp = await client.get("/api/workspaces")
    assert resp.status_code == 401


# ── Get ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_workspace(client: AsyncClient, auth_headers: dict[str, str]):
    """Get workspace by id returns workspace."""
    create = await client.post(
        "/api/workspaces",
        json={"name": "Get WS", "description": "desc"},
        headers=auth_headers,
    )
    ws_id = create.json()["id"]

    resp = await client.get(f"/api/workspaces/{ws_id}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "Get WS"


@pytest.mark.asyncio
async def test_get_workspace_not_found(client: AsyncClient, auth_headers: dict[str, str]):
    """Get valid-format but non-existent workspace returns 404."""
    missing_id = "00000000-0000-0000-0000-000000000000"
    resp = await client.get(f"/api/workspaces/{missing_id}", headers=auth_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_workspace_malformed_id(client: AsyncClient, auth_headers: dict[str, str]):
    """Get workspace with malformed (non-UUID) id returns 422."""
    resp = await client.get("/api/workspaces/nonexistent-id", headers=auth_headers)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_get_workspace_no_auth(client: AsyncClient):
    """Get workspace without auth returns 401."""
    resp = await client.get("/api/workspaces/any-id")
    assert resp.status_code == 401


# ── Update ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_workspace(client: AsyncClient, auth_headers: dict[str, str]):
    """Update workspace name/description (owner only)."""
    create = await client.post(
        "/api/workspaces",
        json={"name": "Before", "description": "old"},
        headers=auth_headers,
    )
    ws_id = create.json()["id"]

    resp = await client.put(
        f"/api/workspaces/{ws_id}",
        json={"name": "After", "description": "new"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "After"


@pytest.mark.asyncio
async def test_update_workspace_not_owner(
    client: AsyncClient,
    test_db: AsyncSession,
    auth_headers: dict[str, str],
):
    """Non-owner cannot update workspace."""
    # Create workspace as user A
    create = await client.post(
        "/api/workspaces",
        json={"name": "Owner WS"},
        headers=auth_headers,
    )
    ws_id = create.json()["id"]

    # Create second user
    other_user = User(
        email="other@example.com",
        username="otheruser",
        password_hash="hash",
        role="user",
        is_active=True,
    )
    test_db.add(other_user)
    await test_db.commit()
    await test_db.refresh(other_user)
    other_token = create_access_token(other_user.id, other_user.role)
    other_headers = {"Authorization": f"Bearer {other_token}"}

    resp = await client.put(
        f"/api/workspaces/{ws_id}",
        json={"name": "Hacked"},
        headers=other_headers,
    )
    assert resp.status_code == 403


# ── Delete ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_workspace(client: AsyncClient, auth_headers: dict[str, str]):
    """Delete workspace (owner only) returns 204."""
    create = await client.post(
        "/api/workspaces",
        json={"name": "Delete Me"},
        headers=auth_headers,
    )
    ws_id = create.json()["id"]

    # Mock ChromaDB call that delete_workspace triggers
    with patch("app.ingestion.indexer.delete_workspace", new=AsyncMock()):
        resp = await client.delete(f"/api/workspaces/{ws_id}", headers=auth_headers)
    assert resp.status_code == 204

    # Confirm gone
    get_resp = await client.get(f"/api/workspaces/{ws_id}", headers=auth_headers)
    assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_workspace_not_owner(
    client: AsyncClient,
    test_db: AsyncSession,
    auth_headers: dict[str, str],
):
    """Non-owner cannot delete workspace."""
    create = await client.post(
        "/api/workspaces",
        json={"name": "Delete WS"},
        headers=auth_headers,
    )
    ws_id = create.json()["id"]

    other_user = User(
        email="other2@example.com",
        username="other2",
        password_hash="hash",
        role="user",
        is_active=True,
    )
    test_db.add(other_user)
    await test_db.commit()
    await test_db.refresh(other_user)
    other_token = create_access_token(other_user.id, other_user.role)
    other_headers = {"Authorization": f"Bearer {other_token}"}

    # Mock ChromaDB to avoid connection errors
    with patch("app.ingestion.indexer.delete_workspace", new=AsyncMock()):
        resp = await client.delete(f"/api/workspaces/{ws_id}", headers=other_headers)
    assert resp.status_code == 403


# ── Members ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_add_workspace_member(
    client: AsyncClient,
    test_db: AsyncSession,
    auth_headers: dict[str, str],
):
    """Add member to workspace (owner only)."""
    create = await client.post(
        "/api/workspaces",
        json={"name": "Member WS"},
        headers=auth_headers,
    )
    ws_id = create.json()["id"]

    # Create user to add
    member_user = User(
        email="member@example.com",
        username="memberuser",
        password_hash="hash",
        role="user",
        is_active=True,
    )
    test_db.add(member_user)
    await test_db.commit()
    await test_db.refresh(member_user)

    resp = await client.post(
        f"/api/workspaces/{ws_id}/members",
        json={"user_id": member_user.id, "role": "editor"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["role"] == "editor"
    assert resp.json()["user_id"] == member_user.id


@pytest.mark.asyncio
async def test_add_member_duplicate(
    client: AsyncClient,
    test_db: AsyncSession,
    auth_headers: dict[str, str],
):
    """Adding same member twice returns 409."""
    create = await client.post(
        "/api/workspaces",
        json={"name": "Dup WS"},
        headers=auth_headers,
    )
    ws_id = create.json()["id"]

    resp = await client.post(
        f"/api/workspaces/{ws_id}/members",
        json={"user_id": "not-a-real-user-id", "role": "viewer"},
        headers=auth_headers,
    )
    # User doesn't exist
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_list_members(
    client: AsyncClient,
    test_db: AsyncSession,
    auth_headers: dict[str, str],
):
    """List members of workspace."""
    create = await client.post(
        "/api/workspaces",
        json={"name": "Members List"},
        headers=auth_headers,
    )
    ws_id = create.json()["id"]

    resp = await client.get(f"/api/workspaces/{ws_id}/members", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert "data" in body
    assert len(body["data"]) >= 1  # owner is member


@pytest.mark.asyncio
async def test_update_member_role(
    client: AsyncClient,
    test_db: AsyncSession,
    auth_headers: dict[str, str],
):
    """Update member role (owner only)."""
    create = await client.post(
        "/api/workspaces",
        json={"name": "Role WS"},
        headers=auth_headers,
    )
    ws_id = create.json()["id"]

    member_user = User(
        email="roleuser@example.com",
        username="roleuser",
        password_hash="hash",
        role="user",
        is_active=True,
    )
    test_db.add(member_user)
    await test_db.commit()
    await test_db.refresh(member_user)

    # Add member
    await client.post(
        f"/api/workspaces/{ws_id}/members",
        json={"user_id": member_user.id, "role": "viewer"},
        headers=auth_headers,
    )

    # Update role
    resp = await client.put(
        f"/api/workspaces/{ws_id}/members/{member_user.id}",
        json={"role": "editor"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "editor"


@pytest.mark.asyncio
async def test_remove_member(
    client: AsyncClient,
    test_db: AsyncSession,
    auth_headers: dict[str, str],
):
    """Remove member from workspace (owner only)."""
    create = await client.post(
        "/api/workspaces",
        json={"name": "Remove WS"},
        headers=auth_headers,
    )
    ws_id = create.json()["id"]

    member_user = User(
        email="removeme@example.com",
        username="removeme",
        password_hash="hash",
        role="user",
        is_active=True,
    )
    test_db.add(member_user)
    await test_db.commit()
    await test_db.refresh(member_user)

    # Add
    await client.post(
        f"/api/workspaces/{ws_id}/members",
        json={"user_id": member_user.id, "role": "viewer"},
        headers=auth_headers,
    )

    # Remove
    resp = await client.delete(
        f"/api/workspaces/{ws_id}/members/{member_user.id}",
        headers=auth_headers,
    )
    assert resp.status_code == 204
