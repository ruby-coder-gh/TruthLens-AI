"""Tests for query rewrite."""

from __future__ import annotations

import pytest

from app.retrieval.query_rewrite import rewrite, expand


@pytest.mark.asyncio
async def test_rewrite_returns_string():
    """Test rewrite returns a string (even if LLM unavailable, falls back to original)."""
    result = await rewrite("What is RAG?")
    assert isinstance(result, str)
    assert len(result) > 0


@pytest.mark.asyncio
async def test_rewrite_empty():
    """Test rewriting empty string."""
    result = await rewrite("")
    assert isinstance(result, str)


@pytest.mark.asyncio
async def test_expand_returns_list():
    """Test expand returns list containing original query."""
    result = await expand("RAG system", n_variations=2)
    assert isinstance(result, list)
    assert len(result) >= 1
    assert "RAG system" in result
