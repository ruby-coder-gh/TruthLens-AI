"""Tests for indexer."""

from __future__ import annotations

import uuid

import pytest



@pytest.mark.asyncio
async def test_store_empty():
    """Test storing empty lists."""
    from app.ingestion.indexer import store

    result = await store([], [], str(uuid.uuid4()), str(uuid.uuid4()))
    assert result == 0


@pytest.mark.asyncio
async def test_delete_noop():
    """Test delete on non-existent document."""
    from app.ingestion.indexer import delete_document

    # Should not raise
    await delete_document(str(uuid.uuid4()), str(uuid.uuid4()))
