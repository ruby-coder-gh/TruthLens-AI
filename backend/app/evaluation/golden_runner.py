"""Golden-set evaluation harness + threshold gate.

Extracted verbatim (behaviour-wise) from
``tests/test_evaluation/test_golden_regression.py`` so application code — the
admin prompt-promotion gate — runs the *same* evaluation the regression suite
runs. The test module now imports from here.

Two public entry points:

* ``run_golden_eval(...)`` — dependency-injected harness that scores a list of
  golden entries and persists exactly one ``EvalRun`` row.
* ``evaluate_verdict(run)`` — pure function comparing a run's metrics against
  the ``settings.EVAL_MIN_*`` floors. Used by the runner (to stamp
  ``status``/``verdict``), by the promote gate, and by tests.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable

from app.config import settings
from app.generation.generator import GenerationInput, GenerationResult
from app.generation.guardrail import GuardrailResult
from app.models.eval_run import EvalRun

# Type aliases for the injected pipeline functions.
GenerateFn = Callable[[GenerationInput], Awaitable[GenerationResult]]
GuardrailFn = Callable[[str, list[dict[str, Any]]], Awaitable[GuardrailResult]]
TrustFn = Callable[..., Awaitable[Any]]
RagasFn = Callable[..., Awaitable[Any]]

SUBSET_SMOKE = "smoke"
SUBSET_FULL = "full"

STATUS_RUNNING = "running"
STATUS_PASSED = "passed"
STATUS_FAILED = "failed"
STATUS_ERROR = "error"


# ─── Helpers ──────────────────────────────────────────────────────


def _backend_dir() -> Path:
    """Resolve the backend/ directory robustly regardless of cwd.

    This file lives at ``backend/app/evaluation/`` so the backend root is three
    levels up.
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


# How much of the *builtin* set a smoke run samples. It MUST include an
# unanswerable entry: without one, `refusal_accuracy` is None, which
# `evaluate_verdict` scores as a failure, so a purely answerable smoke run could
# never pass the promotion gate.
SMOKE_ANSWERABLE = 4
SMOKE_UNANSWERABLE = 1


def _smoke_sample(builtin: list[Any]) -> list[Any]:
    """A small mixed slice of the builtin set: some answerable, one refusal."""
    answerable = [e for e in builtin if getattr(e, "category", "") != "unanswerable"]
    unanswerable = [e for e in builtin if getattr(e, "category", "") == "unanswerable"]
    return answerable[:SMOKE_ANSWERABLE] + unanswerable[:SMOKE_UNANSWERABLE]


async def load_eval_entries(db: Any, subset: str | None = None) -> list[Any]:
    """Builtin + reviewer-promoted golden entries for `subset`.

    This is what an application eval run scores; `run_golden_eval` calls it
    whenever `entries` is omitted.

    Only admin-approved promotions are visible here — `load_golden_entries`
    filters them — so a non-admin cannot steer the gate by promoting entries.

    A smoke run samples the builtin set down to 5 entries and takes at most
    `EVAL_SMOKE_PROMOTED_LIMIT` promoted ones. Sampling promoted entries away
    entirely would make the default gate path silently ignore the corrections a
    reviewer deliberately recorded; keeping *every* one lets a bulk promoter
    dominate the unweighted metric means the gate reads. The subset is the
    oldest N by `(created_at, id)`, which is the order `load_promoted_entries`
    already returns — so two runs over the same table score the same entries.
    A deployment that wants all of them should run `subset=full`.
    """
    from evaluation.golden_dataset import get_golden_dataset

    from app.evaluation.golden_store import load_golden_entries

    entries = await load_golden_entries(db)
    if subset != SUBSET_SMOKE:
        return entries

    # `load_golden_entries` returns builtin first, then promoted (documented
    # contract), so the split point is the builtin length.
    builtin_count = len(get_golden_dataset())
    promoted_limit = max(0, settings.EVAL_SMOKE_PROMOTED_LIMIT)
    return _smoke_sample(entries[:builtin_count]) + entries[builtin_count:][:promoted_limit]


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


def _bucket(store: dict[str, dict[str, list[float]]], key: str) -> dict[str, list[float]]:
    return store.setdefault(str(key), {"faithfulness": [], "trust": []})


def _summarise(store: dict[str, dict[str, list[float]]]) -> dict[str, Any]:
    return {
        key: {
            "count": len(vals["faithfulness"]),
            "faithfulness": _mean(vals["faithfulness"]),
            "trust": _mean(vals["trust"]),
        }
        for key, vals in store.items()
    }


# ─── Threshold gate ───────────────────────────────────────────────


def current_thresholds() -> dict[str, float]:
    """The configured quality floors, keyed as the frontend already parses them."""
    return {
        "min_faithfulness": settings.EVAL_MIN_FAITHFULNESS,
        "min_trust": settings.EVAL_MIN_TRUST,
        "min_context_precision": settings.EVAL_MIN_CONTEXT_PRECISION,
        "refusal_accuracy_min": settings.EVAL_REFUSAL_ACCURACY_MIN,
    }


@dataclass(frozen=True)
class Verdict:
    """Outcome of comparing an EvalRun against the configured thresholds."""

    passed: bool
    failed_metrics: list[str] = field(default_factory=list)
    thresholds: dict[str, float] = field(default_factory=dict)
    scores: dict[str, float | None] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        """The JSON stored in ``eval_runs.verdict``."""
        return {
            "passed": self.passed,
            "failed_metrics": list(self.failed_metrics),
            "thresholds": dict(self.thresholds),
        }


def run_trust(run: EvalRun) -> float | None:
    """Overall trust for a run — it lives in the `notes` JSON, not a column."""
    try:
        parsed = json.loads(run.notes or "{}")
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(parsed, dict):
        return None
    overall = parsed.get("overall")
    if not isinstance(overall, dict):
        return None
    value = overall.get("trust")
    return float(value) if isinstance(value, (int, float)) else None


def run_scores(run: EvalRun) -> dict[str, float | None]:
    """The metric values the gate compares (mirrors `Verdict.scores`)."""
    return {
        "faithfulness": run.faithfulness,
        "trust": run_trust(run),
        "refusal_accuracy": run.refusal_accuracy,
        "context_precision": run.context_precision,
    }


def evaluate_verdict(run: EvalRun) -> Verdict:
    """Compare a run's metrics against `settings.EVAL_MIN_*`.

    Same comparisons the slow golden-regression test asserts. A missing core
    metric (faithfulness / trust / refusal accuracy) counts as a failure — a run
    that could not measure quality has not demonstrated it. ``context_precision``
    is the one exception: ragas is an optional dependency and returns ``None``
    when absent, so a missing score is skipped rather than failed.
    """
    scores = run_scores(run)
    thresholds = current_thresholds()
    failed: list[str] = []

    for metric, threshold_key in (
        ("faithfulness", "min_faithfulness"),
        ("trust", "min_trust"),
        ("refusal_accuracy", "refusal_accuracy_min"),
    ):
        value = scores[metric]
        if value is None or value < thresholds[threshold_key]:
            failed.append(metric)

    context_precision = scores["context_precision"]
    if context_precision is not None and context_precision < thresholds["min_context_precision"]:
        failed.append("context_precision")

    return Verdict(
        passed=not failed,
        failed_metrics=failed,
        thresholds=thresholds,
        scores=scores,
    )


# ─── Runner ───────────────────────────────────────────────────────


async def run_golden_eval(
    entries: list[Any] | None = None,
    *,
    generate_fn: GenerateFn,
    guardrail_fn: GuardrailFn,
    trust_fn: TrustFn,
    ragas_fn: RagasFn | None = None,
    db: Any,
    prompt_override: str | None = None,
    model_override: str | None = None,
    prompt_version_id: str | None = None,
    subset: str | None = None,
    run_id: str | None = None,
) -> EvalRun:
    """Run the golden-set evaluation harness and persist a single EvalRun.

    For each entry: generate an answer, run the guardrail against the entry's
    reference context, then compute the trust score. Per-entry faithfulness and
    trust are recorded. For ``expected_grounding is False`` entries we track
    whether the system refused (``refusal_accuracy = refused / unanswerable``).
    Overall means plus per-category / per-difficulty breakdowns are aggregated.
    ``context_precision`` is computed via ``ragas_fn`` when provided, tolerating
    a ``None`` return (ragas package absent).

    ``prompt_override`` / ``model_override`` pin the candidate prompt text and
    model for every generation, which is how a staged ``PromptVersion`` is
    scored before promotion. ``prompt_version_id`` / ``subset`` are recorded on
    the row; ``run_id`` updates a pre-created (``status="running"``) row instead
    of inserting a new one, so a queued admin job stays a single pollable row.

    Exactly one ``EvalRun`` row is written with the six metric columns (None
    where not computed), ``golden_set_version``, a JSON ``notes`` breakdown and
    the ``status`` / ``verdict`` gate result. The persisted row is returned.

    ``entries`` selects the golden set, and the version stamp follows it:

    * omitted — builtin **plus** reviewer-promoted entries (``golden_store``),
      narrowed by ``subset``, stamped with the store's hash so a promotion or
      deletion is visible in ``golden_set_version``. This is the application
      path (the admin evaluate job).
    * passed explicitly — exactly those entries, stamped with the builtin-only
      file hash. This keeps ``test_golden_regression.py`` deterministic and
      independent of whatever a reviewer promoted last week.
    """
    if entries is None:
        from app.evaluation.golden_store import golden_set_version as store_version

        entries = await load_eval_entries(db, subset)
        version = await store_version(db)
    else:
        version = golden_set_version()

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

    observed_model = ""

    for entry in entries:
        # Reference answer is used as the (synthetic) retrieved context so the
        # harness stays self-contained — no real retrieval / vector store.
        ref = entry.reference_answer
        contexts: list[dict[str, Any]] = (
            [{"content": ref, "chunk_id": "gd-ref", "score": 1.0, "document_id": "gd-ref"}]
            if ref
            else []
        )

        gen_input = GenerationInput(
            query=entry.question,
            contexts=contexts,
            system_prompt=prompt_override,
            model=model_override,
        )
        gen_result = await generate_fn(gen_input)
        answer = getattr(gen_result, "text", "") or ""
        observed_model = getattr(gen_result, "model_used", "") or observed_model

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
        "thresholds": current_thresholds(),
    }

    eval_run = await _load_run(db, run_id) if run_id else None
    if eval_run is None:
        eval_run = EvalRun()
        db.add(eval_run)

    eval_run.faithfulness = overall_faithfulness
    eval_run.context_precision = context_precision
    eval_run.context_recall = None
    eval_run.answer_relevance = overall_relevance
    eval_run.answer_correctness = None
    eval_run.refusal_accuracy = refusal_accuracy
    eval_run.golden_set_version = version
    eval_run.notes = json.dumps(breakdown, default=str)
    eval_run.prompt_version_id = prompt_version_id
    # Prefer what the provider actually served: a run that fell back to another
    # model must not be recorded under the pinned name.
    eval_run.model_used = observed_model or model_override or None
    eval_run.subset = subset

    verdict = evaluate_verdict(eval_run)
    eval_run.status = STATUS_PASSED if verdict.passed else STATUS_FAILED
    eval_run.verdict = json.dumps(verdict.as_dict())

    await db.commit()
    await db.refresh(eval_run)
    return eval_run


async def _load_run(db: Any, run_id: str) -> EvalRun | None:
    """Fetch a pre-created EvalRun row so the runner can fill it in."""
    from sqlalchemy import select

    return (
        await db.execute(select(EvalRun).where(EvalRun.id == run_id))
    ).scalar_one_or_none()
