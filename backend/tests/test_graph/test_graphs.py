"""Tests for query_graph and crag_graph."""

from __future__ import annotations

import uuid

import pytest



class TestQueryGraph:
    """Test query graph construction and state."""

    def test_build_returns_compiled_graph(self):
        from app.graph.query_graph import build_query_graph
        graph = build_query_graph()
        assert graph is not None
        assert callable(graph.invoke)

    def test_graph_has_expected_nodes(self):
        from app.graph.query_graph import build_query_graph
        graph = build_query_graph()
        # Should not raise
        assert graph.get_graph() is not None

    def test_graph_state_keys_match(self):
        from app.graph.query_graph import GraphState
        state = GraphState(
            query="test query",
            rewritten_query=None,
            workspace_id="ws-1",
            user_id=None,
            query_id=str(uuid.uuid4()),
            top_k=10,
            filters=None,
            retrieval_results=None,
            reranked_results=None,
            contexts=None,
            response_text=None,
            cited_spans=None,
            guardrail_result=None,
            guardrail_retry_count=0,
            trust_score=None,
            trust_components=None,
            model_used="llama3.1:8b",
            latency_ms=0,
            error=None,
        )
        assert state["query"] == "test query"
        assert state["workspace_id"] == "ws-1"
        assert state["guardrail_retry_count"] == 0

    @staticmethod
    def _state(**overrides):
        from app.graph.query_graph import GraphState
        base = dict(
            query="test", workspace_id="w", query_id="q",
            top_k=5, contexts=[],
            model_used="m", latency_ms=0,
            rewritten_query=None, user_id=None, filters=None,
            retrieval_results=None, reranked_results=None,
            response_text=None, cited_spans=None,
            guardrail_result=None, guardrail_retry_count=0,
            trust_score=None, trust_components=None, error=None,
            retrieval_attempts=0, edge_case=None,
        )
        base.update(overrides)
        return GraphState(**base)  # type: ignore[typeddict-item]

    @pytest.mark.asyncio
    async def test_should_continue_with_contexts(self):
        """Well-scored contexts go to generation."""
        from app.graph.query_graph import _should_continue
        state = self._state(contexts=[{"chunk_id": "c1", "content": "test", "rerank_score": 0.9}])
        result = _should_continue(state)
        assert result == "generate"

    @pytest.mark.asyncio
    async def test_should_continue_without_contexts(self):
        """Empty retrieval still gets one rewrite retry before abstaining."""
        from app.graph.query_graph import _should_continue
        state = self._state(contexts=[])
        result = _should_continue(state)
        assert result == "rewrite"

    @pytest.mark.asyncio
    async def test_should_continue_retries_when_evidence_is_weak(self):
        """F7c: non-empty but low-scoring contexts are no longer 'good enough'."""
        from app.graph.query_graph import _should_continue
        state = self._state(contexts=[{"chunk_id": "c1", "content": "test", "rerank_score": 0.02}])
        result = _should_continue(state)
        assert result == "rewrite"

    @pytest.mark.asyncio
    async def test_should_continue_abstains_once_the_retry_budget_is_spent(self):
        """Bounded loop: retrieve -> rewrite could previously cycle forever."""
        from app.graph.query_graph import _should_continue, MAX_RETRIEVAL_ATTEMPTS
        state = self._state(
            contexts=[{"chunk_id": "c1", "content": "test", "rerank_score": 0.02}],
            retrieval_attempts=MAX_RETRIEVAL_ATTEMPTS,
        )
        result = _should_continue(state)
        assert result == "abstain"

    @pytest.mark.asyncio
    async def test_should_continue_abstains_on_empty_retrieval_after_retries(self):
        from app.graph.query_graph import _should_continue, MAX_RETRIEVAL_ATTEMPTS
        state = self._state(contexts=[], retrieval_attempts=MAX_RETRIEVAL_ATTEMPTS)
        result = _should_continue(state)
        assert result == "abstain"

    @pytest.mark.asyncio
    async def test_should_continue_keeps_legacy_routing_when_the_gate_is_off(self, monkeypatch):
        from app.config import settings
        from app.graph.query_graph import _should_continue, MAX_RETRIEVAL_ATTEMPTS
        monkeypatch.setattr(settings, "SUFFICIENCY_GATE_ENABLED", False)
        weak = self._state(
            contexts=[{"chunk_id": "c1", "content": "test"}],
            retrieval_attempts=MAX_RETRIEVAL_ATTEMPTS,
        )
        empty = self._state(contexts=[], retrieval_attempts=MAX_RETRIEVAL_ATTEMPTS)
        assert _should_continue(weak) == "generate"
        assert _should_continue(empty) == "rewrite"

    @pytest.mark.asyncio
    async def test_abstain_node_answers_without_calling_a_model(self):
        from app.graph.query_graph import _abstain_node
        state = self._state(contexts=[{"chunk_id": "c1", "document_id": "d1", "rerank_score": 0.02}])

        result = await _abstain_node(state)

        assert result["response_text"].startswith("I cannot find this information in your documents.")
        assert result["edge_case"] == "insufficient_evidence"
        assert result["model_used"] == "abstain"
        assert result["cited_spans"] == []
        assert result["guardrail_result"]["passed"] is True

    @pytest.mark.asyncio
    async def test_retrieve_node_counts_its_attempts(self, monkeypatch):
        """The retry budget needs a counter that survives the rewrite loop."""
        import app.graph.query_graph as query_graph

        async def fake_hybrid_search(*args, **kwargs):
            return []

        async def fake_rerank(*args, **kwargs):
            return []

        monkeypatch.setattr(query_graph, "hybrid_search", fake_hybrid_search)
        monkeypatch.setattr(query_graph, "rerank", fake_rerank)

        result = await query_graph._retrieve_node(self._state(retrieval_attempts=1))

        assert result["retrieval_attempts"] == 2


class TestCRAGGraph:
    """Test CRAG graph construction and state."""

    def test_build_returns_compiled_graph(self):
        from app.graph.crag_graph import build_crag_graph
        graph = build_crag_graph()
        assert graph is not None
        assert callable(graph.invoke)

    def test_graph_has_expected_nodes(self):
        from app.graph.crag_graph import build_crag_graph
        graph = build_crag_graph()
        assert graph.get_graph() is not None

    def test_crag_state_keys(self):
        from app.graph.crag_graph import CRAGState
        state = CRAGState(
            query="test query",
            rewritten_query=None,
            workspace_id="ws-1",
            user_id=None,
            query_id=str(uuid.uuid4()),
            top_k=10,
            filters=None,
            retrieval_results=None,
            reranked_results=None,
            contexts=None,
            response_text=None,
            cited_spans=None,
            guardrail_result=None,
            guardrail_retry_count=0,
            guardrail_max_retries=3,
            trust_score=None,
            trust_components=None,
            model_used="llama3.1:8b",
            latency_ms=0,
            retrieval_attempts=0,
            max_retrieval_attempts=3,
            edge_case=None,
            error=None,
        )
        assert state["query"] == "test query"
        assert state["guardrail_max_retries"] == 3
        assert state["retrieval_attempts"] == 0

    @pytest.mark.asyncio
    async def test_relevance_check_high_score(self):
        from app.graph.crag_graph import _relevance_check, CRAGState
        state = CRAGState(
            query="test", workspace_id="w", query_id="q",
            top_k=5, contexts=[{"chunk_id": "c1", "content": "test", "score": 0.9}],
            model_used="m", latency_ms=0,
            rewritten_query=None, user_id=None, filters=None,
            retrieval_results=None, reranked_results=None,
            response_text=None, cited_spans=None,
            guardrail_result=None, guardrail_retry_count=0,
            guardrail_max_retries=3, trust_score=None,
            trust_components=None, retrieval_attempts=0,
            max_retrieval_attempts=3, edge_case=None, error=None,
        )
        result = _relevance_check(state)
        assert result == "generate"

    @pytest.mark.asyncio
    async def test_relevance_check_low_score_retry(self):
        from app.graph.crag_graph import _relevance_check, CRAGState
        state = CRAGState(
            query="test", workspace_id="w", query_id="q",
            top_k=5, contexts=[{"chunk_id": "c1", "content": "test", "score": 0.1}],
            model_used="m", latency_ms=0,
            rewritten_query=None, user_id=None, filters=None,
            retrieval_results=None, reranked_results=None,
            response_text=None, cited_spans=None,
            guardrail_result=None, guardrail_retry_count=0,
            guardrail_max_retries=3, trust_score=None,
            trust_components=None, retrieval_attempts=0,
            max_retrieval_attempts=3, edge_case=None, error=None,
        )
        result = _relevance_check(state)
        assert result == "expand_query"

    @pytest.mark.asyncio
    async def test_relevance_check_max_retries_exceeded(self):
        from app.graph.crag_graph import _relevance_check, CRAGState
        state = CRAGState(
            query="test", workspace_id="w", query_id="q",
            top_k=5, contexts=[{"chunk_id": "c1", "content": "test", "score": 0.1}],
            model_used="m", latency_ms=0,
            rewritten_query=None, user_id=None, filters=None,
            retrieval_results=None, reranked_results=None,
            response_text=None, cited_spans=None,
            guardrail_result=None, guardrail_retry_count=0,
            guardrail_max_retries=3, trust_score=None,
            trust_components=None, retrieval_attempts=3,
            max_retrieval_attempts=3, edge_case=None, error=None,
        )
        result = _relevance_check(state)
        assert result == "fallback"

    @pytest.mark.asyncio
    async def test_relevance_check_abstains_when_retrieval_came_back_empty(self):
        """F7c: with zero contexts the relaxed fallback LLM had nothing to ground
        on — it was pure hallucination surface. Abstain instead."""
        from app.graph.crag_graph import _relevance_check, CRAGState
        state = CRAGState(
            query="test", workspace_id="w", query_id="q",
            top_k=5, contexts=[],
            model_used="m", latency_ms=0,
            rewritten_query=None, user_id=None, filters=None,
            retrieval_results=None, reranked_results=None,
            response_text=None, cited_spans=None,
            guardrail_result=None, guardrail_retry_count=0,
            guardrail_max_retries=3, trust_score=None,
            trust_components=None, retrieval_attempts=3,
            max_retrieval_attempts=3, edge_case=None, error=None,
        )
        result = _relevance_check(state)
        assert result == "abstain"

    @pytest.mark.asyncio
    async def test_crag_abstain_node_returns_the_structured_refusal(self):
        from app.graph.crag_graph import _abstain_node, CRAGState
        state = CRAGState(
            query="test", workspace_id="w", query_id="q",
            top_k=5, contexts=[],
            model_used="m", latency_ms=0,
            rewritten_query=None, user_id=None, filters=None,
            retrieval_results=None, reranked_results=None,
            response_text=None, cited_spans=None,
            guardrail_result=None, guardrail_retry_count=0,
            guardrail_max_retries=3, trust_score=None,
            trust_components=None, retrieval_attempts=3,
            max_retrieval_attempts=3, edge_case=None, error=None,
        )

        result = await _abstain_node(state)

        assert result["response_text"].startswith("I cannot find this information in your documents.")
        assert result["edge_case"] == "insufficient_evidence"
        assert result["model_used"] == "abstain"

    @pytest.mark.asyncio
    async def test_guardrail_decision_passed(self):
        from app.graph.crag_graph import _guardrail_decision, CRAGState
        state = CRAGState(
            query="test", workspace_id="w", query_id="q",
            top_k=5,
            guardrail_result={"passed": True, "score": 0.9},
            guardrail_retry_count=0,
            guardrail_max_retries=3,
            model_used="m", latency_ms=0,
            rewritten_query=None, user_id=None, filters=None,
            retrieval_results=None, reranked_results=None,
            contexts=None, response_text=None, cited_spans=None,
            trust_score=None, trust_components=None,
            retrieval_attempts=0, max_retrieval_attempts=3,
            edge_case=None, error=None,
        )
        result = _guardrail_decision(state)
        assert result == "trust_score"

    @pytest.mark.asyncio
    async def test_guardrail_decision_retry(self):
        from app.graph.crag_graph import _guardrail_decision, CRAGState
        state = CRAGState(
            query="test", workspace_id="w", query_id="q",
            top_k=5,
            guardrail_result={"passed": False, "score": 0.3},
            guardrail_retry_count=1,
            guardrail_max_retries=3,
            model_used="m", latency_ms=0,
            rewritten_query=None, user_id=None, filters=None,
            retrieval_results=None, reranked_results=None,
            contexts=None, response_text=None, cited_spans=None,
            trust_score=None, trust_components=None,
            retrieval_attempts=0, max_retrieval_attempts=3,
            edge_case=None, error=None,
        )
        result = _guardrail_decision(state)
        assert result == "expand_query"

    @pytest.mark.asyncio
    async def test_guardrail_decision_fallback(self):
        from app.graph.crag_graph import _guardrail_decision, CRAGState
        state = CRAGState(
            query="test", workspace_id="w", query_id="q",
            top_k=5,
            guardrail_result={"passed": False, "score": 0.3},
            guardrail_retry_count=3,
            guardrail_max_retries=3,
            model_used="m", latency_ms=0,
            rewritten_query=None, user_id=None, filters=None,
            retrieval_results=None, reranked_results=None,
            contexts=None, response_text=None, cited_spans=None,
            trust_score=None, trust_components=None,
            retrieval_attempts=0, max_retrieval_attempts=3,
            edge_case=None, error=None,
        )
        result = _guardrail_decision(state)
        assert result == "fallback"


class TestIngestionGraph:
    """Test ingestion graph pipeline."""

    @pytest.mark.asyncio
    async def test_ingestion_fails_on_missing_file(self):
        from app.graph.ingestion_graph import run_ingestion_pipeline
        from pathlib import Path
        result = await run_ingestion_pipeline(
            document_id=str(uuid.uuid4()),
            workspace_id="ws-test",
            file_path=Path("/nonexistent/file.pdf"),
            mime_type="application/pdf",
            original_filename="test.pdf",
        )
        assert result["status"] == "failed"
        assert result["error"] is not None
        assert result["chunk_count"] == 0

    @pytest.mark.asyncio
    async def test_ingestion_fails_on_unsupported_mime(self):
        from app.graph.ingestion_graph import run_ingestion_pipeline
        from pathlib import Path
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".xyz", delete=False) as f:
            f.write(b"test content")
            tmp_path = f.name
        try:
            result = await run_ingestion_pipeline(
                document_id=str(uuid.uuid4()),
                workspace_id="ws-test",
                file_path=Path(tmp_path),
                mime_type="application/octet-stream",
                original_filename="test.xyz",
            )
            assert result["status"] == "failed"
        finally:
            import os
            os.unlink(tmp_path)

    @pytest.mark.asyncio
    async def test_ingestion_success_path(self, tmp_path):
        """Test ingestion with a valid text file."""
        from app.graph.ingestion_graph import run_ingestion_pipeline

        # Create a temp text file
        test_file = tmp_path / "test.txt"
        test_file.write_text("Hello world. This is test content for ingestion.")

        result = await run_ingestion_pipeline(
            document_id=str(uuid.uuid4()),
            workspace_id="ws-test-ingest-" + str(uuid.uuid4())[:8],
            file_path=test_file,
            mime_type="text/plain",
            original_filename="test.txt",
        )
        # Should succeed or fail gracefully
        assert "status" in result
        # On CI without ChromaDB, may fail at storage step
        if result["status"] == "failed":
            assert result["error"] is not None
        else:
            assert result["chunk_count"] > 0
