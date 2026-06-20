"""Tests for embedder."""

from __future__ import annotations

import uuid

import numpy as np
import pytest

from app.ingestion.chunker import ChunkResult
from app.ingestion.embedder import EmbeddingResult, embed


@pytest.mark.asyncio
async def test_embed_empty():
    """Test embedding empty list."""
    results = await embed([])
    assert len(results) == 0


@pytest.mark.asyncio
async def test_embed_single_chunk():
    """Test embedding a single chunk."""
    chunk = ChunkResult(
        id=str(uuid.uuid4()),
        document_id=str(uuid.uuid4()),
        index=0,
        content="This is a test chunk for embedding.",
        token_count=10,
        page_number=1,
    )
    results = await embed([chunk])
    assert len(results) == 1
    assert isinstance(results[0], EmbeddingResult)
    assert isinstance(results[0].embedding, np.ndarray)
    assert len(results[0].embedding) > 0


@pytest.mark.asyncio
async def test_embed_metadata():
    """Test that metadata is preserved in embedding result."""
    chunk = ChunkResult(
        id=str(uuid.uuid4()),
        document_id=str(uuid.uuid4()),
        index=0,
        content="Test content.",
        token_count=5,
        page_number=1,
        metadata={"source": "test"},
    )
    results = await embed([chunk])
    assert results[0].metadata["chunk_id"] == chunk.id
    assert results[0].metadata["document_id"] == chunk.document_id
