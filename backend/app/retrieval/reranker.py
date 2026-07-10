"""Cross-encoder reranking for more precise scoring."""

from __future__ import annotations

import asyncio
from functools import lru_cache
from typing import Any

from sentence_transformers import CrossEncoder

from app.config import settings
from app.retrieval.hybrid_search import RetrievalResult
from app.utils.logger import logger


class RerankedResult(RetrievalResult):
    """Retrieval result with reranker score."""

    def __init__(
        self,
        chunk_id: str,
        document_id: str,
        workspace_id: str,
        content: str,
        score: float = 0.0,
        vector_score: float = 0.0,
        bm25_score: float = 0.0,
        rerank_score: float = 0.0,
        final_score: float = 0.0,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(chunk_id, document_id, workspace_id, content, score, vector_score, bm25_score, metadata)
        self.rerank_score = rerank_score
        self.final_score = final_score


@lru_cache(maxsize=1)
def _load_reranker(model_name: str | None = None) -> CrossEncoder:
    """Load cross-encoder reranker model (cached)."""
    name = model_name or settings.RERANK_MODEL_NAME
    logger.info("loading_reranker_model", model=name)
    return CrossEncoder(name, device=settings.EMBED_DEVICE)


async def rerank(
    query: str,
    results: list[RetrievalResult],
    top_k: int | None = None,
) -> list[RerankedResult]:
    """Rerank retrieval results using cross-encoder.

    Args:
        query: Original user query.
        results: List of RetrievalResult to rerank.
        top_k: Number of results to return after reranking.

    Returns:
        List of RerankedResult ordered by reranker score.
    """
    if not results:
        return []

    k = top_k or settings.RETRIEVAL_RERANK_K
    model = await asyncio.to_thread(_load_reranker)

    # Prepare pairs
    pairs = [(query, r.content) for r in results]

    # Score with cross-encoder
    try:
        # CrossEncoder.predict is an overloaded method; mypy can't match the
        # overload through asyncio.to_thread's Callable signature.
        scores = await asyncio.to_thread(model.predict, pairs)  # type: ignore[arg-type]
    except Exception as e:
        logger.error("reranker_prediction_failed", error=str(e))
        # Fallback to original ordering
        reranked: list[RerankedResult] = []
        for r in results[:k]:
            reranked.append(RerankedResult(
                chunk_id=r.chunk_id,
                document_id=r.document_id,
                workspace_id=r.workspace_id,
                content=r.content,
                score=r.score,
                vector_score=r.vector_score,
                bm25_score=r.bm25_score,
                rerank_score=r.score,
                final_score=r.score,
                metadata=r.metadata,
            ))
        return reranked

    # Build reranked results
    reranked_results: list[RerankedResult] = []
    for i, r in enumerate(results):
        rerank_score = float(scores[i]) if i < len(scores) else 0.0
        # Weight reranker score with original hybrid score
        rerank_weight = settings.RETRIEVAL_RERANK_WEIGHT
        final_score = rerank_weight * rerank_score + (1 - rerank_weight) * r.score

        reranked_results.append(RerankedResult(
            chunk_id=r.chunk_id,
            document_id=r.document_id,
            workspace_id=r.workspace_id,
            content=r.content,
            score=r.score,
            vector_score=r.vector_score,
            bm25_score=r.bm25_score,
            rerank_score=rerank_score,
            final_score=final_score,
            metadata=r.metadata,
        ))

    # Sort by final score descending
    reranked_results.sort(key=lambda x: x.final_score, reverse=True)

    logger.info(
        "rerank_complete",
        input_count=len(results),
        output_count=min(len(reranked_results), k),
    )
    return reranked_results[:k]
