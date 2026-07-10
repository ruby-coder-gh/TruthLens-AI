"""HTTP tests for document upload, list, get, delete — with real workspace."""

from __future__ import annotations
import sys
import types
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.documents import MAX_DETAIL_CHUNKS, MAX_PAGE_SIZE, MIN_PAGE_SIZE, upload_document
from app.core.exceptions import TooLargeException
from app.core.auth import create_access_token
from app.models.chunk import Chunk
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
async def test_list_documents_page_size_bounded(client: AsyncClient, auth_headers: dict[str, str], workspace_id: str):
    """Out-of-range page_size values are clamped to configured bounds."""
    resp = await client.get(
        f"/api/workspaces/{workspace_id}/documents?page_size=999",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["meta"]["page_size"] == MAX_PAGE_SIZE

    resp = await client.get(
        f"/api/workspaces/{workspace_id}/documents?page_size=0",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["meta"]["page_size"] == MIN_PAGE_SIZE


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


@pytest.mark.asyncio
async def test_get_document_admin_can_access_foreign_workspace(
    client: AsyncClient,
    auth_headers: dict[str, str],
    admin_headers: dict[str, str],
    workspace_id: str,
):
    """Admin can GET document detail in a workspace they don't own/belong to (bug #2)."""
    upload = await client.post(
        f"/api/workspaces/{workspace_id}/documents",
        files={"file": ("admin_get_test.txt", b"admin visible content", "text/plain")},
        headers=auth_headers,
    )
    doc_id = upload.json()["id"]

    resp = await client.get(
        f"/api/workspaces/{workspace_id}/documents/{doc_id}",
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == doc_id


@pytest.mark.asyncio
async def test_get_document_status_admin_can_access_foreign_workspace(
    client: AsyncClient,
    auth_headers: dict[str, str],
    admin_headers: dict[str, str],
    workspace_id: str,
):
    """Admin can GET document status in a workspace they don't own/belong to (bug #2)."""
    upload = await client.post(
        f"/api/workspaces/{workspace_id}/documents",
        files={"file": ("admin_status_test.txt", b"admin visible status", "text/plain")},
        headers=auth_headers,
    )
    doc_id = upload.json()["id"]

    resp = await client.get(
        f"/api/workspaces/{workspace_id}/documents/{doc_id}/status",
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == doc_id


@pytest.mark.asyncio
async def test_get_document_non_admin_non_member_forbidden(
    client: AsyncClient,
    test_db: AsyncSession,
    auth_headers: dict[str, str],
    workspace_id: str,
):
    """A non-member, non-admin user still gets 403 on document detail (no over-widening)."""
    upload = await client.post(
        f"/api/workspaces/{workspace_id}/documents",
        files={"file": ("stranger_test.txt", b"not for you", "text/plain")},
        headers=auth_headers,
    )
    doc_id = upload.json()["id"]

    stranger = User(
        email="strangerdoc@example.com",
        username="strangerdoc",
        password_hash="hash",
        role="user",
        is_active=True,
    )
    test_db.add(stranger)
    await test_db.commit()
    await test_db.refresh(stranger)
    stranger_token = create_access_token(stranger.id, stranger.role)
    stranger_headers = {"Authorization": f"Bearer {stranger_token}"}

    resp = await client.get(
        f"/api/workspaces/{workspace_id}/documents/{doc_id}",
        headers=stranger_headers,
    )
    assert resp.status_code == 403

    resp_status = await client.get(
        f"/api/workspaces/{workspace_id}/documents/{doc_id}/status",
        headers=stranger_headers,
    )
    assert resp_status.status_code == 403


@pytest.mark.asyncio
async def test_get_document_chunks_capped(
    client: AsyncClient,
    auth_headers: dict[str, str],
    workspace_id: str,
    test_db: AsyncSession,
):
    """Document detail response caps chunk payload length."""
    upload = await client.post(
        f"/api/workspaces/{workspace_id}/documents",
        files={"file": ("capped.txt", b"content", "text/plain")},
        headers=auth_headers,
    )
    doc_id = upload.json()["id"]

    for i in range(MAX_DETAIL_CHUNKS + 25):
        test_db.add(Chunk(
            document_id=doc_id,
            index=1000 + i,
            content=f"chunk {i}",
            token_count=2,
        ))
    await test_db.commit()

    resp = await client.get(
        f"/api/workspaces/{workspace_id}/documents/{doc_id}",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert len(resp.json()["chunks"]) == MAX_DETAIL_CHUNKS


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
    fake_indexer = types.ModuleType("app.ingestion.indexer")
    fake_indexer.delete_document = AsyncMock()
    with patch.dict(sys.modules, {"app.ingestion.indexer": fake_indexer}):
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


@pytest.mark.asyncio
async def test_upload_document_rejects_oversize_without_read():
    """Content-Length oversize path rejects before reading file body."""
    from types import SimpleNamespace

    class NeverReadUpload:
        filename = "big.txt"
        content_type = "text/plain"
        headers = {"content-length": "6"}

        async def read(self, size: int = -1):
            raise AssertionError("read() should not be called")

    with patch("app.api.documents.MAX_FILE_SIZE", 5):
        with pytest.raises(TooLargeException):
            await upload_document(
                workspace_id="ws-1",
                file=NeverReadUpload(),
                current_user=SimpleNamespace(id="user-1"),
                workspace=SimpleNamespace(owner_id="user-1"),
                db=None,
            )


@pytest.mark.asyncio
async def test_upload_document_oversize_returns_413(client: AsyncClient, auth_headers: dict[str, str], workspace_id: str):
    """API returns 413 for oversized uploads."""
    with patch("app.api.documents.MAX_FILE_SIZE", 5):
        resp = await client.post(
            f"/api/workspaces/{workspace_id}/documents",
            files={"file": ("big.txt", b"123456", "text/plain")},
            headers=auth_headers,
        )
    assert resp.status_code == 413


@pytest.mark.asyncio
async def test_viewer_cannot_delete_document(
    client: AsyncClient,
    auth_headers: dict[str, str],
    workspace_id: str,
    test_db: AsyncSession,
):
    """Viewer role is forbidden from destructive document delete action."""
    upload = await client.post(
        f"/api/workspaces/{workspace_id}/documents",
        files={"file": ("viewer-delete.txt", b"delete me", "text/plain")},
        headers=auth_headers,
    )
    doc_id = upload.json()["id"]

    viewer = User(
        email="viewer@example.com",
        username="vieweruser",
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

    viewer_token = create_access_token(viewer.id, viewer.role)
    viewer_headers = {"Authorization": f"Bearer {viewer_token}"}

    fake_indexer = types.ModuleType("app.ingestion.indexer")
    fake_indexer.delete_document = AsyncMock()
    with patch.dict(sys.modules, {"app.ingestion.indexer": fake_indexer}):
        resp = await client.delete(
            f"/api/workspaces/{workspace_id}/documents/{doc_id}",
            headers=viewer_headers,
        )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_viewer_cannot_upload_document(
    client: AsyncClient,
    auth_headers: dict[str, str],
    workspace_id: str,
    test_db: AsyncSession,
):
    """Viewer role cannot upload documents."""
    viewer = User(
        email="viewerupload@example.com",
        username="viewerupload",
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

    viewer_token = create_access_token(viewer.id, viewer.role)
    viewer_headers = {"Authorization": f"Bearer {viewer_token}"}

    resp = await client.post(
        f"/api/workspaces/{workspace_id}/documents",
        files={"file": ("viewer-upload.txt", b"blocked", "text/plain")},
        headers=viewer_headers,
    )

    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "FORBIDDEN"
