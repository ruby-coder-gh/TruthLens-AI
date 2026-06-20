"""Tests for parent-document retrieval."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.retrieval.hybrid_search import RetrievalResult
from app.retrieval.parent_retrieval import expand_with_parent


# ── Mock data ──────────────────────────────────────────────────────────

def _make_chunk(chunk_id: str, doc_id: str, index: int, content: str, **kwargs):
    """Create a mock Chunk-like object for DB query returns."""
    mock = MagicMock()
    mock.id = chunk_id
    mock.document_id = doc_id
    mock.index = index
    mock.content = content
    for k, v in kwargs.items():
        setattr(mock, k, v)
    return mock


def _make_result(chunk_id: str, doc_id: str, index: int, content: str, score: float = 0.9):
    """Create a RetrievalResult with chunk_index in metadata."""
    return RetrievalResult(
        chunk_id=chunk_id,
        document_id=doc_id,
        workspace_id="ws1",
        content=content,
        score=score,
        vector_score=score,
        bm25_score=0.0,
        metadata={"chunk_index": index, "document_id": doc_id},
    )


def _mock_db_session(sibling_chunks: list):
    """Create a mock DB session that returns given chunks on query.

    Uses MagicMock for execute() return because SQLAlchemy's scalars()
    and all() are synchronous, not awaitable.
    """
    session = AsyncMock()
    execute = MagicMock()
    scalars = MagicMock()
    scalars.all.return_value = sibling_chunks
    execute.scalars.return_value = scalars
    session.execute.return_value = execute
    return session


# ── Tests ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_expand_with_parent_basic():
    """Test basic expansion with window_size=1 adds both siblings."""
    chunk = _make_result("chunk2", "doc1", 2, "matched content")
    siblings = [
        _make_chunk("sib1", "doc1", 1, "before content"),
        _make_chunk("sib3", "doc1", 3, "after content"),
    ]

    session = _mock_db_session(siblings)

    with patch("app.retrieval.parent_retrieval.async_session_factory") as factory:
        factory.return_value.__aenter__.return_value = session
        result = await expand_with_parent([chunk], "ws1", window_size=1)

    # Matched chunk + before sibling + after sibling
    assert len(result) == 3, f"Expected 3 results, got {len(result)}"
    assert result[0].chunk_id == "sib1"
    assert result[0].metadata.get("is_parent_context") is True
    assert result[1].chunk_id == "chunk2"
    assert result[1].metadata.get("is_parent_context") is None
    assert result[2].chunk_id == "sib3"
    assert result[2].metadata.get("is_parent_context") is True


@pytest.mark.asyncio
async def test_expand_with_parent_window_zero():
    """Test window_size=0 returns original chunks with no extra siblings."""
    chunks = [
        _make_result("chunk1", "doc1", 0, "content a"),
        _make_result("chunk2", "doc1", 1, "content b"),
    ]

    result = await expand_with_parent(chunks, "ws1", window_size=0)

    assert len(result) == 2
    assert result[0].chunk_id == "chunk1"
    assert result[1].chunk_id == "chunk2"


@pytest.mark.asyncio
async def test_expand_with_parent_dedup():
    """Test duplicate chunk_ids are not added twice.

    Two matched chunks share a sibling — it should appear only once
    (attached to the first parent chunk that includes it).
    """
    chunks = [
        _make_result("chunk1", "doc1", 1, "content at 1"),
        _make_result("chunk2", "doc1", 2, "content at 2"),
    ]
    # chunk at index 2 is sibling of chunk1 (after), and chunk2 itself
    siblings = [
        _make_chunk("chunk2", "doc1", 2, "content at 2"),  # also matched!
    ]

    session = _mock_db_session(siblings)

    with patch("app.retrieval.parent_retrieval.async_session_factory") as factory:
        factory.return_value.__aenter__.return_value = session
        result = await expand_with_parent(chunks, "ws1", window_size=1)

    # chunk1, chunk2 (both matched, chunk2 only once)
    assert len(result) == 2
    chunk_ids = [r.chunk_id for r in result]
    assert chunk_ids == ["chunk1", "chunk2"]


@pytest.mark.asyncio
async def test_expand_with_parent_ordering():
    """Test ordering is preserved: matched chunks stay in order,
    siblings inserted adjacent to their parent."""
    chunks = [
        _make_result("chunkB", "doc1", 10, "second match"),
        _make_result("chunkA", "doc1", 5, "first match"),
    ]
    siblings = [
        _make_chunk("sibA_before", "doc1", 4, "before first"),
        _make_chunk("sibA_after", "doc1", 6, "after first"),
        _make_chunk("sibB_before", "doc1", 9, "before second"),
        _make_chunk("sibB_after", "doc1", 11, "after second"),
    ]

    session = _mock_db_session(siblings)

    with patch("app.retrieval.parent_retrieval.async_session_factory") as factory:
        factory.return_value.__aenter__.return_value = session
        result = await expand_with_parent(chunks, "ws1", window_size=1)

    chunk_ids = [r.chunk_id for r in result]
    # Input order: [chunkB, chunkA]; chunkB is first, so its group comes first
    expected = [
        "sibB_before",
        "chunkB",
        "sibB_after",
        "sibA_before",
        "chunkA",
        "sibA_after",
    ]
    assert chunk_ids == expected, f"Order mismatch:\n  got:      {chunk_ids}\n  expected: {expected}"


@pytest.mark.asyncio
async def test_expand_with_parent_empty():
    """Test empty input returns empty list."""
    result = await expand_with_parent([], "ws1", window_size=1)
    assert result == []


@pytest.mark.asyncio
async def test_expand_with_parent_single_no_siblings():
    """Test when no siblings exist, just the matched chunk returns."""
    chunk = _make_result("chunk1", "doc1", 0, "lonely chunk")

    session = _mock_db_session([])  # no siblings

    with patch("app.retrieval.parent_retrieval.async_session_factory") as factory:
        factory.return_value.__aenter__.return_value = session
        result = await expand_with_parent([chunk], "ws1", window_size=1)

    assert len(result) == 1
    assert result[0].chunk_id == "chunk1"


@pytest.mark.asyncio
async def test_expand_with_parent_metadata_fallback():
    """Test fallback to DB when metadata lacks chunk_index."""
    chunk = RetrievalResult(
        chunk_id="chunk1",
        document_id="doc1",
        workspace_id="ws1",
        content="no index in metadata",
        score=0.8,
        metadata={"document_id": "doc1"},  # no chunk_index
    )

    # First DB call resolves the index
    db_chunk = _make_chunk("chunk1", "doc1", 5, "no index in metadata")
    # Second DB call returns siblings
    siblings = [_make_chunk("sib_before", "doc1", 4, "sibling")]

    session = AsyncMock()

    # Use MagicMock for execute returns (scalars()/all() are sync in SQLAlchemy)
    execute1 = MagicMock()
    scalars1 = MagicMock()
    scalars1.all.return_value = [db_chunk]
    execute1.scalars.return_value = scalars1

    execute2 = MagicMock()
    scalars2 = MagicMock()
    scalars2.all.return_value = siblings
    execute2.scalars.return_value = scalars2

    # session.execute is already an AsyncMock (from AsyncMock()); use side_effect
    session.execute.side_effect = [execute1, execute2]

    with patch("app.retrieval.parent_retrieval.async_session_factory") as factory:
        factory.return_value.__aenter__.return_value = session
        result = await expand_with_parent([chunk], "ws1", window_size=1)

    assert len(result) == 2
    assert result[0].chunk_id == "sib_before"
    assert result[1].chunk_id == "chunk1"
