"""Tests for the RAGAS/eval run write-path.

Covers `evaluation.evaluate.evaluate_pipeline` persisting an `EvalRun` row
(via `_persist_eval_run`) and `POST /admin/evaluation/run` queuing a
background golden-set run. No Ollama, no `ragas` package required — the
pipeline's `generate_answer` / `guardrail_check` / `ragas_evaluate` calls are
monkeypatched with deterministic fakes.
"""

from __future__ import annotations

import json

import pytest
from sqlalchemy import select

from app.evaluation.ragas_eval import RagasScores
from app.generation.generator import GenerationResult
from app.generation.guardrail import GuardrailResult
from app.models.eval_run import EvalRun


def _mock_generate_factory():
    """Deterministic generate(): echoes the reference context as the answer.

    Golden entries use the reference answer text as the (synthetic) source
    context (see `evaluate_pipeline`), so echoing it back yields a fully
    grounded answer for answerable entries and a "cannot be answered" style
    reply for the unanswerable ones (whose reference text says so).
    """

    async def _generate(gen_input):
        ctx = gen_input.contexts[0]["content"] if gen_input.contexts else ""
        return GenerationResult(text=ctx, token_count=len(ctx.split()), model_used="mock")

    return _generate


def _mock_guardrail_factory():
    """Deterministic guardrail: passes/high score when answer == context."""

    async def _guardrail(answer, contexts):
        premise = " ".join(c.get("content", "") for c in contexts)
        if answer and answer.strip() == premise.strip():
            return GuardrailResult(passed=True, score=0.95, details="mock: supported")
        return GuardrailResult(passed=False, score=0.2, details="mock: unsupported")

    return _guardrail


@pytest.fixture(autouse=True)
def _point_app_db_at_test_engine(monkeypatch, test_engine):
    """Redirect `app.database`'s session factory/engine to the test engine.

    `evaluate_pipeline` -> `_persist_eval_run` opens its own session via
    `app.database.async_session_factory` (imported fresh inside the function).
    Point those at the test engine/sessionmaker so the persisted row is
    visible through the `test_db` fixture used for assertions.
    """
    import app.database as db_module
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    test_session_factory = async_sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )
    monkeypatch.setattr(db_module, "engine", test_engine)
    monkeypatch.setattr(db_module, "async_session_factory", test_session_factory)
    yield


class TestEvaluatePipelineWritePath:
    """Test A / Test B: evaluate_pipeline persists one EvalRun row."""

    async def test_persists_eval_run_with_core_metrics(self, monkeypatch, test_db):
        """evaluate_pipeline(limit=51) writes exactly one EvalRun row.

        The golden dataset's first 50 entries are all "answerable"; limit=51
        pulls in one "unanswerable" entry too so refusal_accuracy has a
        denominator. faithfulness / answer_relevance / refusal_accuracy /
        golden_set_version are all non-null and `notes` is JSON containing
        `per_category`.
        """
        from evaluation import evaluate as evaluate_module

        monkeypatch.setattr(
            "app.generation.generator.generate", _mock_generate_factory()
        )
        monkeypatch.setattr(
            "app.generation.guardrail.check", _mock_guardrail_factory()
        )

        summary = await evaluate_module.evaluate_pipeline(limit=51)

        assert summary["completed"] >= 1

        rows = (await test_db.execute(select(EvalRun))).scalars().all()
        assert len(rows) == 1

        row = rows[0]
        assert row.faithfulness is not None
        assert row.answer_relevance is not None
        assert row.refusal_accuracy is not None
        assert row.golden_set_version is not None
        assert len(row.golden_set_version) == 12

        parsed = json.loads(row.notes)
        assert "per_category" in parsed
        assert "answerable" in parsed["per_category"]
        assert "unanswerable" in parsed["per_category"]
        assert "thresholds" in parsed

        # Exact key contract the frontend's `EvalCategoryBreakdown` /
        # `EvalThresholds` types parse (see
        # frontend/src/api/types.ts and AdminAnalyticsPage.tsx).
        answerable_bucket = parsed["per_category"]["answerable"]
        assert "count" in answerable_bucket
        assert "faithfulness" in answerable_bucket
        assert "refusal_accuracy" in answerable_bucket

        thresholds = parsed["thresholds"]
        assert set(thresholds.keys()) == {
            "min_faithfulness",
            "min_trust",
            "min_context_precision",
            "refusal_accuracy_min",
        }

    async def test_ragas_scores_populate_context_precision_and_recall(
        self, monkeypatch, test_db
    ):
        """When ragas_evaluate returns concrete scores, the persisted row's
        context_precision / context_recall equal the mocked values."""
        from evaluation import evaluate as evaluate_module

        monkeypatch.setattr(
            "app.generation.generator.generate", _mock_generate_factory()
        )
        monkeypatch.setattr(
            "app.generation.guardrail.check", _mock_guardrail_factory()
        )

        mocked_scores = RagasScores(
            faithfulness=0.77,
            answer_relevance=0.81,
            context_precision=0.66,
            context_recall=0.55,
            answer_correctness=0.9,
        )

        async def _fake_ragas_evaluate(queries, answers, contexts, ground_truth=None):
            return mocked_scores

        monkeypatch.setattr(
            "app.evaluation.ragas_eval.ragas_evaluate", _fake_ragas_evaluate
        )

        await evaluate_module.evaluate_pipeline(limit=3)

        rows = (await test_db.execute(select(EvalRun))).scalars().all()
        assert len(rows) == 1
        row = rows[0]

        assert row.context_precision == pytest.approx(0.66)
        assert row.context_recall == pytest.approx(0.55)

    async def test_ragas_absent_leaves_context_metrics_none(self, monkeypatch, test_db):
        """Graceful degradation: ragas_evaluate returning all-None scores
        (as it does when the `ragas` package is missing) must not crash the
        run, and context_precision/context_recall stay None."""
        from evaluation import evaluate as evaluate_module

        monkeypatch.setattr(
            "app.generation.generator.generate", _mock_generate_factory()
        )
        monkeypatch.setattr(
            "app.generation.guardrail.check", _mock_guardrail_factory()
        )

        async def _degraded_ragas_evaluate(queries, answers, contexts, ground_truth=None):
            return RagasScores()  # all None — package "not installed"

        monkeypatch.setattr(
            "app.evaluation.ragas_eval.ragas_evaluate", _degraded_ragas_evaluate
        )

        summary = await evaluate_module.evaluate_pipeline(limit=3)
        assert summary is not None

        rows = (await test_db.execute(select(EvalRun))).scalars().all()
        assert len(rows) == 1
        row = rows[0]
        assert row.context_precision is None
        assert row.context_recall is None
        # Core metrics still populate from the word-F1 / guardrail fallback.
        assert row.faithfulness is not None
        assert row.answer_relevance is not None


class TestRunEvaluationEndpoint:
    """Test C: POST /admin/evaluation/run returns the queued contract."""

    async def test_returns_202_queued_contract(self, client, admin_headers, monkeypatch):
        """Endpoint returns 202 with {status: queued, message, limit} and does
        not block on the (potentially slow / Ollama-less) background run."""

        # Prevent the fire-and-forget background task from doing real work
        # during the request test (it runs detached from the response anyway).
        async def _noop_background(*args, **kwargs):
            return None

        monkeypatch.setattr(
            "app.api.admin._run_golden_eval_background", _noop_background
        )

        resp = await client.post("/api/admin/evaluation/run", headers=admin_headers)

        assert resp.status_code == 202
        body = resp.json()
        assert body["status"] == "queued"
        assert "message" in body
        assert "limit" in body
        assert isinstance(body["limit"], int)

    async def test_accepts_limit_query_param(self, client, admin_headers, monkeypatch):
        """?limit= overrides the default smoke size in the response body."""

        async def _noop_background(*args, **kwargs):
            return None

        monkeypatch.setattr(
            "app.api.admin._run_golden_eval_background", _noop_background
        )

        resp = await client.post(
            "/api/admin/evaluation/run?limit=10", headers=admin_headers
        )

        assert resp.status_code == 202
        assert resp.json()["limit"] == 10


class TestEvaluationHistoryIncludesNotes:
    """GET /admin/evaluation/history must surface `notes` so the frontend's
    per-category table and threshold badges (which parse `notes` as JSON)
    can populate. See frontend/src/pages/AdminAnalyticsPage.tsx +
    frontend/src/api/types.ts (`EvalRunResponse.notes`)."""

    async def test_history_response_includes_notes_json(self, client, admin_headers, test_db):
        notes_payload = {
            "per_category": {
                "answerable": {"count": 3, "faithfulness": 0.9, "refusal_accuracy": None},
                "unanswerable": {"count": 1, "faithfulness": 0.5, "refusal_accuracy": 1.0},
            },
            "thresholds": {
                "min_faithfulness": 0.6,
                "min_trust": 0.5,
                "min_context_precision": 0.5,
                "refusal_accuracy_min": 0.7,
            },
        }
        row = EvalRun(
            faithfulness=0.8,
            answer_relevance=0.7,
            refusal_accuracy=1.0,
            golden_set_version="abcdef012345",
            notes=json.dumps(notes_payload),
        )
        test_db.add(row)
        await test_db.commit()

        resp = await client.get("/api/admin/evaluation/history", headers=admin_headers)

        assert resp.status_code == 200
        body = resp.json()
        assert body["data"], "expected at least one eval run in history"

        entry = body["data"][0]
        assert "notes" in entry
        assert entry["notes"] is not None

        parsed = json.loads(entry["notes"])
        assert parsed["per_category"]["answerable"]["count"] == 3
        assert parsed["thresholds"]["min_faithfulness"] == 0.6
        assert set(parsed["thresholds"].keys()) == {
            "min_faithfulness",
            "min_trust",
            "min_context_precision",
            "refusal_accuracy_min",
        }
