"""Golden-set regression harness for the RAG evaluation loop.

This module houses a single dependency-injected harness (``run_golden_eval``)
that is exercised two ways:

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

import hashlib
import json
import os
from pathlib import Path
from typing import Any, Awaitable, Callable

import pytest

from app.config import settings
from app.generation.generator import GenerationInput, GenerationResult
from app.generation.guardrail import GuardrailResult
from app.models.eval_run import EvalRun

# Type aliases for the injected pipeline functions.
GenerateFn = Callable[[GenerationInput], Awaitable[GenerationResult]]
GuardrailFn = Callable[[str, list[dict[str, Any]]], Awaitable[GuardrailResult]]
TrustFn = Callable[..., Awaitable[Any]]
RagasFn = Callable[..., Awaitable[Any]]


# ─── Helpers ──────────────────────────────────────────────────────


def _backend_dir() -> Path:
    """Resolve the backend/ directory robustly regardless of cwd.

    This file lives at ``backend/tests/test_evaluation/`` so the backend root
    is three levels up.
    """
    return Path(__file__).resolve().parents[2]


def golden_set_version() -> str:
    """Return a short content hash of the golden dataset source file.

    Two eval runs over the same dataset get the same version string; any edit
    to ``golden_dataset.py`` changes it. Used to stamp ``EvalRun`` rows.
    """
    dataset_path = _backend_dir() / "evaluation" / "golden_dataset.py"
    digest = hashlib.sha1(dataset_path.read_bytes()).hexdigest()
    return digest[:12]


# Phrases a well-behaved system emits when it declines to answer. Kept in sync
# with the generator's DEFAULT_SYSTEM_PROMPT ("I cannot find this information
# in your documents.") and the golden reference answers for unanswerable
# entries ("This question cannot be answered from the available documents.").
_REFUSAL_MARKERS = (
    "cannot find this information",
    "cannot be answered",
    "cannot be fully answered",
    "cannot answer",
    "can't answer",
    "cannot be found",
    "no information",
    "not contain",
    "don't have enough",
    "do not have enough",
    "unable to answer",
    "i don't know",
)


def _did_refuse(answer: str, guardrail: GuardrailResult) -> bool:
    """Refusal predicate for an unanswerable entry.

    The system is considered to have correctly refused when ANY of:

    * the answer is empty / trivially short (nothing substantive was asserted);
    * the answer contains an explicit "cannot answer" style disclaimer; or
    * the guardrail support (entailment) score is below the configured
      threshold — i.e. whatever was said is not grounded in the context.

    A single clear predicate that works for both the mocked smoke path and the
    real pipeline: for out-of-corpus questions a faithful system either says it
    cannot answer or produces an ungrounded (low-support) answer.
    """
    text = (answer or "").strip().lower()
    if len(text) < 15:
        return True
    if any(marker in text for marker in _REFUSAL_MARKERS):
        return True
    if guardrail is not None and guardrail.score < settings.GUARDRAIL_THRESHOLD:
        return True
    return False


def _mean(values: list[float]) -> float | None:
    """Mean of a list, or None when empty (so we never divide by zero)."""
    return sum(values) / len(values) if values else None


async def run_golden_eval(
    entries: list[Any],
    *,
    generate_fn: GenerateFn,
    guardrail_fn: GuardrailFn,
    trust_fn: TrustFn,
    ragas_fn: RagasFn | None = None,
    db: Any,
) -> EvalRun:
    """Run the golden-set evaluation harness and persist a single EvalRun.

    For each entry: generate an answer, run the guardrail against the entry's
    reference context, then compute the trust score. Per-entry faithfulness and
    trust are recorded. For ``expected_grounding is False`` entries we track
    whether the system refused (``refusal_accuracy = refused / unanswerable``).
    Overall means plus per-category / per-difficulty breakdowns are aggregated.
    ``context_precision`` is computed via ``ragas_fn`` when provided, tolerating
    a ``None`` return (ragas package absent).

    Exactly one ``EvalRun`` row is inserted with the six metric columns (None
    where not computed), ``golden_set_version`` and a JSON ``notes`` breakdown.
    The persisted row is returned.
    """
    faithfulness_scores: list[float] = []
    trust_scores: list[float] = []
    relevance_scores: list[float] = []

    unanswerable_total = 0
    refused_total = 0

    # For ragas context-precision (only when a ragas_fn is supplied).
    ragas_queries: list[str] = []
    ragas_answers: list[str] = []
    ragas_contexts: list[list[str]] = []
    ragas_ground_truth: list[str] = []

    # Breakdown accumulators.
    per_category: dict[str, dict[str, list[float]]] = {}
    per_difficulty: dict[str, dict[str, list[float]]] = {}

    def _bucket(store: dict[str, dict[str, list[float]]], key: str) -> dict[str, list[float]]:
        return store.setdefault(str(key), {"faithfulness": [], "trust": []})

    for entry in entries:
        # Reference answer is used as the (synthetic) retrieved context so the
        # harness stays self-contained — no real retrieval / vector store.
        ref = entry.reference_answer
        contexts: list[dict[str, Any]] = (
            [{"content": ref, "chunk_id": "gd-ref", "score": 1.0, "document_id": "gd-ref"}]
            if ref
            else []
        )

        gen_input = GenerationInput(query=entry.question, contexts=contexts)
        gen_result = await generate_fn(gen_input)
        answer = getattr(gen_result, "text", "") or ""

        guardrail = await guardrail_fn(answer, contexts)
        trust = await trust_fn(
            retrieval_results=contexts,
            guardrail_result=guardrail,
            generation_result=gen_result,
            query=entry.question,
        )

        faithfulness = float(getattr(guardrail, "score", 0.0) or 0.0)
        trust_overall = float(getattr(trust, "overall", 0.0) or 0.0)
        relevance = float(getattr(trust, "relevance", 0.0) or 0.0)

        faithfulness_scores.append(faithfulness)
        trust_scores.append(trust_overall)
        relevance_scores.append(relevance)

        cat_bucket = _bucket(per_category, entry.category)
        cat_bucket["faithfulness"].append(faithfulness)
        cat_bucket["trust"].append(trust_overall)

        diff_bucket = _bucket(per_difficulty, entry.difficulty)
        diff_bucket["faithfulness"].append(faithfulness)
        diff_bucket["trust"].append(trust_overall)

        # Refusal accuracy denominator = entries that SHOULD be refused.
        if not entry.expected_grounding:
            unanswerable_total += 1
            if _did_refuse(answer, guardrail):
                refused_total += 1

        # Collect ragas inputs (only used when ragas_fn provided).
        if ragas_fn is not None:
            ragas_queries.append(entry.question)
            ragas_answers.append(answer)
            ragas_contexts.append([c["content"] for c in contexts])
            ragas_ground_truth.append(ref)

    # ─── Aggregate ───
    overall_faithfulness = _mean(faithfulness_scores)
    overall_trust = _mean(trust_scores)
    overall_relevance = _mean(relevance_scores)
    refusal_accuracy = (
        refused_total / unanswerable_total if unanswerable_total else None
    )

    context_precision: float | None = None
    if ragas_fn is not None and ragas_queries:
        ragas_scores = await ragas_fn(
            queries=ragas_queries,
            answers=ragas_answers,
            contexts=ragas_contexts,
            ground_truth=ragas_ground_truth,
        )
        # ragas_fn may return None (or a RagasScores with None fields) when the
        # ragas package is unavailable — tolerate both, store None.
        if ragas_scores is not None:
            context_precision = getattr(ragas_scores, "context_precision", None)

    def _summarise(store: dict[str, dict[str, list[float]]]) -> dict[str, Any]:
        return {
            key: {
                "count": len(vals["faithfulness"]),
                "faithfulness": _mean(vals["faithfulness"]),
                "trust": _mean(vals["trust"]),
            }
            for key, vals in store.items()
        }

    breakdown = {
        "total_entries": len(entries),
        "unanswerable_total": unanswerable_total,
        "refused_total": refused_total,
        "overall": {
            "faithfulness": overall_faithfulness,
            "trust": overall_trust,
            "relevance": overall_relevance,
            "refusal_accuracy": refusal_accuracy,
            "context_precision": context_precision,
        },
        "per_category": _summarise(per_category),
        "per_difficulty": _summarise(per_difficulty),
    }

    eval_run = EvalRun(
        faithfulness=overall_faithfulness,
        context_precision=context_precision,
        context_recall=None,
        answer_relevance=overall_relevance,
        answer_correctness=None,
        refusal_accuracy=refusal_accuracy,
        golden_set_version=golden_set_version(),
        notes=json.dumps(breakdown, default=str),
    )
    db.add(eval_run)
    await db.commit()
    await db.refresh(eval_run)
    return eval_run


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
