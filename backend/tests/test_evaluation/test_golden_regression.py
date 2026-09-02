"""Golden-set regression suite for the RAG evaluation loop.

The dependency-injected harness itself (``run_golden_eval``) lives in
``app.evaluation.golden_runner`` so the admin prompt-promotion gate scores a
candidate prompt with the very same code this suite regresses. Here it is
exercised two ways:

* a FAST smoke test that runs on every default ``pytest`` invocation with
  deterministic mock functions — zero external deps, no Ollama, no models; and
* a SLOW real test (``@pytest.mark.slow``) that runs the FULL golden dataset
  through the REAL generate / guardrail / trust pipeline. It is gated behind
  ``EVAL_RUN=1`` (which requires Ollama) so the default suite collects but
  skips it.

The same code path serves both — the mock test proves the wiring, the slow
test proves the pipeline meets the quality thresholds in ``settings``.
"""

from __future__ import annotations

import json
import os
from typing import Any

import pytest

from app.config import settings
from app.evaluation.golden_runner import GenerateFn, GuardrailFn, TrustFn, run_golden_eval
from app.generation.generator import GenerationInput, GenerationResult
from app.generation.guardrail import GuardrailResult
from app.models.eval_run import EvalRun


# ─── Deterministic mocks (fast smoke test) ────────────────────────


def _mock_generate_factory() -> GenerateFn:
    """Build a deterministic generate_fn.

    Emits a grounded, on-topic answer for answerable questions and an explicit
    refusal for unanswerable ones — keyed off whether reference context looks
    like a "cannot be answered" disclaimer.
    """

    async def _generate(inp: GenerationInput) -> GenerationResult:
        ref = ""
        if inp.contexts:
            ref = inp.contexts[0].get("content", "")
        if "cannot be answered" in ref.lower():
            text = "I cannot find this information in your documents."
        else:
            # Grounded answer: echo the reference so the (mock) guardrail sees
            # full support.
            text = ref or "A grounded answer based on the provided context."
        return GenerationResult(text=text, token_count=len(text.split()), model_used="mock")

    return _generate


def _mock_guardrail_factory() -> GuardrailFn:
    """Build a deterministic guardrail_fn.

    High support when the answer text is contained in the context; low support
    (a refusal-ish signal) otherwise.
    """

    async def _guardrail(answer: str, contexts: list[dict[str, Any]]) -> GuardrailResult:
        premise = " ".join(c.get("content", "") for c in contexts).lower()
        ans = (answer or "").strip().lower()
        if ans and ans in premise:
            return GuardrailResult(passed=True, score=0.95, details="mock: supported")
        return GuardrailResult(passed=False, score=0.2, details="mock: unsupported")

    return _guardrail


def _mock_trust_factory() -> TrustFn:
    """Build a deterministic trust_fn returning an object with .overall."""

    class _Trust:
        def __init__(self, overall: float, relevance: float) -> None:
            self.overall = overall
            self.relevance = relevance

    async def _trust(
        retrieval_results: Any = None,
        guardrail_result: Any = None,
        generation_result: Any = None,
        query: str = "",
    ) -> Any:
        faith = getattr(guardrail_result, "score", 0.5) if guardrail_result else 0.5
        overall = round(min(1.0, 0.3 + 0.6 * faith), 4)
        relevance = 0.8 if faith >= settings.GUARDRAIL_THRESHOLD else 0.4
        return _Trust(overall=overall, relevance=relevance)

    return _trust


def _smoke_subset() -> list[Any]:
    """Small fixed subset (>=3 entries incl. >=1 unanswerable) for the smoke test."""
    from evaluation.golden_dataset import get_entries_by_category

    answerable = get_entries_by_category("answerable")[:2]
    unanswerable = get_entries_by_category("unanswerable")[:1]
    subset = answerable + unanswerable
    assert len(subset) >= 3, "smoke subset must have at least 3 entries"
    assert any(not e.expected_grounding for e in subset), "smoke subset needs an unanswerable entry"
    return subset


# ─── FAST smoke test (default suite, NO Ollama) ───────────────────


@pytest.mark.asyncio
async def test_golden_regression_smoke(test_db):
    """Wire the harness end-to-end with deterministic mocks — no external deps.

    Proves: an EvalRun row is persisted, the golden-set version is stamped,
    refusal accuracy is computed, and the notes column is valid JSON with the
    per-category / per-difficulty breakdown.
    """
    entries = _smoke_subset()

    run = await run_golden_eval(
        entries,
        generate_fn=_mock_generate_factory(),
        guardrail_fn=_mock_guardrail_factory(),
        trust_fn=_mock_trust_factory(),
        ragas_fn=None,  # ragas not exercised in the fast path
        db=test_db,
    )

    # Row persisted with a real primary key.
    assert run.id is not None

    # Golden-set version stamped, exactly 12 hex chars.
    assert run.golden_set_version is not None
    assert len(run.golden_set_version) == 12

    # Refusal accuracy computed (subset has an unanswerable entry, and the mock
    # generator refuses it → accuracy should be 1.0).
    assert run.refusal_accuracy is not None
    assert run.refusal_accuracy == pytest.approx(1.0)

    # Faithfulness aggregated; ragas not run so context_precision stays None.
    assert run.faithfulness is not None
    assert run.context_precision is None

    # Notes parse as JSON containing per-category / per-difficulty keys.
    parsed = json.loads(run.notes)
    assert "per_category" in parsed
    assert "per_difficulty" in parsed
    assert parsed["per_category"], "per_category breakdown should be non-empty"
    assert "unanswerable" in parsed["per_category"]
    assert parsed["overall"]["refusal_accuracy"] == pytest.approx(1.0)

    # Confirm it landed in the DB independently of the returned object.
    from sqlalchemy import select

    rows = (await test_db.execute(select(EvalRun))).scalars().all()
    assert len(rows) == 1


# ─── SLOW real test (opt-in, needs Ollama) ────────────────────────


@pytest.mark.slow
@pytest.mark.skipif(
    os.getenv("EVAL_RUN") != "1",
    reason="set EVAL_RUN=1 (needs Ollama) to run the full golden-set eval",
)
@pytest.mark.asyncio
async def test_golden_regression_full(test_db):
    """Run the FULL golden dataset through the REAL pipeline and assert thresholds.

    Opt-in only (EVAL_RUN=1). Uses the real generate/guardrail/trust functions
    plus ragas when the package is available; persists an EvalRun row.
    """
    from evaluation.golden_dataset import get_golden_dataset
    from app.generation.generator import generate as real_generate
    from app.generation.guardrail import check as real_guardrail
    from app.evaluation.trust_score import compute_trust as real_trust
    from app.evaluation.ragas_eval import ragas_evaluate as real_ragas

    entries = get_golden_dataset()

    async def _trust_adapter(
        retrieval_results=None,
        guardrail_result=None,
        generation_result=None,
        query="",
    ):
        return await real_trust(
            retrieval_results=retrieval_results,
            guardrail_result=guardrail_result,
            generation_result=generation_result,
            query=query,
        )

    run = await run_golden_eval(
        entries,
        generate_fn=real_generate,
        guardrail_fn=real_guardrail,
        trust_fn=_trust_adapter,
        ragas_fn=real_ragas,
        db=test_db,
    )

    # Row persisted.
    assert run.id is not None
    assert run.golden_set_version is not None

    # Quality gates.
    assert run.faithfulness is not None
    assert run.faithfulness >= settings.EVAL_MIN_FAITHFULNESS, (
        f"faithfulness {run.faithfulness} < {settings.EVAL_MIN_FAITHFULNESS}"
    )

    parsed = json.loads(run.notes)
    overall_trust = parsed["overall"]["trust"]
    assert overall_trust is not None
    assert overall_trust >= settings.EVAL_MIN_TRUST, (
        f"trust {overall_trust} < {settings.EVAL_MIN_TRUST}"
    )

    assert run.refusal_accuracy is not None
    assert run.refusal_accuracy >= settings.EVAL_REFUSAL_ACCURACY_MIN, (
        f"refusal_accuracy {run.refusal_accuracy} < {settings.EVAL_REFUSAL_ACCURACY_MIN}"
    )

    # context_precision only asserted when ragas actually produced a score.
    if run.context_precision is not None:
        assert run.context_precision >= settings.EVAL_MIN_CONTEXT_PRECISION, (
            f"context_precision {run.context_precision} < {settings.EVAL_MIN_CONTEXT_PRECISION}"
        )
