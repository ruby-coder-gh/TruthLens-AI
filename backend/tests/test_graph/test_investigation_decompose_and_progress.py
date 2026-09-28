"""Node-level tests for BUG-10: sub-question cap + progress reporting.

`test_investigation.py` covers the graph end-to-end and makes real Ollama
calls; every test here mocks `_run_llm`/`hybrid_search` instead so it's fast
and deterministic. Ollama is never contacted.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.config import settings
from app.graph import investigation_progress as ip
from app.graph.investigation import _decompose_node, _investigate_sub_question, _synthesize_node


def teardown_function(_fn) -> None:
    ip._registry.clear()  # noqa: SLF001 — test-only reach into internal state


def _base_state(investigation_id: str | None = "inv-x") -> dict:
    return {
        "query": "What are the risks and their mitigations?",
        "workspace_id": "ws-1",
        "user_id": "user-1",
        "query_id": "q-1",
        "top_k": 10,
        "filters": None,
        "investigation_id": investigation_id,
        "reasoning_trace": [],
    }


class TestDecomposeSubQuestionCap:
    def test_truncates_llm_response_to_configured_max(self):
        fake_response = "[" + ",".join(f'{{"question": "Q{i}?", "purpose": "P{i}"}}' for i in range(1, 7)) + "]"

        ip.start("inv-x")
        with patch("app.graph.investigation._run_llm", return_value=fake_response) as mock_llm:
            result = _decompose_node(_base_state())

        assert len(result["sub_questions"]) == settings.INVESTIGATION_MAX_SUB_QUESTIONS
        assert [sq["question"] for sq in result["sub_questions"]] == ["Q1?", "Q2?", "Q3?", "Q4?"]
        mock_llm.assert_called_once()
        assert mock_llm.call_args.kwargs["max_tokens"] == settings.INVESTIGATION_DECOMPOSE_MAX_TOKENS

    def test_reports_capped_sub_questions_into_progress_registry(self):
        fake_response = "[" + ",".join(f'{{"question": "Q{i}?", "purpose": "P{i}"}}' for i in range(1, 7)) + "]"
        ip.start("inv-x")
        with patch("app.graph.investigation._run_llm", return_value=fake_response):
            _decompose_node(_base_state())

        snapshot = ip.get("inv-x")
        assert snapshot["step"] == "investigate"
        assert snapshot["done_steps"] == 1
        assert snapshot["total_steps"] == settings.INVESTIGATION_MAX_SUB_QUESTIONS + 3
        assert len(snapshot["sub_questions"]) == settings.INVESTIGATION_MAX_SUB_QUESTIONS
        assert all(sq["status"] == "pending" for sq in snapshot["sub_questions"])

    def test_no_investigation_id_skips_progress_reporting_without_error(self):
        fake_response = '[{"question": "Q1?", "purpose": "P1"}]'
        with patch("app.graph.investigation._run_llm", return_value=fake_response):
            result = _decompose_node(_base_state(investigation_id=None))
        assert len(result["sub_questions"]) == 1

    def test_llm_failure_fallback_still_reports_progress(self):
        ip.start("inv-x")
        with patch("app.graph.investigation._run_llm", side_effect=RuntimeError("ollama unreachable")):
            result = _decompose_node(_base_state())

        assert len(result["sub_questions"]) == 1  # single fallback sub-question
        snapshot = ip.get("inv-x")
        assert snapshot["step"] == "investigate"
        assert len(snapshot["sub_questions"]) == 1


class TestSynthesizeNodeConfiguredTokens:
    def test_uses_configured_max_tokens_and_advances_progress(self):
        ip.start("inv-x")
        ip.set_sub_questions("inv-x", ["Q1?"])
        state = _base_state()
        state["sub_questions"] = [{"id": "sq-1", "question": "Q1?", "purpose": "P", "partial_answer": "A", "citations": []}]

        with patch("app.graph.investigation._run_llm", return_value="Report text") as mock_llm:
            _synthesize_node(state)

        assert mock_llm.call_args.kwargs["max_tokens"] == settings.INVESTIGATION_SYNTHESIS_MAX_TOKENS
        snapshot = ip.get("inv-x")
        assert snapshot["step"] == "trust_score"
        assert snapshot["done_steps"] == 2  # decompose(1) + synthesize(1)


class TestInvestigateSubQuestionProgress:
    @pytest.mark.asyncio
    async def test_marks_running_then_done_on_no_results(self):
        ip.start("inv-x")
        ip.set_sub_questions("inv-x", ["Q1?", "Q2?"])
        sq = {"id": "sq-1", "question": "Q1?", "purpose": "find Q1"}

        with patch("app.graph.investigation.hybrid_search", AsyncMock(return_value=[])) as mock_search, \
             patch("app.graph.investigation.investigation_progress.mark_sub_question", wraps=ip.mark_sub_question) as spy:
            await _investigate_sub_question(sq, "ws-1", 10, None, "inv-x", 0)

        mock_search.assert_awaited_once()
        assert spy.call_args_list == [
            (("inv-x", 0, "running"), {}),
            (("inv-x", 0, "done"), {}),
        ]
        snapshot = ip.get("inv-x")
        assert snapshot["sub_questions"][0]["status"] == "done"
        assert snapshot["sub_questions"][1]["status"] == "pending"
        assert snapshot["done_steps"] == 2  # decompose(1) + this sub-question(1)
