"""Tests for chunker."""

from __future__ import annotations

import uuid

import pytest

from app.ingestion.chunker import chunk


@pytest.mark.asyncio
async def test_chunk_simple():
    """Test basic chunking."""
    pages = [
        {"text": "This is a test document. " * 50, "page_number": 1, "metadata": {}}
    ]
    doc_id = str(uuid.uuid4())
    results = await chunk(pages, doc_id, chunk_size=100, chunk_overlap=20)

    assert len(results) > 0
    assert results[0].document_id == doc_id
    assert results[0].index == 0
    assert results[1].index == 1


@pytest.mark.asyncio
async def test_chunk_empty_page():
    """Test chunking with empty pages."""
    pages = [
        {"text": "", "page_number": 1, "metadata": {}},
        {"text": "Some content", "page_number": 2, "metadata": {}},
    ]
    doc_id = str(uuid.uuid4())
    results = await chunk(pages, doc_id)

    assert len(results) == 1
    assert results[0].content == "Some content"


@pytest.mark.asyncio
async def test_chunk_no_pages():
    """Test chunking with no pages."""
    results = await chunk([], str(uuid.uuid4()))
    assert len(results) == 0


@pytest.mark.asyncio
async def test_chunk_sequential_indices():
    """Test that chunk indices are sequential."""
    pages = [
        {"text": "First page. " * 30, "page_number": 1, "metadata": {}},
        {"text": "Second page. " * 30, "page_number": 2, "metadata": {}},
    ]
    doc_id = str(uuid.uuid4())
    results = await chunk(pages, doc_id, chunk_size=50, chunk_overlap=10)

    indices = [r.index for r in results]
    assert indices == list(range(len(results)))


@pytest.mark.asyncio
async def test_chunk_token_count():
    """Test token count estimation."""
    pages = [
        {"text": "Hello world, this is a test.", "page_number": 1, "metadata": {}}
    ]
    doc_id = str(uuid.uuid4())
    results = await chunk(pages, doc_id)

    if results:
        assert results[0].token_count > 0
