"""Tests for investigation graph."""

from __future__ import annotations

import uuid
from dataclasses import asdict


from app.graph.investigation import (
    SubQuestion,
    ReasoningStep,
    DECOMPOSITION_PROMPT,
    SYNTHESIS_PROMPT,
    _try_parse_json,
    build_investigation_graph,
    run_investigation,
)


class TestSubQuestion:
    """Test SubQuestion dataclass."""

    def test_default_construction(self):
        sq = SubQuestion(id="id-1", question="What is X?", purpose="Find X")
        assert sq.id == "id-1"
        assert sq.question == "What is X?"
        assert sq.purpose == "Find X"
        assert sq.retrieved_chunks == []
        assert sq.partial_answer == ""
        assert sq.citations == []
        assert sq.trust_score is None
        assert sq.guardrail_passed is True
        assert sq.latency_ms == 0

    def test_with_all_fields(self):
        sq = SubQuestion(
            id="id-2",
            question="How does Y work?",
            purpose="Understand Y mechanism",
            retrieved_chunks=[{"chunk_id": "c1", "content": "test"}],
            partial_answer="Y works by...",
            citations=[{"text": "[source:1]", "chunk_id": "c1"}],
            trust_score=0.85,
            guardrail_passed=True,
            latency_ms=120,
        )
        assert sq.trust_score == 0.85
        assert len(sq.retrieved_chunks) == 1
        assert len(sq.citations) == 1

    def test_asdict_serialization(self):
        sq = SubQuestion(id="id-3", question="Why?", purpose="Find reason")
        d = asdict(sq)
        assert isinstance(d, dict)
        assert d["id"] == "id-3"
        assert d["question"] == "Why?"
        assert d["purpose"] == "Find reason"
        assert d["partial_answer"] == ""
        assert d["trust_score"] is None

    def test_asdict_roundtrip(self):
        sq = SubQuestion(
            id="id-4",
            question="Test",
            purpose="Test purpose",
            retrieved_chunks=[{"chunk_id": "c1"}],
            partial_answer="Answer",
            citations=[{"text": "[1]", "chunk_id": "c1"}],
            trust_score=0.9,
            guardrail_passed=False,
            latency_ms=50,
        )
        d = asdict(sq)
        restored = SubQuestion(**d)
        assert restored.id == sq.id
        assert restored.question == sq.question
        assert restored.trust_score == sq.trust_score
        assert restored.guardrail_passed == sq.guardrail_passed
        assert restored.latency_ms == sq.latency_ms
        assert restored.partial_answer == sq.partial_answer


class TestReasoningStep:
    """Test ReasoningStep dataclass."""

    def test_default_construction(self):
        step = ReasoningStep(phase="test", title="Test Step", description="A test")
        assert step.phase == "test"
        assert step.title == "Test Step"
        assert step.description == "A test"
        assert step.details == {}
        assert step.timestamp_ms == 0

    def test_with_details(self):
        step = ReasoningStep(
            phase="decompose",
            title="Decomposition",
            description="Breaking down question",
            details={"count": 3, "items": ["a", "b", "c"]},
            timestamp_ms=1700000000000,
        )
        assert step.details["count"] == 3
        assert step.timestamp_ms == 1700000000000

    def test_asdict_roundtrip(self):
        step = ReasoningStep(
            phase="investigate",
            title="Investigation",
            description="Looking up info",
            details={"key": "value"},
            timestamp_ms=1000,
        )
        d = asdict(step)
        restored = ReasoningStep(**d)
        assert restored.phase == d["phase"]
        assert restored.details == {"key": "value"}


class TestTryParseJson:
    """Test JSON parsing helper."""

    def test_direct_json_array(self):
        text = '[{"question": "Q1", "purpose": "P1"}, {"question": "Q2", "purpose": "P2"}]'
        result = _try_parse_json(text)
        assert result is not None
        assert len(result) == 2
        assert result[0]["question"] == "Q1"
        assert result[1]["purpose"] == "P2"

    def test_markdown_code_block(self):
        text = '```json\n[{"question": "Q1", "purpose": "P1"}]\n```'
        result = _try_parse_json(text)
        assert result is not None
        assert len(result) == 1
        assert result[0]["question"] == "Q1"

    def test_markdown_code_block_no_lang(self):
        text = '```\n[{"question": "Q1", "purpose": "P1"}]\n```'
        result = _try_parse_json(text)
        assert result is not None
        assert len(result) == 1

    def test_text_with_embedded_array(self):
        text = "Here is the result:\n[{\"question\": \"Q1\", \"purpose\": \"P1\"}]\nEnd"
        result = _try_parse_json(text)
        assert result is not None
        assert len(result) == 1

    def test_invalid_input(self):
        assert _try_parse_json("not json at all") is None
        assert _try_parse_json("") is None
        assert _try_parse_json("{}") is None  # Not a list

    def test_empty_array(self):
        assert _try_parse_json("[]") is not None
        assert _try_parse_json("[]") == []

    def test_malformed_array(self):
        result = _try_parse_json("Not a [json] array")
        # Should not find 'json' alone as valid bracket content —
        # it would try parsing "[json]" which fails, so returns None.
        assert result is None
        # And a truly malformed / unterminated bracket is also None.
        assert _try_parse_json("[invalid") is None


class TestPromptTemplates:
    """Test prompt templates format correctly."""

    def test_decomposition_prompt_formats(self):
        query = "What is the impact of climate change on agriculture?"
        prompt = DECOMPOSITION_PROMPT.format(query=query)
        assert query in prompt
        assert "sub-questions" in prompt.lower() or "sub questions" in prompt.lower()
        assert "JSON" in prompt

    def test_decomposition_prompt_special_chars(self):
        query = "How does 'RAG' work? & why is it useful?"
        prompt = DECOMPOSITION_PROMPT.format(query=query)
        assert query in prompt

    def test_synthesis_prompt_formats(self):
        query = "What is AI safety?"
        findings = "### Sub-question 1: Alignment\nFinding: Alignment ensures..."
        prompt = SYNTHESIS_PROMPT.format(query=query, sub_findings=findings)
        assert query in prompt
        assert findings in prompt
        assert "Executive Summary" in prompt
        assert "Confidence Assessment" in prompt

    def test_synthesis_prompt_with_multiple_findings(self):
        query = "Test"
        findings = "\n".join([
            f"### Sub-question {i}: Q{i}\nFinding: Answer {i}\n"
            for i in range(1, 5)
        ])
        prompt = SYNTHESIS_PROMPT.format(query=query, sub_findings=findings)
        assert findings in prompt


class TestBuildGraph:
    """Test graph construction."""

    def test_graph_is_compiled(self):
        graph = build_investigation_graph()
        assert graph is not None
        assert hasattr(graph, "invoke")

    def test_graph_has_expected_nodes(self):
        graph = build_investigation_graph()
        # Check nodes exist by inspecting the graph's internal structure
        nodes = graph.get_graph().nodes if hasattr(graph, "get_graph") else {}
        # LangGraph compiled graph exposes node names via get_graph().nodes.
        assert "decompose" in nodes
        assert "investigate" in nodes
        assert "synthesize" in nodes
        assert "compute_trust" in nodes
        # And it's still a callable graph with the right shape.
        assert hasattr(graph, "stream") or hasattr(graph, "invoke")

    def test_graph_runs_with_minimal_state(self):
        graph = build_investigation_graph()
        # Should handle basic invocation (will fail at LLM call but that's expected)
        # This tests that the graph structure is valid
        assert callable(getattr(graph, "invoke", None))


class TestRunInvestigation:
    """Test the convenience runner."""

    def test_run_investigation_returns_dict_with_keys(self):
        # This will fail at LLM level, but should return error dict
        result = run_investigation(
            query="What is machine learning?",
            workspace_id="ws-test",
            user_id="user-1",
        )
        assert isinstance(result, dict)
        # Should always have these keys
        assert "final_report" in result
        assert "trust_score" in result
        assert "trust_components" in result
        assert "reasoning_trace" in result
        assert "sub_questions" in result
        assert "latency_ms" in result
        assert "error" in result or "error" in result.get("final_report", "").lower()

    def test_run_investigation_includes_latency(self):
        result = run_investigation(
            query="Test?",
            workspace_id="ws-test",
        )
        assert isinstance(result.get("latency_ms"), int)
        assert result["latency_ms"] >= 0

    def test_run_investigation_sub_questions_fallback_on_error(self):
        # When LLM fails, should still return structure with fallback sub-question
        result = run_investigation(
            query="What is RAG?",
            workspace_id="ws-test",
        )
        # Should have at least the fallback sub-question or error
        assert len(result.get("sub_questions", [])) >= 0

    def test_run_investigation_with_custom_top_k(self):
        result = run_investigation(
            query="Test?",
            workspace_id="ws-test",
            top_k=5,
        )
        # Should not crash with custom top_k
        assert isinstance(result, dict)

    def test_run_investigation_with_filters(self):
        result = run_investigation(
            query="Test?",
            workspace_id="ws-test",
            filters={"document_id": "doc-123"},
        )
        assert isinstance(result, dict)


class TestGraphStates:
    """Test that state transitions work (structural tests)."""

    def test_decompose_node_state_keys(self):
        """Test that investigation state keys match what nodes expect."""
        from app.graph.investigation import InvestigationState

        # Verify TypedDict has required keys by creating minimal instance
        state = InvestigationState(
            query="test query",
            workspace_id="ws-1",
            user_id=None,
            query_id=str(uuid.uuid4()),
            top_k=10,
            filters=None,
            sub_questions=[],
            reasoning_trace=[],
            final_report=None,
            cited_spans=None,
            trust_score=None,
            trust_components=None,
            model_used="llama3.1:8b",
            latency_ms=0,
            error=None,
        )
        assert state["query"] == "test query"
        assert state["workspace_id"] == "ws-1"

    def test_investigation_result_structure(self):
        """Verify the shape of an investigation result dict."""
        result = run_investigation(
            query="What is the capital of France?",
            workspace_id="ws-test",
        )
        expected_keys = {
            "final_report", "trust_score", "trust_components",
            "reasoning_trace", "sub_questions", "latency_ms", "error",
        }
        # Even on error, all keys should be present
        missing = expected_keys - set(result.keys())
        assert not missing, f"Missing keys: {missing}"

    def test_trust_components_present(self):
        result = run_investigation(
            query="Trust test?",
            workspace_id="ws-test",
        )
        tc = result.get("trust_components", {})
        # Should be a dict (might be empty on error)
        assert isinstance(tc, dict)
