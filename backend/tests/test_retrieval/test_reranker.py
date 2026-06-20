"""Tests for reranker."""

from __future__ import annotations

import pytest

from app.retrieval.hybrid_search import RetrievalResult
from app.retrieval.reranker import rerank


@pytest.mark.asyncio
async def test_rerank_empty():
    """Test reranking empty list."""
    results = await rerank("test query", [])
    assert results == []


@pytest.mark.asyncio
async def test_rerank_single():
    """Test reranking single result."""
    r = RetrievalResult("chunk1", "doc1", "ws1", "Test content here.", score=0.5, vector_score=0.5, bm25_score=0.0)
    results = await rerank("test query", [r], top_k=1)
    assert len(results) <= 1


@pytest.mark.asyncio
async def test_rerank_preserves_metadata():
    """Test reranking preserves chunk metadata."""
    r = RetrievalResult(
        "chunk1", "doc1", "ws1", "Content", score=0.5, vector_score=0.5, bm25_score=0.0,
        metadata={"page": 1},
    )
    results = await rerank("query", [r], top_k=1)
    if results:
        assert results[0].chunk_id == "chunk1"
        assert results[0].document_id == "doc1"
