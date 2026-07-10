"""Compute trust score from multiple quality signals."""

from __future__ import annotations

from typing import Any

from app.config import settings
from app.generation.guardrail import GuardrailResult
from app.utils.logger import logger


class TrustScoreComponents:
    """Decomposed trust score."""

    def __init__(
        self,
        retrieval_quality: float = 0.0,
        faithfulness: float = 0.0,
        relevance: float = 0.0,
        source_authority: float = 0.0,
        overall: float = 0.0,
    ) -> None:
        self.retrieval_quality = retrieval_quality
        self.faithfulness = faithfulness
        self.relevance = relevance
        self.source_authority = source_authority
        self.overall = overall


async def compute_trust(
    retrieval_results: list[Any],
    guardrail_result: GuardrailResult | None = None,
    generation_result: Any = None,
    query: str = "",
) -> TrustScoreComponents:
    """Compute overall trust score from multiple signals.

    Args:
        retrieval_results: List of retrieval results with scores.
        guardrail_result: Result from guardrail check.
        generation_result: Result from generation.
        query: Original query text.

    Returns:
        TrustScoreComponents with overall and decomposed scores.
    """
    # 1. Retrieval quality: average of top retrieval scores
    retrieval_quality = 0.0
    if retrieval_results:
        scores: list[float] = []
        for r in retrieval_results:
            if isinstance(r, dict):
                raw_score = r.get("final_score", r.get("score", 0))
            else:
                raw_score = getattr(r, "final_score", getattr(r, "score", 0))
            try:
                score_value = float(raw_score) if raw_score is not None else 0.0
            except (TypeError, ValueError):
                score_value = 0.0
            if score_value > 0:
                scores.append(score_value)
        if scores:
            retrieval_quality = sum(scores[:3]) / min(len(scores[:3]), 3)

    # 2. Faithfulness: from guardrail
    faithfulness = 1.0
    if guardrail_result:
        faithfulness = guardrail_result.score

    # 3. Relevance: estimate from response length/quality
    relevance = 0.5
    if generation_result:
        text_len = len(getattr(generation_result, "text", ""))
        if text_len > 50:
            relevance = min(1.0, text_len / 500)
        if guardrail_result and guardrail_result.passed:
            relevance = max(relevance, 0.7)

    # 4. Source authority: based on number and diversity of sources
    source_authority = 0.5
    if retrieval_results:
        unique_docs = set()
        for r in retrieval_results:
            doc_id = r.get("document_id") if isinstance(r, dict) else getattr(r, "document_id", None)
            if doc_id:
                unique_docs.add(doc_id)
        if len(unique_docs) >= 3:
            source_authority = 1.0
        elif len(unique_docs) >= 2:
            source_authority = 0.7
        elif len(unique_docs) >= 1:
            source_authority = 0.4

    # Weighted overall score
    overall = (
        retrieval_quality * settings.TRUST_RETRIEVAL_WEIGHT
        + faithfulness * settings.TRUST_FAITHFULNESS_WEIGHT
        + relevance * settings.TRUST_RELEVANCE_WEIGHT
        + source_authority * settings.TRUST_SOURCE_WEIGHT
    )

    # Clamp to [0, 1]
    overall = max(0.0, min(1.0, overall))

    result = TrustScoreComponents(
        retrieval_quality=round(retrieval_quality, 4),
        faithfulness=round(faithfulness, 4),
        relevance=round(relevance, 4),
        source_authority=round(source_authority, 4),
        overall=round(overall, 4),
    )

    logger.info(
        "trust_score_computed",
        overall=result.overall,
        retrieval_quality=result.retrieval_quality,
        faithfulness=result.faithfulness,
        relevance=result.relevance,
        source_authority=result.source_authority,
    )
    return result
