"""Tests for GET /api/documents (list all documents across accessible workspaces)."""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token
from app.models.document import Document
from app.models.user import User
from app.models.workspace import Workspace


@pytest.mark.asyncio
async def test_list_all_documents_owner_without_membership_sees_own_docs(
    client: AsyncClient, test_db: AsyncSession, test_user: User
):
    """A workspace owner with no WorkspaceMember row still sees their own documents (bug fix)."""
    # Create the workspace directly, bypassing the API, so no WorkspaceMember
    # row is created for the owner (legacy-workspace shape).
    ws = Workspace(name="Owner-only WS", owner_id=test_user.id)
    test_db.add(ws)
    await test_db.commit()
    await test_db.refresh(ws)

    token = create_access_token(test_user.id, test_user.role)
    headers = {"Authorization": f"Bearer {token}"}

    upload = await client.post(
        f"/api/workspaces/{ws.id}/documents",
        files={"file": ("owner.txt", b"owner content", "text/plain")},
        headers=headers,
    )
    assert upload.status_code == 202
    doc_id = upload.json()["id"]

    resp = await client.get("/api/documents", headers=headers)
    assert resp.status_code == 200
    ids = [d["id"] for d in resp.json()["data"]]
    assert doc_id in ids


@pytest.mark.asyncio
async def test_list_all_documents_non_member_non_owner_does_not_see_docs(
    client: AsyncClient, test_db: AsyncSession, test_user: User
):
    """A stranger (not owner, not member) does not see another user's workspace documents."""
    ws = Workspace(name="Private WS", owner_id=test_user.id)
    test_db.add(ws)
    await test_db.commit()
    await test_db.refresh(ws)

    doc = Document(
        workspace_id=ws.id,
        filename=f"{uuid.uuid4().hex}.txt",
        original_filename="private.txt",
        mime_type="text/plain",
        file_size=1,
        status="ready",
    )
    test_db.add(doc)
    await test_db.commit()
    await test_db.refresh(doc)

    stranger = User(
        email="stranger-list-all@example.com",
        username="strangerlistall",
        password_hash="hash",
        role="user",
        is_active=True,
    )
    test_db.add(stranger)
    await test_db.commit()
    await test_db.refresh(stranger)
    stranger_token = create_access_token(stranger.id, stranger.role)
    stranger_headers = {"Authorization": f"Bearer {stranger_token}"}

    resp = await client.get("/api/documents", headers=stranger_headers)
    assert resp.status_code == 200
    ids = [d["id"] for d in resp.json()["data"]]
    assert doc.id not in ids


@pytest.mark.asyncio
async def test_list_all_documents_tags_filter(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession, test_user: User
):
    """The tags query param filters to documents carrying that tag and tags are returned."""
    ws = Workspace(name="Tag WS", owner_id=test_user.id)
    test_db.add(ws)
    await test_db.commit()
    await test_db.refresh(ws)

    doc_a = Document(
        workspace_id=ws.id,
        filename=f"{uuid.uuid4().hex}.txt",
        original_filename="a.txt",
        mime_type="text/plain",
        file_size=1,
        status="ready",
        tags=["urgent", "reviewed"],
    )
    doc_b = Document(
        workspace_id=ws.id,
        filename=f"{uuid.uuid4().hex}.txt",
        original_filename="b.txt",
        mime_type="text/plain",
        file_size=1,
        status="ready",
        tags=["reviewed"],
    )
    test_db.add_all([doc_a, doc_b])
    await test_db.commit()
    await test_db.refresh(doc_a)
    await test_db.refresh(doc_b)

    resp = await client.get("/api/documents?tags=urgent", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()["data"]
    ids = [d["id"] for d in data]
    assert doc_a.id in ids
    assert doc_b.id not in ids

    matched = next(d for d in data if d["id"] == doc_a.id)
    assert set(matched["tags"]) == {"urgent", "reviewed"}


@pytest.mark.asyncio
async def test_list_all_documents_tags_filter_and_semantics(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession, test_user: User
):
    """Multiple comma-separated tags require a document to carry all of them."""
    ws = Workspace(name="Tag WS 2", owner_id=test_user.id)
    test_db.add(ws)
    await test_db.commit()
    await test_db.refresh(ws)

    doc_both = Document(
        workspace_id=ws.id,
        filename=f"{uuid.uuid4().hex}.txt",
        original_filename="both.txt",
        mime_type="text/plain",
        file_size=1,
        status="ready",
        tags=["urgent", "reviewed"],
    )
    doc_one = Document(
        workspace_id=ws.id,
        filename=f"{uuid.uuid4().hex}.txt",
        original_filename="one.txt",
        mime_type="text/plain",
        file_size=1,
        status="ready",
        tags=["urgent"],
    )
    test_db.add_all([doc_both, doc_one])
    await test_db.commit()
    await test_db.refresh(doc_both)
    await test_db.refresh(doc_one)

    resp = await client.get("/api/documents?tags=urgent,reviewed", headers=admin_headers)
    assert resp.status_code == 200
    ids = [d["id"] for d in resp.json()["data"]]
    assert doc_both.id in ids
    assert doc_one.id not in ids


@pytest.mark.asyncio
async def test_list_all_documents_tags_filter_escapes_like_wildcards(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession, test_user: User
):
    """A literal "_"/"%" in a tag value must not act as a SQL LIKE wildcard."""
    ws = Workspace(name="Escape WS", owner_id=test_user.id)
    test_db.add(ws)
    await test_db.commit()
    await test_db.refresh(ws)

    doc_exact = Document(
        workspace_id=ws.id,
        filename=f"{uuid.uuid4().hex}.txt",
        original_filename="exact.txt",
        mime_type="text/plain",
        file_size=1,
        status="ready",
        tags=["q1_2026"],
    )
    doc_wild = Document(
        workspace_id=ws.id,
        filename=f"{uuid.uuid4().hex}.txt",
        original_filename="wild.txt",
        mime_type="text/plain",
        file_size=1,
        status="ready",
        tags=["q1x2026"],
    )
    test_db.add_all([doc_exact, doc_wild])
    await test_db.commit()
    await test_db.refresh(doc_exact)
    await test_db.refresh(doc_wild)

    # "_" in "q1_2026" must match literally, not as a single-char wildcard
    # that would also match "q1x2026".
    resp = await client.get("/api/documents?tags=q1_2026", headers=admin_headers)
    assert resp.status_code == 200
    ids = [d["id"] for d in resp.json()["data"]]
    assert doc_exact.id in ids
    assert doc_wild.id not in ids

    # A bare "%" must not match every tagged document.
    resp = await client.get("/api/documents?tags=%25", headers=admin_headers)
    assert resp.status_code == 200
    ids = [d["id"] for d in resp.json()["data"]]
    assert doc_exact.id not in ids
    assert doc_wild.id not in ids
