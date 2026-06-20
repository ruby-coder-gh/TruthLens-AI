"""NLI-based hallucination detection on generated answer."""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Any

from app.config import settings
from app.utils.logger import logger


class GuardrailResult:
    """Result of guardrail check."""

    def __init__(
        self,
        passed: bool = True,
        score: float = 1.0,
        unsupported_claims: list[str] | None = None,
        details: str = "",
    ) -> None:
        self.passed = passed
        self.score = score
        self.unsupported_claims = unsupported_claims or []
        self.details = details


@lru_cache(maxsize=1)
def _load_nli_model(model_name: str | None = None) -> Any:
    """Load NLI model for entailment checking."""
    name = model_name or settings.GUARDRAIL_NLI_MODEL
    logger.info("loading_nli_model", model=name)
    from sentence_transformers import CrossEncoder
    return CrossEncoder(name, device=settings.EMBED_DEVICE)


def _extract_claims(answer: str) -> list[str]:
    """Split answer into individual claims (sentences)."""
    # Replace newlines, handle end-of-sentence punctuation
    text = answer.replace("\n", " ")
    claims = re.split(r"(?<=[.!?])\s+(?=[A-Z\"'(])", text)
    # If no splits, try simpler split on sentence punctuation
    if len(claims) <= 1:
        claims = re.split(r"(?<=[.!?]) ", text)
    if len(claims) <= 1:
        # Fallback to splitting on all sentence-ending punctuation
        import re as _re
        claims = _re.split(r"[.!?]+", text)
        claims = [c.strip() + "." for c in claims if c.strip()]
    # Filter out very short fragments and source markers
    filtered = []
    for c in claims:
        c = c.strip()
        if len(c) > 15 and not c.startswith("[source"):
            filtered.append(c)
    return filtered


def _nli_infer(model: Any, premise: str, hypothesis: str) -> tuple[float, float, float]:
    """Run NLI inference. Returns (entailment, neutral, contradiction) scores."""
    try:
        pair = [premise, hypothesis]
        result = model.predict([pair])
        if len(result.shape) == 1 and result.shape[0] == 3:
            # Direct 3-class output
            scores = result.tolist()
            return scores[0], scores[1], scores[2]
        elif len(result.shape) == 2 and result.shape[1] == 3:
            scores = result[0].tolist()
            return scores[0], scores[1], scores[2]
        else:
            # Assume [entailment, neutral, contradiction]
            scores = result.flatten().tolist()
            if len(scores) >= 3:
                return scores[0], scores[1], scores[2]
    except Exception as e:
        logger.warning("nli_inference_failed", error=str(e))

    return 0.33, 0.34, 0.33  # Uniform on failure


async def check(answer: str, contexts: list[dict[str, Any]]) -> GuardrailResult:
    """Check generated answer against source contexts for hallucination.

    Uses NLI model to check if each claim in the answer is entailed by the source contexts.

    Args:
        answer: Generated answer text.
        contexts: Retrieved context chunks.

    Returns:
        GuardrailResult with pass/fail and score.
    """
    if not answer or not contexts:
        return GuardrailResult(passed=True, score=1.0, details="No answer or context to check")

    model = _load_nli_model()

    # Combine all contexts into a single premise
    premise = "\n".join(
        ctx.get("content", ctx.get("text", ""))
        for ctx in contexts
    )

    if not premise.strip():
        return GuardrailResult(passed=True, score=1.0, details="No context text available")

    claims = _extract_claims(answer)
    if not claims:
        return GuardrailResult(passed=True, score=1.0, details="No claims to check")

    entail_scores: list[float] = []
    unsupported: list[str] = []

    for claim in claims:
        entail, neutral, contra = _nli_infer(model, premise, claim)

        # Compute entailment ratio: entail / (entail + contra)
        total = entail + contra
        entail_ratio = entail / total if total > 0 else 0.5

        entail_scores.append(entail_ratio)

        if entail_ratio < settings.GUARDRAIL_THRESHOLD:
            unsupported.append(claim)

    if not entail_scores:
        return GuardrailResult(passed=True, score=1.0, details="No claims could be evaluated")

    # Overall score = min entailment ratio
    overall_score = min(entail_scores)
    threshold = settings.GUARDRAIL_THRESHOLD
    passed = overall_score >= threshold

    # Build detail message
    if passed:
        details = f"All {len(claims)} claims supported by retrieved chunks (min entailment: {overall_score:.3f})"
    else:
        details = (
            f"{len(unsupported)}/{len(claims)} claims unsupported by context. "
            f"Min entailment: {overall_score:.3f} (threshold: {threshold})."
        )

    result = GuardrailResult(
        passed=passed,
        score=overall_score,
        unsupported_claims=unsupported,
        details=details,
    )

    logger.info(
        "guardrail_check_complete",
        passed=passed,
        score=overall_score,
        threshold=threshold,
        total_claims=len(claims),
        unsupported=len(unsupported),
    )
    return result
