"""Tests for the extracted golden-set runner (`app.evaluation.golden_runner`).

The harness used to live in `tests/test_evaluation/test_golden_regression.py`.
It now ships as application code so the admin prompt-promotion gate can run the
exact same evaluation the regression suite runs.

Covers the pure `evaluate_verdict` threshold gate (including boundaries) and
the runner's new pinning kwargs (`prompt_override`, `model_override`,
`prompt_version_id`, `subset`, `run_id`).
"""

from __future__ import annotations

import json

import pytest
from sqlalchemy import select

from app.config import settings
from app.evaluation.golden_runner import Verdict, evaluate_verdict, run_golden_eval
from app.generation.generator import GenerationInput, GenerationResult
from app.generation.guardrail import GuardrailResult
from app.models.eval_run import EvalRun


def _run(
    *,
    faithfulness: float | None = 0.9,
    trust: float | None = 0.9,
    refusal_accuracy: float | None = 1.0,
    context_precision: float | None = None,
) -> EvalRun:
    """Build an unsaved EvalRun with the notes JSON `evaluate_verdict` reads."""
    return EvalRun(
        faithfulness=faithfulness,
        context_precision=context_precision,
        refusal_accuracy=refusal_accuracy,
        notes=json.dumps({"overall": {"trust": trust}}),
    )


class TestEvaluateVerdict:
    def test_all_metrics_above_thresholds_passes(self):
        verdict = evaluate_verdict(_run())

        assert isinstance(verdict, Verdict)
        assert verdict.passed is True
        assert verdict.failed_metrics == []

    def test_faithfulness_exactly_at_threshold_passes(self):
        verdict = evaluate_verdict(_run(faithfulness=settings.EVAL_MIN_FAITHFULNESS))
        assert verdict.passed is True

    def test_faithfulness_just_below_threshold_fails(self):
        verdict = evaluate_verdict(_run(faithfulness=settings.EVAL_MIN_FAITHFULNESS - 0.01))

        assert verdict.passed is False
        assert verdict.failed_metrics == ["faithfulness"]

    def test_trust_below_threshold_fails(self):
        verdict = evaluate_verdict(_run(trust=settings.EVAL_MIN_TRUST - 0.01))

        assert verdict.passed is False
        assert "trust" in verdict.failed_metrics

    def test_trust_exactly_at_threshold_passes(self):
        assert evaluate_verdict(_run(trust=settings.EVAL_MIN_TRUST)).passed is True

    def test_refusal_accuracy_below_threshold_fails(self):
        verdict = evaluate_verdict(
            _run(refusal_accuracy=settings.EVAL_REFUSAL_ACCURACY_MIN - 0.01)
        )

        assert verdict.passed is False
        assert "refusal_accuracy" in verdict.failed_metrics

    def test_context_precision_below_threshold_fails(self):
        verdict = evaluate_verdict(
            _run(context_precision=settings.EVAL_MIN_CONTEXT_PRECISION - 0.01)
        )

        assert verdict.passed is False
        assert "context_precision" in verdict.failed_metrics

    def test_absent_context_precision_is_not_a_failure(self):
        """ragas is an optional dependency — a missing score must not gate."""
        verdict = evaluate_verdict(_run(context_precision=None))

        assert verdict.passed is True
        assert "context_precision" not in verdict.failed_metrics

    def test_missing_core_metric_fails(self):
        verdict = evaluate_verdict(_run(faithfulness=None))

        assert verdict.passed is False
        assert "faithfulness" in verdict.failed_metrics

    def test_unparseable_notes_fails_on_trust(self):
        run = EvalRun(faithfulness=0.9, refusal_accuracy=1.0, notes="not json")

        verdict = evaluate_verdict(run)

        assert verdict.passed is False
        assert "trust" in verdict.failed_metrics

    def test_every_failing_metric_is_reported(self):
        verdict = evaluate_verdict(
            _run(faithfulness=0.0, trust=0.0, refusal_accuracy=0.0, context_precision=0.0)
        )

        assert verdict.passed is False
        assert set(verdict.failed_metrics) == {
            "faithfulness",
            "trust",
            "refusal_accuracy",
            "context_precision",
        }

    def test_thresholds_use_the_frontend_key_contract(self):
        verdict = evaluate_verdict(_run())

        assert set(verdict.thresholds.keys()) == {
            "min_faithfulness",
            "min_trust",
            "min_context_precision",
            "refusal_accuracy_min",
        }

    def test_as_dict_is_the_stored_verdict_contract(self):
        payload = evaluate_verdict(_run(faithfulness=0.0)).as_dict()

        assert set(payload.keys()) == {"passed", "failed_metrics", "thresholds"}
        assert payload["passed"] is False
        assert payload["failed_metrics"] == ["faithfulness"]


# ─── Runner ───────────────────────────────────────────────────────


class _Trust:
    def __init__(self, overall: float, relevance: float) -> None:
        self.overall = overall
        self.relevance = relevance


async def _trust_fn(retrieval_results=None, guardrail_result=None, generation_result=None, query=""):
    faith = getattr(guardrail_result, "score", 0.5) if guardrail_result else 0.5
    return _Trust(overall=round(min(1.0, 0.3 + 0.6 * faith), 4), relevance=0.8)


async def _guardrail_fn(answer, contexts):
    premise = " ".join(c.get("content", "") for c in contexts).lower()
    ans = (answer or "").strip().lower()
    if ans and ans in premise:
        return GuardrailResult(passed=True, score=0.95, details="mock: supported")
    return GuardrailResult(passed=False, score=0.2, details="mock: unsupported")


def _entries(count: int = 3):
    from evaluation.golden_dataset import get_entries_by_category

    return get_entries_by_category("answerable")[: count - 1] + get_entries_by_category(
        "unanswerable"
    )[:1]


class TestRunGoldenEvalPinning:
    async def test_prompt_override_reaches_generate_fn(self, test_db):
        seen: list[str | None] = []

        async def _generate(inp: GenerationInput) -> GenerationResult:
            seen.append(inp.system_prompt)
            ref = inp.contexts[0]["content"] if inp.contexts else ""
            return GenerationResult(text=ref, token_count=1, model_used="mock")

        await run_golden_eval(
            _entries(),
            generate_fn=_generate,
            guardrail_fn=_guardrail_fn,
            trust_fn=_trust_fn,
            db=test_db,
            prompt_override="PINNED PROMPT TEXT",
        )

        assert seen, "generate_fn should have been called"
        assert set(seen) == {"PINNED PROMPT TEXT"}

    async def test_model_override_reaches_generate_fn(self, test_db):
        seen: list[str | None] = []

        async def _generate(inp: GenerationInput) -> GenerationResult:
            seen.append(inp.model)
            return GenerationResult(text="x", token_count=1, model_used="mock")

        await run_golden_eval(
            _entries(),
            generate_fn=_generate,
            guardrail_fn=_guardrail_fn,
            trust_fn=_trust_fn,
            db=test_db,
            model_override="llama3.2:1b",
        )

        assert set(seen) == {"llama3.2:1b"}

    async def test_without_override_generate_fn_sees_no_system_prompt(self, test_db):
        seen: list[str | None] = []

        async def _generate(inp: GenerationInput) -> GenerationResult:
            seen.append(inp.system_prompt)
            return GenerationResult(text="x", token_count=1, model_used="mock")

        await run_golden_eval(
            _entries(),
            generate_fn=_generate,
            guardrail_fn=_guardrail_fn,
            trust_fn=_trust_fn,
            db=test_db,
        )

        assert set(seen) == {None}

    async def test_run_records_status_verdict_subset_and_linkage(self, test_db):
        async def _generate(inp: GenerationInput) -> GenerationResult:
            ref = inp.contexts[0]["content"] if inp.contexts else ""
            return GenerationResult(text=ref, token_count=1, model_used="mock-model")

        run = await run_golden_eval(
            _entries(),
            generate_fn=_generate,
            guardrail_fn=_guardrail_fn,
            trust_fn=_trust_fn,
            db=test_db,
            prompt_version_id="pv-123",
            subset="smoke",
            model_override="llama3.2:1b",
        )

        assert run.status in {"passed", "failed"}
        assert run.subset == "smoke"
        assert run.prompt_version_id == "pv-123"
        assert run.model_used == "llama3.2:1b"

        verdict = json.loads(run.verdict)
        assert set(verdict.keys()) == {"passed", "failed_metrics", "thresholds"}
        assert verdict["passed"] is (run.status == "passed")

    async def test_status_is_failed_when_thresholds_are_missed(self, test_db):
        async def _generate(inp: GenerationInput) -> GenerationResult:
            # Never grounded → guardrail 0.2 → faithfulness/trust below floors.
            return GenerationResult(text="An entirely ungrounded assertion.", model_used="mock")

        run = await run_golden_eval(
            _entries(),
            generate_fn=_generate,
            guardrail_fn=_guardrail_fn,
            trust_fn=_trust_fn,
            db=test_db,
            subset="smoke",
        )

        assert run.status == "failed"
        assert json.loads(run.verdict)["failed_metrics"]

    async def test_run_id_updates_an_existing_row_instead_of_inserting(self, test_db):
        placeholder = EvalRun(status="running", subset="smoke", prompt_version_id="pv-9")
        test_db.add(placeholder)
        await test_db.commit()
        await test_db.refresh(placeholder)

        async def _generate(inp: GenerationInput) -> GenerationResult:
            ref = inp.contexts[0]["content"] if inp.contexts else ""
            return GenerationResult(text=ref, token_count=1, model_used="mock")

        run = await run_golden_eval(
            _entries(),
            generate_fn=_generate,
            guardrail_fn=_guardrail_fn,
            trust_fn=_trust_fn,
            db=test_db,
            run_id=placeholder.id,
            prompt_version_id="pv-9",
            subset="smoke",
        )

        assert run.id == placeholder.id
        rows = (await test_db.execute(select(EvalRun))).scalars().all()
        assert len(rows) == 1
        assert rows[0].status != "running"
        assert rows[0].faithfulness is not None

    async def test_default_status_for_a_bare_row_is_passed(self, test_db):
        """Old rows (pre-010) must keep reading as `passed` for the dashboard."""
        row = EvalRun(faithfulness=0.8)
        test_db.add(row)
        await test_db.commit()
        await test_db.refresh(row)

        assert row.status == "passed"


class TestRunGoldenEvalUnchangedBehaviour:
    async def test_still_persists_one_row_with_notes_breakdown(self, test_db):
        async def _generate(inp: GenerationInput) -> GenerationResult:
            ref = inp.contexts[0]["content"] if inp.contexts else ""
            return GenerationResult(text=ref, token_count=1, model_used="mock")

        run = await run_golden_eval(
            _entries(),
            generate_fn=_generate,
            guardrail_fn=_guardrail_fn,
            trust_fn=_trust_fn,
            db=test_db,
        )

        rows = (await test_db.execute(select(EvalRun))).scalars().all()
        assert len(rows) == 1
        assert run.golden_set_version is not None
        assert len(run.golden_set_version) == 12

        parsed = json.loads(run.notes)
        assert "per_category" in parsed
        assert "per_difficulty" in parsed
        assert parsed["overall"]["refusal_accuracy"] == pytest.approx(1.0)
