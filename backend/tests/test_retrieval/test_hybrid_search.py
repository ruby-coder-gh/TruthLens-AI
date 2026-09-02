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


# ── BUG-11 regression: one chunk, two retrievers, one fused result ──────
#
# Chroma stores each chunk under the id `f"{document_id}:{index}"`
# (`app/ingestion/indexer.py`), while both stores put the `Chunk` UUID in
# `metadata["chunk_id"]` (`app/ingestion/embedder.py`). The vector branch
# used to carry Chroma's id, so the two key spaces could never intersect
# and RRF's dedup was a no-op for every chunk found by both retrievers:
# it came back twice and was double-weighted.

_CHUNK_UUID = "b4e1b8e2-bd3b-4133-bc80-05f26ba7d497"
_DOC_ID = "89b91683-7fe6-490d-b5d7-a568014de627"
_CHROMA_ID = f"{_DOC_ID}:3"


class _FakeChromaCollection:
    """Minimal stand-in for a Chroma collection returning canned hits."""

    def __init__(self, ids: list[str], metadatas: list[dict]) -> None:
        self._ids = ids
        self._metadatas = metadatas

    def query(self, **kwargs: object) -> dict:
        n = len(self._ids)
        return {
            "ids": [self._ids],
            "metadatas": [self._metadatas],
            "documents": [["The standard warranty period is 24 months."] * n],
            "distances": [[0.1] * n],
        }


@pytest.fixture
def stub_vector_backend(monkeypatch):
    """Stub Chroma + the embedding model so vector_search runs offline."""
    from app.retrieval import hybrid_search as hs

    monkeypatch.setattr(hs, "_get_cached_embedding", lambda query: (0.1, 0.2, 0.3))

    def _install(ids: list[str], metadatas: list[dict]) -> None:
        monkeypatch.setattr(
            hs,
            "get_workspace_collection",
            lambda workspace_id: _FakeChromaCollection(ids, metadatas),
        )

    return _install


@pytest.mark.asyncio
async def test_vector_search_carries_chunk_uuid_not_chroma_id(stub_vector_backend):
    """The vector branch must key on the same identity BM25 and the DB use."""
    from app.retrieval.hybrid_search import vector_search

    stub_vector_backend(
        [_CHROMA_ID],
        [{"document_id": _DOC_ID, "chunk_id": _CHUNK_UUID, "chunk_index": 3}],
    )

    results = await vector_search("warranty period", "ws1", top_k=5)

    assert len(results) == 1
    assert results[0].chunk_id == _CHUNK_UUID
    assert results[0].document_id == _DOC_ID


@pytest.mark.asyncio
async def test_vector_search_falls_back_to_chroma_id_without_metadata(stub_vector_backend):
    """Records indexed before chunk_id metadata existed keep Chroma's id."""
    from app.retrieval.hybrid_search import vector_search

    stub_vector_backend([_CHROMA_ID], [{"document_id": _DOC_ID, "chunk_index": 3}])

    results = await vector_search("warranty period", "ws1", top_k=5)

    assert len(results) == 1
    assert results[0].chunk_id == _CHROMA_ID


@pytest.mark.asyncio
async def test_rrf_dedupes_chunk_returned_by_both_retrievers(stub_vector_backend):
    """A chunk found by both retrievers fuses into one result, scored as the sum."""
    from app.retrieval.hybrid_search import vector_search

    stub_vector_backend(
        [_CHROMA_ID],
        [{"document_id": _DOC_ID, "chunk_id": _CHUNK_UUID, "chunk_index": 3}],
    )
    vector_results = await vector_search("warranty period", "ws1", top_k=5)

    # Shaped exactly as bm25_search builds it: the Chunk UUID from metadata.
    bm25_results = [
        RetrievalResult(
            _CHUNK_UUID,
            _DOC_ID,
            "ws1",
            "The standard warranty period is 24 months.",
            score=0.72,
            vector_score=0.0,
            bm25_score=0.72,
            metadata={"document_id": _DOC_ID, "chunk_id": _CHUNK_UUID, "chunk_index": 3},
        )
    ]

    fused = _reciprocal_rank_fusion(vector_results, bm25_results)

    assert len(fused) == 1, "the same chunk must not appear once per retriever"
    assert fused[0].chunk_id == _CHUNK_UUID
    # Standard RRF: rank 0 in both lists, k=60 -> 1/61 + 1/61
    assert fused[0].score == pytest.approx(2.0 / 61.0)
    # Both retrievers' raw scores land on the single surviving result.
    assert fused[0].vector_score == pytest.approx(0.9)
    assert fused[0].bm25_score == pytest.approx(0.72)


@pytest.mark.asyncio
async def test_rrf_single_source_chunks_keep_their_own_scores(stub_vector_backend):
    """Chunks found by only one retriever are unaffected by the dedup fix."""
    from app.retrieval.hybrid_search import vector_search

    other_uuid = "11111111-2222-3333-4444-555555555555"
    stub_vector_backend(
        [_CHROMA_ID],
        [{"document_id": _DOC_ID, "chunk_id": _CHUNK_UUID, "chunk_index": 3}],
    )
    vector_results = await vector_search("warranty period", "ws1", top_k=5)

    bm25_only = RetrievalResult(
        other_uuid,
        "doc2",
        "ws1",
        "unrelated",
        score=0.4,
        vector_score=0.0,
        bm25_score=0.4,
        metadata={"document_id": "doc2", "chunk_id": other_uuid, "chunk_index": 0},
    )

    fused = _reciprocal_rank_fusion(vector_results, [bm25_only])

    assert len(fused) == 2
    by_id = {r.chunk_id: r for r in fused}
    assert by_id[_CHUNK_UUID].score == pytest.approx(1.0 / 61.0)
    assert by_id[_CHUNK_UUID].bm25_score == 0.0
    assert by_id[other_uuid].score == pytest.approx(1.0 / 61.0)
    assert by_id[other_uuid].vector_score == 0.0
