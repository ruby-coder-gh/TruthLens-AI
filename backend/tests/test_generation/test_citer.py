"""Tests for citation matcher."""

from __future__ import annotations

import pytest

from app.generation.citer import cite


@pytest.mark.asyncio
async def test_cite_no_sources():
    """Test citing with no explicit sources."""
    spans = await cite("This is a test answer.", [])
    assert isinstance(spans, list)


@pytest.mark.asyncio
async def test_cite_explicit_source():
    """Test citing with explicit [source:N] markers."""
    answer = "According to [source:1], this is a fact."
    contexts = [{"chunk_id": "chunk1", "content": "This is a fact.", "score": 0.9}]
    spans = await cite(answer, contexts)
    assert len(spans) > 0
    assert any(s.chunk_id == "chunk1" for s in spans)


@pytest.mark.asyncio
async def test_cite_no_markers():
    """Test citing answer without explicit markers."""
    answer = "The sky is blue and the grass is green."
    contexts = [
        {"chunk_id": "c1", "content": "The sky is blue.", "score": 0.8},
        {"chunk_id": "c2", "content": "The grass is green.", "score": 0.7},
    ]
    spans = await cite(answer, contexts)

    # Should use semantic matching
    assert isinstance(spans, list)
