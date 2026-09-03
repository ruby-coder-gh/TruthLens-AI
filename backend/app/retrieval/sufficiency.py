"""Evidence-sufficiency gate: refuse before generating, not after.

Retrieval that returns nothing relevant is the single largest hallucination
source in a RAG pipeline — the generator is handed weak context and asked to
answer anyway. This module decides, from rerank scores alone, whether there is
enough evidence to attempt an answer, and builds the structured abstention that
replaces the LLM call when there is not.

Pure and synchronous on purpose: no I/O, no model call, so the gate costs
microseconds and is exhaustively testable.

The abstention text deliberately opens with the generator's own refusal string
("I cannot find this information in your documents.", see
``generation/generator.py`` DEFAULT_SYSTEM_PROMPT) so the golden-eval refusal
predicate (`_did_refuse` / `_REFUSAL_MARKERS`) scores a gated abstention as a
correct refusal rather than a wrong answer.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Sequence

from app.config import settings

# Persisted on Query.edge_case and echoed in the `complete` WS frame.
EDGE_CASE_INSUFFICIENT_EVIDENCE = "insufficient_evidence"

# Must stay byte-identical to the refusal sentence in DEFAULT_SYSTEM_PROMPT.
REFUSAL_PREFIX = "I cannot find this information in your documents."

ABSTAIN_MODEL_NAME = "abstain"

# An abstention asserts nothing, so it carries no trust in an answer. Pinned
# here (rather than derived via compute_trust, which would score a
# synthesised guardrail pass at ~0.55) so every code path agrees.
ABSTAIN_TRUST_SCORE = 0.0

# Score keys in preference order. rerank() writes rerank_score for every result
# (falling back to the hybrid score when the cross-encoder errors); cached and
# graph contexts may carry only final_score/score.
_SCORE_KEYS = ("rerank_score", "final_score", "score")


@dataclass(frozen=True)
class SufficiencyVerdict:
    """Why the gate did or did not let a query through to generation."""

    sufficient: bool
    reason: str  # no_results | low_relevance | too_few_supporting | sufficient
    top_score: float
    supporting_count: int
    searched_count: int
    document_count: int

    def as_payload(self) -> dict[str, Any]:
        """JSON shape sent to the client on the `complete` frame."""
        return {
            "sufficient": self.sufficient,
            "reason": self.reason,
            "top_score": self.top_score,
            "supporting_count": self.supporting_count,
            "searched_count": self.searched_count,
            "document_count": self.document_count,
        }


@dataclass(frozen=True)
class Abstention:
    """Everything the caller needs to answer without calling the model."""

    verdict: SufficiencyVerdict
    answer: str
    edge_case: str
    frames: list[dict[str, Any]]
    save_fields: dict[str, Any]


def _get(item: Any, key: str) -> Any:
    return item.get(key) if isinstance(item, dict) else getattr(item, key, None)


def _score(item: Any) -> float:
    """Relevance score for one retrieval result, preferring the cross-encoder."""
    for key in _SCORE_KEYS:
        value = _get(item, key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return float(value)
    return 0.0


def _plural(count: int, noun: str) -> str:
    return f"{count} {noun}" if count == 1 else f"{count} {noun}s"


def assess_sufficiency(
    results: Sequence[Any] | Iterable[Any],
    *,
    min_score: float | None = None,
    min_supporting: int | None = None,
) -> SufficiencyVerdict:
    """Judge whether reranked retrieval carries enough evidence to answer.

    Args:
        results: Reranked results or context dicts.
        min_score: Rerank-score floor for a chunk to count as supporting.
            Defaults to ``settings.SUFFICIENCY_MIN_RERANK_SCORE``.
        min_supporting: How many chunks must clear the floor. Defaults to
            ``settings.SUFFICIENCY_MIN_SUPPORTING``.
    """
    floor = settings.SUFFICIENCY_MIN_RERANK_SCORE if min_score is None else min_score
    required = settings.SUFFICIENCY_MIN_SUPPORTING if min_supporting is None else min_supporting

    items = list(results or [])
    if not items:
        return SufficiencyVerdict(
            sufficient=False,
            reason="no_results",
            top_score=0.0,
            supporting_count=0,
            searched_count=0,
            document_count=0,
        )

    scores = [_score(item) for item in items]
    supporting = sum(1 for score in scores if score >= floor)
    documents = {str(_get(item, "document_id") or "") for item in items}
    documents.discard("")

    if supporting >= required:
        reason = "sufficient"
    elif supporting == 0:
        reason = "low_relevance"
    else:
        reason = "too_few_supporting"

    return SufficiencyVerdict(
        sufficient=supporting >= required,
        reason=reason,
        top_score=max(scores),
        supporting_count=supporting,
        searched_count=len(items),
        document_count=len(documents),
    )


def build_abstention(verdict: SufficiencyVerdict) -> str:
    """Structured "I don't know" that says what was searched and how weak it was."""
    return (
        f"{REFUSAL_PREFIX} "
        f"Searched {_plural(verdict.searched_count, 'chunk')} across "
        f"{_plural(verdict.document_count, 'document')}; "
        f"best evidence score {verdict.top_score:.2f}. "
        "Try rephrasing the question or uploading the relevant document."
    )


def _abstention_frames(query_id: str, verdict: SufficiencyVerdict, answer: str, elapsed_ms: int) -> list[dict[str, Any]]:
    """WebSocket frames that stand in for the generation + guardrail + trust steps.

    The single `token` frame carries the whole text under ``content`` — the same
    shape the cache-replay path uses (``_send_cached_query``), which the client
    already handles (`payload.content ?? payload.token`).
    """
    return [
        {"type": "progress", "payload": {"query_id": query_id, "phase": "abstain", "progress": 0.9}},
        {"type": "token", "payload": {"query_id": query_id, "content": answer, "index": 0}},
        {
            "type": "guardrail",
            "payload": {
                "query_id": query_id,
                "passed": True,
                "score": 1.0,
                "details": "Abstained before generation: insufficient evidence.",
                "abstained": True,
            },
        },
        {
            "type": "trust_score",
            "payload": {
                "query_id": query_id,
                "score": ABSTAIN_TRUST_SCORE,
                "components": abstention_trust_components(verdict),
            },
        },
        {
            "type": "complete",
            "payload": {
                "query_id": query_id,
                "latency_ms": elapsed_ms,
                "model_used": ABSTAIN_MODEL_NAME,
                "token_count": 0,
                "from_cache": False,
                "edge_case": EDGE_CASE_INSUFFICIENT_EVIDENCE,
                "sufficiency": verdict.as_payload(),
            },
        },
    ]


def abstention_trust_components(verdict: SufficiencyVerdict) -> dict[str, float]:
    """Trust breakdown for an abstention: retrieval quality only, nothing generated.

    Public because both LangGraph abstain nodes need it: they bypass
    ``_trust_score_node`` entirely rather than let ``compute_trust`` infer a
    mid-range score from a guardrail pass that was synthesised, not earned.
    """
    return {
        "retrieval_quality": round(verdict.top_score, 4),
        "faithfulness": 0.0,
        "relevance": 0.0,
        "source_authority": 0.0,
    }


def maybe_abstain(
    query_id: str,
    results: Sequence[Any] | Iterable[Any],
    *,
    elapsed_ms: int,
    min_score: float | None = None,
    min_supporting: int | None = None,
) -> Abstention | None:
    """Return a ready-to-send abstention, or None to continue to generation.

    Returns None when the gate is disabled so the feature can be switched off in
    one place without touching the pipeline.
    """
    if not settings.SUFFICIENCY_GATE_ENABLED:
        return None

    verdict = assess_sufficiency(results, min_score=min_score, min_supporting=min_supporting)
    if verdict.sufficient:
        return None

    answer = build_abstention(verdict)
    return Abstention(
        verdict=verdict,
        answer=answer,
        edge_case=EDGE_CASE_INSUFFICIENT_EVIDENCE,
        frames=_abstention_frames(query_id, verdict, answer, elapsed_ms),
        save_fields={
            "response_text": answer,
            # No sources: nothing retrieved cleared the evidence floor, so
            # showing citations would imply support that does not exist.
            "response_sources": [],
            "trust_score": ABSTAIN_TRUST_SCORE,
            "trust_components": abstention_trust_components(verdict),
            "guardrail_score": 1.0,
            "guardrail_passed": True,
            "model_used": ABSTAIN_MODEL_NAME,
            "latency_ms": elapsed_ms,
            "token_count": 0,
            "edge_case": EDGE_CASE_INSUFFICIENT_EVIDENCE,
            # Same payload the `complete` frame carries. Persisted because the
            # abstention is cacheable: without it the replay path has no way to
            # rebuild the evidence-count line and the card loses its
            # explanation (BUG-7).
            "sufficiency": verdict.as_payload(),
        },
    )
