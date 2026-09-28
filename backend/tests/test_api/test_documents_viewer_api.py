"""HTTP tests for the source-viewer endpoints: GET .../file and .../locate."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth import create_access_token
from app.models.chunk import Chunk
from app.models.document import Document
from app.models.user import User


@pytest.fixture
async def workspace_id(client: AsyncClient, auth_headers: dict[str, str]) -> str:
    """Create workspace and return its id."""
    resp = await client.post(
        "/api/workspaces",
        json={"name": "Viewer Test WS", "description": "for source viewer"},
        headers=auth_headers,
    )
    return resp.json()["id"]


def _build_two_page_pdf(path: Path) -> tuple[str, str]:
    """Write a real 2-page PDF to `path`; return (page1_text, page2_text)."""
    import fitz

    page1_text = "The quick brown fox jumps over the lazy dog. It ran across the field quickly."
    page2_text = "Renewable energy adoption is accelerating worldwide in most major economies."

    doc = fitz.open()
    page1 = doc.new_page()
    page1.insert_text((72, 100), page1_text, fontsize=11)
    page2 = doc.new_page()
    page2.insert_text((72, 100), page2_text, fontsize=11)
    doc.save(path)
    doc.close()
    return page1_text, page2_text


async def _make_document(
    test_db: AsyncSession,
    workspace_id: str,
    *,
    filename: str,
    original_filename: str,
    mime_type: str,
    write_bytes: bytes | None = None,
) -> Document:
    """Create a Document row and, unless write_bytes is None, the backing file."""
    doc = Document(
        workspace_id=workspace_id,
        filename=filename,
        original_filename=original_filename,
        mime_type=mime_type,
        file_size=len(write_bytes or b""),
        status="ready",
    )
    test_db.add(doc)
    await test_db.commit()
    await test_db.refresh(doc)

    if write_bytes is not None:
        settings.upload_path.mkdir(parents=True, exist_ok=True)
        (settings.upload_path / filename).write_bytes(write_bytes)

    return doc


# ── GET .../file ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_file_pdf_content_type(client: AsyncClient, auth_headers, workspace_id, test_db):
    """PDF document is served as application/pdf, inline."""
    pdf_path_name = "viewer-file-1.pdf"
    tmp_target = settings.upload_path / pdf_path_name
    settings.upload_path.mkdir(parents=True, exist_ok=True)
    _build_two_page_pdf(tmp_target)

    doc = Document(
        workspace_id=workspace_id,
        filename=pdf_path_name,
        original_filename="report.pdf",
        mime_type="application/pdf",
        file_size=tmp_target.stat().st_size,
        status="ready",
    )
    test_db.add(doc)
    await test_db.commit()
    await test_db.refresh(doc)

    resp = await client.get(
        f"/api/workspaces/{workspace_id}/documents/{doc.id}/file",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/pdf")
    assert "inline" in resp.headers["content-disposition"]
    assert "report.pdf" in resp.headers["content-disposition"]
    assert resp.headers["x-content-type-options"] == "nosniff"


@pytest.mark.asyncio
async def test_get_file_markdown_forced_text_plain(client: AsyncClient, auth_headers, workspace_id, test_db):
    """A .md upload is served as text/plain, never text/html (stored-XSS guard)."""
    doc = await _make_document(
        test_db,
        workspace_id,
        filename="viewer-file-2.md",
        original_filename="notes.md",
        mime_type="text/markdown",
        write_bytes=b"# Title\n\n<script>alert(1)</script>\n",
    )

    resp = await client.get(
        f"/api/workspaces/{workspace_id}/documents/{doc.id}/file",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "text/plain; charset=utf-8"
    assert "html" not in resp.headers["content-type"]


@pytest.mark.asyncio
async def test_get_file_missing_on_disk_404(client: AsyncClient, auth_headers, workspace_id, test_db):
    """Document row exists but the file was removed from storage → 404, not 500."""
    doc = await _make_document(
        test_db,
        workspace_id,
        filename="gone.txt",
        original_filename="gone.txt",
        mime_type="text/plain",
        write_bytes=None,
    )

    resp = await client.get(
        f"/api/workspaces/{workspace_id}/documents/{doc.id}/file",
        headers=auth_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_file_wrong_document_id_404(client: AsyncClient, auth_headers, workspace_id):
    resp = await client.get(
        f"/api/workspaces/{workspace_id}/documents/nonexistent/file",
        headers=auth_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_file_wrong_workspace_404(client: AsyncClient, auth_headers, workspace_id, test_db):
    """A document that belongs to a different workspace is not reachable via this one."""
    other_ws = await client.post(
        "/api/workspaces",
        json={"name": "Other WS", "description": "x"},
        headers=auth_headers,
    )
    other_workspace_id = other_ws.json()["id"]

    doc = await _make_document(
        test_db,
        other_workspace_id,
        filename="in-other-ws.txt",
        original_filename="in-other-ws.txt",
        mime_type="text/plain",
        write_bytes=b"hello",
    )

    resp = await client.get(
        f"/api/workspaces/{workspace_id}/documents/{doc.id}/file",
        headers=auth_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_file_non_member_forbidden(client: AsyncClient, test_db, auth_headers, workspace_id):
    """A non-member, non-admin user gets 403 (matches check_workspace_access_or_admin)."""
    doc = await _make_document(
        test_db,
        workspace_id,
        filename="private.txt",
        original_filename="private.txt",
        mime_type="text/plain",
        write_bytes=b"secret",
    )

    stranger = User(
        email="strangerviewer@example.com",
        username="strangerviewer",
        password_hash="hash",
        role="user",
        is_active=True,
    )
    test_db.add(stranger)
    await test_db.commit()
    await test_db.refresh(stranger)
    stranger_headers = {"Authorization": f"Bearer {create_access_token(stranger.id, stranger.role)}"}

    resp = await client.get(
        f"/api/workspaces/{workspace_id}/documents/{doc.id}/file",
        headers=stranger_headers,
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_get_file_admin_can_access_foreign_workspace(client: AsyncClient, auth_headers, admin_headers, workspace_id, test_db):
    doc = await _make_document(
        test_db,
        workspace_id,
        filename="admin-visible.txt",
        original_filename="admin-visible.txt",
        mime_type="text/plain",
        write_bytes=b"admin can see this",
    )

    resp = await client.get(
        f"/api/workspaces/{workspace_id}/documents/{doc.id}/file",
        headers=admin_headers,
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_get_file_no_auth_401(client: AsyncClient, workspace_id, test_db):
    doc = await _make_document(
        test_db,
        workspace_id,
        filename="noauth.txt",
        original_filename="noauth.txt",
        mime_type="text/plain",
        write_bytes=b"x",
    )
    resp = await client.get(f"/api/workspaces/{workspace_id}/documents/{doc.id}/file")
    assert resp.status_code == 401


# ── GET .../chunks/{chunk_id}/locate ────────────────────────────────────────


@pytest.mark.asyncio
async def test_locate_pdf_mode_returns_page_and_rects(client: AsyncClient, auth_headers, workspace_id, test_db):
    """PDF chunk: monkeypatched Chroma page lookup drives PyMuPDF search;
    the response carries the correct page and non-empty in-bounds rects."""
    pdf_path_name = "locate-1.pdf"
    tmp_target = settings.upload_path / pdf_path_name
    settings.upload_path.mkdir(parents=True, exist_ok=True)
    page1_text, page2_text = _build_two_page_pdf(tmp_target)

    doc = Document(
        workspace_id=workspace_id,
        filename=pdf_path_name,
        original_filename="locate.pdf",
        mime_type="application/pdf",
        file_size=tmp_target.stat().st_size,
        status="ready",
    )
    test_db.add(doc)
    await test_db.commit()
    await test_db.refresh(doc)

    chunk = Chunk(document_id=doc.id, index=1, content=page2_text, token_count=10)
    test_db.add(chunk)
    await test_db.commit()
    await test_db.refresh(chunk)

    with patch("app.api.documents._lookup_chroma_page_number", return_value=2):
        resp = await client.get(
            f"/api/workspaces/{workspace_id}/documents/{doc.id}/chunks/{chunk.id}/locate",
            headers=auth_headers,
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["mode"] == "pdf"
    assert body["page_number"] == 2
    assert body["page_count"] == 2
    assert body["page_width"] > 0
    assert body["page_height"] > 0
    assert body["content"] == page2_text
    assert body["context_before"] is None
    assert body["context_after"] is None
    assert len(body["rects"]) > 0
    for rect in body["rects"]:
        x0, y0, x1, y1 = rect
        assert 0 <= x0 < x1 <= body["page_width"]
        assert 0 <= y0 < y1 <= body["page_height"]


@pytest.mark.asyncio
async def test_locate_pdf_fallback_searches_every_page(client: AsyncClient, auth_headers, workspace_id, test_db):
    """A wrong/stale page hint still finds the passage via the full-document fallback."""
    pdf_path_name = "locate-2.pdf"
    tmp_target = settings.upload_path / pdf_path_name
    settings.upload_path.mkdir(parents=True, exist_ok=True)
    page1_text, page2_text = _build_two_page_pdf(tmp_target)

    doc = Document(
        workspace_id=workspace_id,
        filename=pdf_path_name,
        original_filename="locate2.pdf",
        mime_type="application/pdf",
        file_size=tmp_target.stat().st_size,
        status="ready",
    )
    test_db.add(doc)
    await test_db.commit()
    await test_db.refresh(doc)

    # Chunk content actually lives on page 2, but the (bogus) hint says page 1.
    chunk = Chunk(document_id=doc.id, index=1, content=page2_text, token_count=10)
    test_db.add(chunk)
    await test_db.commit()
    await test_db.refresh(chunk)

    with patch("app.api.documents._lookup_chroma_page_number", return_value=1):
        resp = await client.get(
            f"/api/workspaces/{workspace_id}/documents/{doc.id}/chunks/{chunk.id}/locate",
            headers=auth_headers,
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["mode"] == "pdf"
    assert body["page_number"] == 2
    assert len(body["rects"]) > 0


@pytest.mark.asyncio
async def test_locate_text_mode_with_neighbours(client: AsyncClient, auth_headers, workspace_id, test_db):
    """Non-PDF document: text mode, with neighbouring-chunk context."""
    doc = await _make_document(
        test_db,
        workspace_id,
        filename="locate.txt",
        original_filename="locate.txt",
        mime_type="text/plain",
        write_bytes=b"whole document body",
    )

    prev_chunk = Chunk(document_id=doc.id, index=0, content="Previous passage content. " * 30, token_count=10)
    middle_chunk = Chunk(document_id=doc.id, index=1, content="The middle passage under test.", token_count=5)
    next_chunk = Chunk(document_id=doc.id, index=2, content="Next passage content. " * 30, token_count=10)
    test_db.add_all([prev_chunk, middle_chunk, next_chunk])
    await test_db.commit()
    await test_db.refresh(middle_chunk)

    resp = await client.get(
        f"/api/workspaces/{workspace_id}/documents/{doc.id}/chunks/{middle_chunk.id}/locate",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["mode"] == "text"
    assert body["page_number"] is None
    assert body["rects"] == []
    assert body["content"] == "The middle passage under test."
    assert body["context_before"] == prev_chunk.content[-600:]
    assert body["context_after"] == next_chunk.content[:600]


@pytest.mark.asyncio
async def test_locate_text_mode_no_neighbours(client: AsyncClient, auth_headers, workspace_id, test_db):
    """Single-chunk document: context_before/after are null, not an error."""
    doc = await _make_document(
        test_db,
        workspace_id,
        filename="solo.txt",
        original_filename="solo.txt",
        mime_type="text/plain",
        write_bytes=b"solo",
    )
    chunk = Chunk(document_id=doc.id, index=0, content="Only passage.", token_count=2)
    test_db.add(chunk)
    await test_db.commit()
    await test_db.refresh(chunk)

    resp = await client.get(
        f"/api/workspaces/{workspace_id}/documents/{doc.id}/chunks/{chunk.id}/locate",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["mode"] == "text"
    assert body["context_before"] is None
    assert body["context_after"] is None


@pytest.mark.asyncio
async def test_locate_pdf_file_missing_falls_back_to_text_mode(client: AsyncClient, auth_headers, workspace_id, test_db):
    """PDF row exists but the file was deleted from storage: falls back to
    text mode from the chunk content in SQLite, instead of a 500."""
    doc = Document(
        workspace_id=workspace_id,
        filename="missing.pdf",
        original_filename="missing.pdf",
        mime_type="application/pdf",
        file_size=0,
        status="ready",
    )
    test_db.add(doc)
    await test_db.commit()
    await test_db.refresh(doc)

    chunk = Chunk(document_id=doc.id, index=0, content="Content from a PDF whose file vanished.", token_count=8)
    test_db.add(chunk)
    await test_db.commit()
    await test_db.refresh(chunk)

    resp = await client.get(
        f"/api/workspaces/{workspace_id}/documents/{doc.id}/chunks/{chunk.id}/locate",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["mode"] == "text"
    assert body["content"] == chunk.content


@pytest.mark.asyncio
async def test_locate_chunk_not_found_404(client: AsyncClient, auth_headers, workspace_id, test_db):
    doc = await _make_document(
        test_db,
        workspace_id,
        filename="haschunk.txt",
        original_filename="haschunk.txt",
        mime_type="text/plain",
        write_bytes=b"x",
    )
    resp = await client.get(
        f"/api/workspaces/{workspace_id}/documents/{doc.id}/chunks/nonexistent-chunk/locate",
        headers=auth_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_locate_chunk_from_other_document_404(client: AsyncClient, auth_headers, workspace_id, test_db):
    """A chunk that belongs to a different document (even in the same workspace) 404s."""
    doc_a = await _make_document(
        test_db, workspace_id, filename="a.txt", original_filename="a.txt",
        mime_type="text/plain", write_bytes=b"a",
    )
    doc_b = await _make_document(
        test_db, workspace_id, filename="b.txt", original_filename="b.txt",
        mime_type="text/plain", write_bytes=b"b",
    )
    chunk_of_b = Chunk(document_id=doc_b.id, index=0, content="belongs to b", token_count=3)
    test_db.add(chunk_of_b)
    await test_db.commit()
    await test_db.refresh(chunk_of_b)

    resp = await client.get(
        f"/api/workspaces/{workspace_id}/documents/{doc_a.id}/chunks/{chunk_of_b.id}/locate",
        headers=auth_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_locate_no_auth_401(client: AsyncClient, workspace_id, test_db):
    doc = await _make_document(
        test_db, workspace_id, filename="noauthloc.txt", original_filename="noauthloc.txt",
        mime_type="text/plain", write_bytes=b"x",
    )
    chunk = Chunk(document_id=doc.id, index=0, content="content", token_count=1)
    test_db.add(chunk)
    await test_db.commit()
    await test_db.refresh(chunk)

    resp = await client.get(f"/api/workspaces/{workspace_id}/documents/{doc.id}/chunks/{chunk.id}/locate")
    assert resp.status_code == 401
