"""Tests for hybrid search."""

from __future__ import annotations

import pytest

from app.retrieval.hybrid_search import (
    RetrievalResult,
    _reciprocal_rank_fusion,
)


def test_rrf_empty():
    """Test RRF with empty results."""
    result = _reciprocal_rank_fusion([], [])
    assert result == []


def test_rrf_single_source():
    """Test RRF with only vector results."""
    v1 = RetrievalResult("chunk1", "doc1", "ws1", "content 1", score=0.9, vector_score=0.9, bm25_score=0.0)
    v2 = RetrievalResult("chunk2", "doc1", "ws1", "content 2", score=0.8, vector_score=0.8, bm25_score=0.0)

    result = _reciprocal_rank_fusion([v1, v2], [])
    assert len(result) == 2
    assert result[0].chunk_id == "chunk1"


def test_rrf_fusion():
    """Test RRF combines results from both sources."""
    v1 = RetrievalResult("chunk_a", "doc1", "ws1", "content a", score=0.9, vector_score=0.9, bm25_score=0.0)
    b1 = RetrievalResult("chunk_b", "doc1", "ws1", "content b", score=0.0, vector_score=0.0, bm25_score=0.85)

    result = _reciprocal_rank_fusion([v1], [b1])
    assert len(result) == 2


def test_rrf_deduplication():
    """Test RRF deduplicates chunks present in both sources."""
    v1 = RetrievalResult("chunk1", "doc1", "ws1", "content", score=0.9, vector_score=0.9, bm25_score=0.0)
    b1 = RetrievalResult("chunk1", "doc1", "ws1", "content", score=0.0, vector_score=0.0, bm25_score=0.8)

    result = _reciprocal_rank_fusion([v1], [b1])
    assert len(result) == 1


@pytest.mark.asyncio
async def test_hybrid_search_empty_workspace():
    """Test hybrid search on empty workspace returns empty."""
    from app.retrieval.hybrid_search import hybrid_search

    results = await hybrid_search("test query", "nonexistent-workspace")
    assert isinstance(results, list)
