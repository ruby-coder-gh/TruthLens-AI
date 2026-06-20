"""Tests for query API routes."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_list_queries_no_auth(client: AsyncClient):
    """Test listing queries without auth."""
    response = await client.get("/api/workspaces/ws-id/queries")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_query_no_auth(client: AsyncClient):
    """Test getting query without auth."""
    response = await client.get("/api/workspaces/ws-id/queries/q-id")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_delete_query_no_auth(client: AsyncClient):
    """Test deleting query without auth."""
    response = await client.delete("/api/workspaces/ws-id/queries/q-id")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_sources_no_auth(client: AsyncClient):
    """Test getting query sources without auth."""
    response = await client.get("/api/workspaces/ws-id/queries/q-id/sources")
    assert response.status_code == 401
