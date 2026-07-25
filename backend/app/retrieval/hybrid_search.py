"""Hybrid search: vector similarity + BM25 fusion via RRF."""

from __future__ import annotations

import asyncio
from functools import lru_cache
from typing import Any, Iterable

from rank_bm25 import BM25Okapi

from app.chroma_client import get_workspace_collection
from app.config import settings
from app.ingestion.embedder import _load_model  # Reuse embedder model
from app.retrieval.bm25_utils import _bm25_tokenizer, _load_bm25_index
from app.utils.logger import logger


class RetrievalResult:
    """Result of a retrieval operation."""

    def __init__(
        self,
        chunk_id: str,
        document_id: str,
        workspace_id: str,
        content: str,
        score: float = 0.0,
        vector_score: float = 0.0,
        bm25_score: float = 0.0,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        self.chunk_id = chunk_id
        self.document_id = document_id
        self.workspace_id = workspace_id
        self.content = content
        self.score = score
        self.vector_score = vector_score
        self.bm25_score = bm25_score
        self.metadata = metadata or {}


# Cache for query embeddings (LRU cache with max 256 queries)
@lru_cache(maxsize=256)
def _get_cached_embedding(query: str) -> tuple[float, ...]:
    """Get cached embedding for a query. Returns tuple for hashability."""
    model = _load_model()
    embedding = model.encode([query], normalize_embeddings=True)[0]
    return tuple(embedding.tolist())


def _reciprocal_rank_fusion(
    vector_results: list[RetrievalResult],
    bm25_results: list[RetrievalResult],
    k: int = 60,
) -> list[RetrievalResult]:
    """Fuse two ranked lists using reciprocal rank fusion.

    Args:
        vector_results: Results from vector search.
        bm25_results: Results from BM25 search.
        k: RRF constant (default 60).

    Returns:
        Fused and sorted list of results.
    """
    scores: dict[str, float] = {}
    result_map: dict[str, RetrievalResult] = {}

    for rank, r in enumerate(vector_results):
        if r.chunk_id not in scores:
            scores[r.chunk_id] = 0.0
            result_map[r.chunk_id] = r
        scores[r.chunk_id] += 1.0 / (k + rank + 1)
        result_map[r.chunk_id].vector_score = r.score

    for rank, r in enumerate(bm25_results):
        if r.chunk_id not in scores:
            scores[r.chunk_id] = 0.0
            result_map[r.chunk_id] = r
        scores[r.chunk_id] += 1.0 / (k + rank + 1)
        result_map[r.chunk_id].bm25_score = r.score

    # Compute combined score
    for chunk_id in scores:
        result_map[chunk_id].score = scores[chunk_id]

    # Sort by score descending
    sorted_results = sorted(result_map.values(), key=lambda x: x.score, reverse=True)
    return sorted_results


async def hybrid_search(
    query: str,
    workspace_id: str,
    top_k: int | None = None,
    filters: dict[str, Any] | None = None,
) -> list[RetrievalResult]:
    """Hybrid search: vector + BM25 fusion.

    Args:
        query: User query text.
        workspace_id: Workspace UUID.
        top_k: Number of results to return.
        filters: Optional metadata filters.

    Returns:
        List of RetrievalResult ordered by score.
    """
    k = top_k or settings.RETRIEVAL_TOP_K
    vector_weight = settings.RETRIEVAL_VECTOR_WEIGHT
    bm25_weight = settings.RETRIEVAL_BM25_WEIGHT

    # Run both searches in parallel
    vector_results = await vector_search(query, workspace_id, top_k=k * 2, filters=filters)
    bm25_results = await bm25_search(query, workspace_id, top_k=k * 2, filters=filters)

    if not vector_results and not bm25_results:
        return []

    # Fuse
    fused = _reciprocal_rank_fusion(vector_results, bm25_results)

    # Weighted combination
    for r in fused:
        r.score = (r.vector_score * vector_weight + r.bm25_score * bm25_weight) / (vector_weight + bm25_weight)

    # Filter by min score
    min_score = settings.RETRIEVAL_MIN_SCORE
    fused = [r for r in fused if r.score >= min_score]

    logger.info(
        "hybrid_search_complete",
        workspace_id=workspace_id,
        query_length=len(query),
        results=len(fused),
        top_k=k,
    )
    return fused[:k]


async def vector_search(
    query: str,
    workspace_id: str,
    top_k: int | None = None,
    filters: dict[str, Any] | None = None,
    use_cache: bool = True,
) -> list[RetrievalResult]:
    """Vector similarity search using ChromaDB.

    Args:
        query: Query text.
        workspace_id: Workspace UUID.
        top_k: Number of results.
        filters: Optional metadata filter dict.
        use_cache: Whether to use cached embeddings (default True).

    Returns:
        List of RetrievalResult.
    """
    k = top_k or settings.RETRIEVAL_TOP_K

    # Embed query (with caching)
    if use_cache:
        # Use cached embedding if available
        query_embedding_tuple = await asyncio.to_thread(_get_cached_embedding, query)
        query_embedding = list(query_embedding_tuple)
    else:
        model = _load_model()
        query_embedding = (await asyncio.to_thread(model.encode, [query], normalize_embeddings=True))[0].tolist()

    # Search ChromaDB
    collection = await asyncio.to_thread(get_workspace_collection, workspace_id)
    where_filter = filters or None

    try:
        results = await asyncio.to_thread(
            collection.query,
            # chromadb's stub types query_embeddings as ndarray/Sequence; a plain
            # list-of-lists is accepted at runtime.
            query_embeddings=[query_embedding],  # type: ignore[arg-type]
            n_results=k,
            where=where_filter,
            include=["metadatas", "documents", "distances"],
        )
    except Exception as e:
        logger.error("vector_search_failed", error=str(e), workspace_id=workspace_id)
        return []

    retrieval_results: list[RetrievalResult] = []
    if not results["ids"] or not results["ids"][0]:
        return retrieval_results

    for i, chunk_id in enumerate(results["ids"][0]):
        raw_metadata = results["metadatas"][0][i] if results["metadatas"] and results["metadatas"][0] else {}
        metadata: dict[str, Any] = dict(raw_metadata) if raw_metadata else {}
        content = results["documents"][0][i] if results["documents"] and results["documents"][0] else ""
        distance = results["distances"][0][i] if results["distances"] and results["distances"][0] else 0.0
        # Convert cosine distance to similarity score
        similarity = 1.0 - distance

        retrieval_results.append(RetrievalResult(
            chunk_id=chunk_id,
            document_id=str(metadata.get("document_id", "")),
            workspace_id=workspace_id,
            content=content,
            score=similarity,
            vector_score=similarity,
            bm25_score=0.0,
            metadata=metadata,
        ))

    return retrieval_results


async def bm25_search(
    query: str,
    workspace_id: str,
    top_k: int | None = None,
    filters: dict[str, Any] | None = None,
) -> list[RetrievalResult]:
    """BM25 keyword search.

    Args:
        query: Query text.
        workspace_id: Workspace UUID.
        top_k: Number of results.

    Returns:
        List of RetrievalResult.
    """
    k = top_k or settings.RETRIEVAL_TOP_K

    index, corpus, metadatas = await asyncio.to_thread(_load_bm25_index, workspace_id)
    if index is None or not corpus:
        return []

    tokenized_query = _bm25_tokenizer(query)
    try:
        scores = await asyncio.to_thread(index.get_scores, tokenized_query)
    except Exception as e:
        logger.error("bm25_search_failed", error=str(e), workspace_id=workspace_id)
        return []

    # Preserve the vector path's metadata filters for BM25 too. Without this,
    # a document-filtered comparison can be contaminated by another document's
    # keyword hit during reciprocal-rank fusion.
    candidate_indices = list(range(len(scores)))
    if filters:
        def matches_filters(metadata: dict[str, Any]) -> bool:
            return all(str(metadata.get(key)) == str(value) for key, value in filters.items())
        candidate_indices = [
            idx for idx in candidate_indices
            if matches_filters(metadatas[idx] if idx < len(metadatas) else {})
        ]

    # Get top-k indices
    top_indices = sorted(candidate_indices, key=lambda i: scores[i], reverse=True)[:k]

    results: list[RetrievalResult] = []
    for idx in top_indices:
        if scores[idx] <= 0:
            continue
        meta = metadatas[idx] if idx < len(metadatas) else {}

        # Normalize BM25 score to 0-1 range
        max_score = max(scores) if scores.max() > 0 else 1.0
        normalized_score = float(scores[idx] / max_score)

        # Parse chunk_id from metadata
        chunk_id = meta.get("chunk_id", f"bm25:{idx}")
        document_id = meta.get("document_id", "")

        results.append(RetrievalResult(
            chunk_id=chunk_id,
            document_id=document_id,
            workspace_id=workspace_id,
            content=corpus[idx],
            score=normalized_score,
            vector_score=0.0,
            bm25_score=normalized_score,
            metadata=meta,
        ))

    return results


def keyword_search_records(
    query: str,
    records: Iterable[dict[str, Any]],
    *,
    text_key: str = "search_text",
    top_k: int = 20,
) -> list[tuple[dict[str, Any], float]]:
    """Rank in-memory lightweight records with the project's BM25 tokenizer.

    This deliberately shares the same BM25 implementation and normalization as
    workspace retrieval while avoiding embeddings, reranking, or generation.
    It is suitable for metadata/query-history lookup where no Chroma document
    needs to be loaded.
    """
    items = [record for record in records if str(record.get(text_key, "")).strip()]
    tokens = _bm25_tokenizer(query)
    if not items or not tokens:
        return []

    tokenized_records = [_bm25_tokenizer(str(record[text_key])) for record in items]
    index = BM25Okapi(tokenized_records)
    scores = index.get_scores(tokens)
    matching_indices = [
        record_index
        for record_index, record_tokens in enumerate(tokenized_records)
        if set(tokens).intersection(record_tokens)
    ]
    if not matching_indices:
        return []

    ranked = sorted(matching_indices, key=lambda record_index: scores[record_index], reverse=True)[:top_k]
    max_score = max(float(scores[record_index]) for record_index in ranked)
    if max_score > 0:
        return [
            (items[record_index], float(scores[record_index] / max_score))
            for record_index in ranked
        ]

    # BM25Okapi can give a non-positive score when every small candidate record
    # contains a term. Preserve its ranking and emit a stable relative score
    # rather than treating exact keyword matches as no results.
    return [
        (items[record_index], 1.0 - (rank / max(1, len(ranked))))
        for rank, record_index in enumerate(ranked)
    ]
