"""Tests for document API routes."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_upload_document_no_auth(client: AsyncClient):
    """Test uploading without auth."""
    response = await client.post(
        "/api/workspaces/ws-id/documents",
        files={"file": ("test.txt", b"hello world", "text/plain")},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_list_documents_no_auth(client: AsyncClient):
    """Test listing documents without auth."""
    response = await client.get("/api/workspaces/ws-id/documents")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_document_no_auth(client: AsyncClient):
    """Test getting document without auth."""
    response = await client.get("/api/workspaces/ws-id/documents/doc-id")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_document_status_no_auth(client: AsyncClient):
    """Test getting document status without auth."""
    response = await client.get("/api/workspaces/ws-id/documents/doc-id/status")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_delete_document_no_auth(client: AsyncClient):
    """Test deleting document without auth."""
    response = await client.delete("/api/workspaces/ws-id/documents/doc-id")
    assert response.status_code == 401
