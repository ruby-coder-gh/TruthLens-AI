"""HTTP tests for collection CRUD + access control (app/api/collections.py).

Mirrors the workspace API test patterns: a workspace is created through the
public API, a second member user is added via /members, and the collection
endpoints are exercised for the happy paths plus 400/403/404/409 branches.
Pure DB — no models/network.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token, hash_password
from app.models.user import User


async def _make_workspace(client: AsyncClient, headers: dict[str, str], name: str = "Coll WS") -> str:
    resp = await client.post("/api/workspaces", json={"name": name}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _make_member(
    client: AsyncClient,
    test_db: AsyncSession,
    workspace_id: str,
    owner_headers: dict[str, str],
    *,
    email: str,
    username: str,
) -> tuple[User, dict[str, str]]:
    """Create a user, add them to the workspace, return (user, auth_headers)."""
    user = User(
        email=email,
        username=username,
        password_hash=hash_password("MemberPass1"),
        role="user",
        is_active=True,
    )
    test_db.add(user)
    await test_db.commit()
    await test_db.refresh(user)

    add = await client.post(
        f"/api/workspaces/{workspace_id}/members",
        json={"user_id": user.id, "role": "editor"},
        headers=owner_headers,
    )
    assert add.status_code == 201, add.text

    headers = {"Authorization": f"Bearer {create_access_token(user.id, user.role)}"}
    return user, headers


async def _create_collection(
    client: AsyncClient, workspace_id: str, headers: dict[str, str], name: str = "My Collection"
) -> str:
    resp = await client.post(
        f"/api/workspaces/{workspace_id}/collections",
        json={"name": name, "description": "desc"},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


# ── create ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_collection(client: AsyncClient, auth_headers: dict[str, str]):
    """Create returns 201 with the collection payload."""
    ws = await _make_workspace(client, auth_headers)
    resp = await client.post(
        f"/api/workspaces/{ws}/collections",
        json={"name": "Docs", "description": "My docs"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Docs"
    assert data["description"] == "My docs"
    assert data["workspace_id"] == ws
    assert data["document_count"] == 0
    assert "id" in data


@pytest.mark.asyncio
async def test_create_collection_no_auth(client: AsyncClient, auth_headers: dict[str, str]):
    """Create without auth returns 401."""
    ws = await _make_workspace(client, auth_headers)
    resp = await client.post(
        f"/api/workspaces/{ws}/collections", json={"name": "NoAuth"}
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_create_collection_forbidden_non_member(
    client: AsyncClient, test_db: AsyncSession, auth_headers: dict[str, str]
):
    """A non-member cannot create a collection in someone else's workspace."""
    ws = await _make_workspace(client, auth_headers)

    outsider = User(
        email="outsider@example.com",
        username="outsider",
        password_hash=hash_password("OutsiderP1"),
        role="user",
        is_active=True,
    )
    test_db.add(outsider)
    await test_db.commit()
    await test_db.refresh(outsider)
    outsider_headers = {"Authorization": f"Bearer {create_access_token(outsider.id, outsider.role)}"}

    resp = await client.post(
        f"/api/workspaces/{ws}/collections",
        json={"name": "Sneaky"},
        headers=outsider_headers,
    )
    assert resp.status_code == 403


# ── list ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_collections(client: AsyncClient, auth_headers: dict[str, str]):
    """List returns collections created by the user."""
    ws = await _make_workspace(client, auth_headers)
    await _create_collection(client, ws, auth_headers, name="Alpha")
    await _create_collection(client, ws, auth_headers, name="Beta")

    resp = await client.get(f"/api/workspaces/{ws}/collections", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    names = [c["name"] for c in body["data"]]
    assert "Alpha" in names
    assert "Beta" in names


@pytest.mark.asyncio
async def test_list_collections_empty(client: AsyncClient, auth_headers: dict[str, str]):
    """List with no collections returns an empty data list."""
    ws = await _make_workspace(client, auth_headers)
    resp = await client.get(f"/api/workspaces/{ws}/collections", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["data"] == []


# ── get ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_collection(client: AsyncClient, auth_headers: dict[str, str]):
    """Creator can fetch collection detail."""
    ws = await _make_workspace(client, auth_headers)
    cid = await _create_collection(client, ws, auth_headers)
    resp = await client.get(
        f"/api/workspaces/{ws}/collections/{cid}", headers=auth_headers
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == cid


@pytest.mark.asyncio
async def test_get_collection_not_found(client: AsyncClient, auth_headers: dict[str, str]):
    """Unknown collection id returns 404."""
    ws = await _make_workspace(client, auth_headers)
    resp = await client.get(
        f"/api/workspaces/{ws}/collections/missing-id", headers=auth_headers
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_collection_forbidden_without_access(
    client: AsyncClient, test_db: AsyncSession, auth_headers: dict[str, str]
):
    """A workspace member who is not the creator and has no grant gets 403."""
    ws = await _make_workspace(client, auth_headers)
    cid = await _create_collection(client, ws, auth_headers)
    _, member_headers = await _make_member(
        client, test_db, ws, auth_headers, email="m1@example.com", username="m1user"
    )
    resp = await client.get(
        f"/api/workspaces/{ws}/collections/{cid}", headers=member_headers
    )
    assert resp.status_code == 403


# ── update ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_collection(client: AsyncClient, auth_headers: dict[str, str]):
    """Creator can update name + description."""
    ws = await _make_workspace(client, auth_headers)
    cid = await _create_collection(client, ws, auth_headers)
    resp = await client.put(
        f"/api/workspaces/{ws}/collections/{cid}",
        json={"name": "Renamed", "description": "new desc"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Renamed"
    assert data["description"] == "new desc"


@pytest.mark.asyncio
async def test_update_collection_not_found(client: AsyncClient, auth_headers: dict[str, str]):
    """Updating a missing collection returns 404."""
    ws = await _make_workspace(client, auth_headers)
    resp = await client.put(
        f"/api/workspaces/{ws}/collections/missing-id",
        json={"name": "X"},
        headers=auth_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_collection_forbidden(
    client: AsyncClient, test_db: AsyncSession, auth_headers: dict[str, str]
):
    """A member who is not owner/creator cannot update the collection."""
    ws = await _make_workspace(client, auth_headers)
    cid = await _create_collection(client, ws, auth_headers)
    _, member_headers = await _make_member(
        client, test_db, ws, auth_headers, email="m2@example.com", username="m2user"
    )
    resp = await client.put(
        f"/api/workspaces/{ws}/collections/{cid}",
        json={"name": "Hijack"},
        headers=member_headers,
    )
    assert resp.status_code == 403


# ── delete ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_collection(client: AsyncClient, auth_headers: dict[str, str]):
    """Creator can delete their collection (204); it then 404s."""
    ws = await _make_workspace(client, auth_headers)
    cid = await _create_collection(client, ws, auth_headers)
    resp = await client.delete(
        f"/api/workspaces/{ws}/collections/{cid}", headers=auth_headers
    )
    assert resp.status_code == 204

    gone = await client.get(
        f"/api/workspaces/{ws}/collections/{cid}", headers=auth_headers
    )
    assert gone.status_code == 404


@pytest.mark.asyncio
async def test_delete_collection_not_found(client: AsyncClient, auth_headers: dict[str, str]):
    """Deleting a missing collection returns 404."""
    ws = await _make_workspace(client, auth_headers)
    resp = await client.delete(
        f"/api/workspaces/{ws}/collections/missing-id", headers=auth_headers
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_collection_forbidden(
    client: AsyncClient, test_db: AsyncSession, auth_headers: dict[str, str]
):
    """A member who is not owner/creator cannot delete the collection."""
    ws = await _make_workspace(client, auth_headers)
    cid = await _create_collection(client, ws, auth_headers)
    _, member_headers = await _make_member(
        client, test_db, ws, auth_headers, email="m3@example.com", username="m3user"
    )
    resp = await client.delete(
        f"/api/workspaces/{ws}/collections/{cid}", headers=member_headers
    )
    assert resp.status_code == 403


# ── access: grant / list / revoke ────────────────────────────────

@pytest.mark.asyncio
async def test_grant_and_list_and_revoke_access(
    client: AsyncClient, test_db: AsyncSession, auth_headers: dict[str, str]
):
    """Grant access to a member, verify via list + member GET, then revoke."""
    ws = await _make_workspace(client, auth_headers)
    cid = await _create_collection(client, ws, auth_headers)
    member, member_headers = await _make_member(
        client, test_db, ws, auth_headers, email="m4@example.com", username="m4user"
    )

    # Grant by user_id.
    grant = await client.post(
        f"/api/workspaces/{ws}/collections/{cid}/access",
        json={"user_id": member.id},
        headers=auth_headers,
    )
    assert grant.status_code == 201
    assert grant.json()["user_id"] == member.id

    # The member can now read the collection.
    member_get = await client.get(
        f"/api/workspaces/{ws}/collections/{cid}", headers=member_headers
    )
    assert member_get.status_code == 200

    # Access list shows the entry.
    listing = await client.get(
        f"/api/workspaces/{ws}/collections/{cid}/access", headers=auth_headers
    )
    assert listing.status_code == 200
    assert any(e["user_id"] == member.id for e in listing.json()["data"])

    # Revoke.
    revoke = await client.delete(
        f"/api/workspaces/{ws}/collections/{cid}/access/{member.id}",
        headers=auth_headers,
    )
    assert revoke.status_code == 204

    # Member loses access again.
    after = await client.get(
        f"/api/workspaces/{ws}/collections/{cid}", headers=member_headers
    )
    assert after.status_code == 403


@pytest.mark.asyncio
async def test_grant_access_by_email(
    client: AsyncClient, test_db: AsyncSession, auth_headers: dict[str, str]
):
    """Access can be granted by email instead of user_id."""
    ws = await _make_workspace(client, auth_headers)
    cid = await _create_collection(client, ws, auth_headers)
    member, _ = await _make_member(
        client, test_db, ws, auth_headers, email="byemail@example.com", username="byemailuser"
    )

    grant = await client.post(
        f"/api/workspaces/{ws}/collections/{cid}/access",
        json={"email": "byemail@example.com"},
        headers=auth_headers,
    )
    assert grant.status_code == 201
    assert grant.json()["user_id"] == member.id


@pytest.mark.asyncio
async def test_grant_access_duplicate_conflicts(
    client: AsyncClient, test_db: AsyncSession, auth_headers: dict[str, str]
):
    """Granting the same user twice returns 409."""
    ws = await _make_workspace(client, auth_headers)
    cid = await _create_collection(client, ws, auth_headers)
    member, _ = await _make_member(
        client, test_db, ws, auth_headers, email="dup@example.com", username="dupuser"
    )

    first = await client.post(
        f"/api/workspaces/{ws}/collections/{cid}/access",
        json={"user_id": member.id},
        headers=auth_headers,
    )
    assert first.status_code == 201
    second = await client.post(
        f"/api/workspaces/{ws}/collections/{cid}/access",
        json={"user_id": member.id},
        headers=auth_headers,
    )
    assert second.status_code == 409


@pytest.mark.asyncio
async def test_grant_access_unknown_user(
    client: AsyncClient, auth_headers: dict[str, str]
):
    """Granting to a non-existent user id returns 404."""
    ws = await _make_workspace(client, auth_headers)
    cid = await _create_collection(client, ws, auth_headers)
    resp = await client.post(
        f"/api/workspaces/{ws}/collections/{cid}/access",
        json={"user_id": "no-such-user"},
        headers=auth_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_grant_access_requires_body_identifier(
    client: AsyncClient, auth_headers: dict[str, str]
):
    """Grant with neither user_id nor email is rejected (schema validation)."""
    ws = await _make_workspace(client, auth_headers)
    cid = await _create_collection(client, ws, auth_headers)
    resp = await client.post(
        f"/api/workspaces/{ws}/collections/{cid}/access",
        json={},
        headers=auth_headers,
    )
    # CollectionAccessGrant.validate_one_of raises -> 422 validation envelope.
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_revoke_access_not_found(
    client: AsyncClient, auth_headers: dict[str, str]
):
    """Revoking an access entry that doesn't exist returns 404."""
    ws = await _make_workspace(client, auth_headers)
    cid = await _create_collection(client, ws, auth_headers)
    resp = await client.delete(
        f"/api/workspaces/{ws}/collections/{cid}/access/no-such-user",
        headers=auth_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_list_access_forbidden_for_non_creator(
    client: AsyncClient, test_db: AsyncSession, auth_headers: dict[str, str]
):
    """A member who is not owner/creator cannot list access entries."""
    ws = await _make_workspace(client, auth_headers)
    cid = await _create_collection(client, ws, auth_headers)
    _, member_headers = await _make_member(
        client, test_db, ws, auth_headers, email="m5@example.com", username="m5user"
    )
    resp = await client.get(
        f"/api/workspaces/{ws}/collections/{cid}/access", headers=member_headers
    )
    assert resp.status_code == 403
