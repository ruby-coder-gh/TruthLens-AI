"""HTTP tests for document upload, list, get, delete — with real workspace."""

from __future__ import annotations
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token
from app.models.user import User


@pytest.fixture
async def workspace_id(client: AsyncClient, auth_headers: dict[str, str]) -> str:
    """Create workspace and return its id."""
    resp = await client.post(
        "/api/workspaces",
        json={"name": "Doc Test WS", "description": "for documents"},
        headers=auth_headers,
    )
    return resp.json()["id"]


# ── Upload ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_upload_document(client: AsyncClient, auth_headers: dict[str, str], workspace_id: str):
    """Upload text document returns 202."""
    resp = await client.post(
        f"/api/workspaces/{workspace_id}/documents",
        files={"file": ("test.txt", b"Hello world content here", "text/plain")},
        headers=auth_headers,
    )
    assert resp.status_code == 202
    data = resp.json()
    assert data["status"] == "pending"
    assert data["original_filename"] == "test.txt"
    assert "id" in data


@pytest.mark.asyncio
async def test_upload_document_no_auth(client: AsyncClient, workspace_id: str):
    """Upload without auth returns 401."""
    resp = await client.post(
        f"/api/workspaces/{workspace_id}/documents",
        files={"file": ("test.txt", b"data", "text/plain")},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_upload_document_unsupported_type(client: AsyncClient, auth_headers: dict[str, str], workspace_id: str):
    """Upload unsupported file type returns 415."""
    resp = await client.post(
        f"/api/workspaces/{workspace_id}/documents",
        files={"file": ("test.exe", b"binarydata", "application/x-msdownload")},
        headers=auth_headers,
    )
    assert resp.status_code == 415


@pytest.mark.asyncio
async def test_upload_document_no_workspace_access(
    client: AsyncClient,
    test_db: AsyncSession,
    workspace_id: str,
):
    """Upload to workspace without access returns 401/403."""
    other_user = User(
        email="otherdoc@example.com",
        username="otherdoc",
        password_hash="hash",
        role="user",
        is_active=True,
    )
    test_db.add(other_user)
    await test_db.commit()
    await test_db.refresh(other_user)
    other_token = create_access_token(other_user.id, other_user.role)
    other_headers = {"Authorization": f"Bearer {other_token}"}

    resp = await client.post(
        f"/api/workspaces/{workspace_id}/documents",
        files={"file": ("x.txt", b"data", "text/plain")},
        headers=other_headers,
    )
    assert resp.status_code == 403


# ── List ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_documents(client: AsyncClient, auth_headers: dict[str, str], workspace_id: str):
    """List documents returns paginated response."""
    # Upload one doc
    await client.post(
        f"/api/workspaces/{workspace_id}/documents",
        files={"file": ("list_test.txt", b"list content", "text/plain")},
        headers=auth_headers,
    )

    resp = await client.get(
        f"/api/workspaces/{workspace_id}/documents",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "data" in body
    assert "meta" in body
    assert body["meta"]["total"] >= 1


@pytest.mark.asyncio
async def test_list_documents_no_auth(client: AsyncClient, workspace_id: str):
    """List documents without auth returns 401."""
    resp = await client.get(f"/api/workspaces/{workspace_id}/documents")
    assert resp.status_code == 401


# ── Get ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_document(client: AsyncClient, auth_headers: dict[str, str], workspace_id: str):
    """Get document by id returns detail with chunks."""
    upload = await client.post(
        f"/api/workspaces/{workspace_id}/documents",
        files={"file": ("get_test.txt", b"get content here", "text/plain")},
        headers=auth_headers,
    )
    doc_id = upload.json()["id"]

    resp = await client.get(
        f"/api/workspaces/{workspace_id}/documents/{doc_id}",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == doc_id


@pytest.mark.asyncio
async def test_get_document_not_found(client: AsyncClient, auth_headers: dict[str, str], workspace_id: str):
    """Get non-existent document returns 404."""
    resp = await client.get(
        f"/api/workspaces/{workspace_id}/documents/bad-id",
        headers=auth_headers,
    )
    assert resp.status_code == 404


# ── Status ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_document_status(client: AsyncClient, auth_headers: dict[str, str], workspace_id: str):
    """Poll document status."""
    upload = await client.post(
        f"/api/workspaces/{workspace_id}/documents",
        files={"file": ("status_test.txt", b"status", "text/plain")},
        headers=auth_headers,
    )
    doc_id = upload.json()["id"]

    resp = await client.get(
        f"/api/workspaces/{workspace_id}/documents/{doc_id}/status",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == doc_id


# ── Delete ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_document(client: AsyncClient, auth_headers: dict[str, str], workspace_id: str):
    """Delete document returns 204."""
    upload = await client.post(
        f"/api/workspaces/{workspace_id}/documents",
        files={"file": ("del_test.txt", b"delete me", "text/plain")},
        headers=auth_headers,
    )
    doc_id = upload.json()["id"]

    # Mock ChromaDB + BM25 calls that delete_document triggers
    with patch("app.ingestion.indexer.delete_document", new=AsyncMock()):
        resp = await client.delete(
            f"/api/workspaces/{workspace_id}/documents/{doc_id}",
            headers=auth_headers,
        )
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_document_not_found(client: AsyncClient, auth_headers: dict[str, str], workspace_id: str):
    """Delete non-existent document returns 404."""
    resp = await client.delete(
        f"/api/workspaces/{workspace_id}/documents/nonexistent",
        headers=auth_headers,
    )
    assert resp.status_code == 404
