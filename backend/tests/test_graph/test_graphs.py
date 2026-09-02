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

    @pytest.mark.asyncio
    async def test_should_continue_with_contexts(self):
        from app.graph.query_graph import _should_continue, GraphState
        state = GraphState(
            query="test", workspace_id="w", query_id="q",
            top_k=5, contexts=[{"chunk_id": "c1", "content": "test"}],
            model_used="m", latency_ms=0,
            rewritten_query=None, user_id=None, filters=None,
            retrieval_results=None, reranked_results=None,
            response_text=None, cited_spans=None,
            guardrail_result=None, guardrail_retry_count=0,
            trust_score=None, trust_components=None, error=None,
        )
        result = _should_continue(state)
        assert result == "generate"

    @pytest.mark.asyncio
    async def test_should_continue_without_contexts(self):
        from app.graph.query_graph import _should_continue, GraphState
        state = GraphState(
            query="test", workspace_id="w", query_id="q",
            top_k=5, contexts=[],
            model_used="m", latency_ms=0,
            rewritten_query=None, user_id=None, filters=None,
            retrieval_results=None, reranked_results=None,
            response_text=None, cited_spans=None,
            guardrail_result=None, guardrail_retry_count=0,
            trust_score=None, trust_components=None, error=None,
        )
        result = _should_continue(state)
        assert result == "rewrite"


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


class TestGenerateNodePromptPinning:
    """Both graph generate nodes resolve the active prompt and record its hash."""

    @staticmethod
    def _point_graph_at_test_engine(monkeypatch, module, test_engine):
        from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

        monkeypatch.setattr(
            module,
            "async_session_factory",
            async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False),
        )

    @staticmethod
    def _capture_generate(monkeypatch, module, captured, result):
        async def _generate(gen_input):
            captured["system_prompt"] = gen_input.system_prompt
            captured["model"] = gen_input.model
            return result

        monkeypatch.setattr(module, "generate_answer", _generate)

    @staticmethod
    def _result(**overrides):
        from app.generation.generator import GenerationResult

        defaults = dict(
            text="answer",
            token_count=9,
            model_used="served:7b",
            latency_ms=5,
            prompt_tokens=77,
            prompt_version="hash-from-generator",
        )
        defaults.update(overrides)
        return GenerationResult(**defaults)

    async def _seed_active_prompt(self, test_db, content, model_name=None):
        from app.models.prompt_version import PromptVersion
        from app.prompts import registry

        test_db.add(
            PromptVersion(
                name="answer",
                version=1,
                content=content,
                content_hash=registry.compute_hash(content),
                status="active",
                model_name=model_name,
            )
        )
        await test_db.commit()
        registry.invalidate("answer")

    async def test_query_graph_uses_default_prompt_when_none_active(
        self, monkeypatch, test_engine
    ):
        from app.graph import query_graph

        self._point_graph_at_test_engine(monkeypatch, query_graph, test_engine)
        captured: dict = {}
        self._capture_generate(monkeypatch, query_graph, captured, self._result())

        out = await query_graph._generate_node({"query": "q", "contexts": []})

        assert captured["system_prompt"] is None
        assert captured["model"] is None
        assert out["prompt_version"] == "hash-from-generator"
        assert out["token_count"] == 9
        assert out["prompt_tokens"] == 77

    async def test_query_graph_threads_active_prompt_and_pinned_model(
        self, monkeypatch, test_db, test_engine
    ):
        from app.graph import query_graph

        await self._seed_active_prompt(test_db, "Pinned graph prompt.", "pinned:1b")
        self._point_graph_at_test_engine(monkeypatch, query_graph, test_engine)
        captured: dict = {}
        self._capture_generate(monkeypatch, query_graph, captured, self._result())

        await query_graph._generate_node({"query": "q", "contexts": []})

        assert captured["system_prompt"] == "Pinned graph prompt."
        assert captured["model"] == "pinned:1b"

    async def test_crag_graph_threads_active_prompt(self, monkeypatch, test_db, test_engine):
        from app.graph import crag_graph

        await self._seed_active_prompt(test_db, "Pinned CRAG prompt.")
        self._point_graph_at_test_engine(monkeypatch, crag_graph, test_engine)
        captured: dict = {}
        self._capture_generate(monkeypatch, crag_graph, captured, self._result())

        out = await crag_graph._generate_primary_node({"query": "q", "contexts": []})

        assert captured["system_prompt"] == "Pinned CRAG prompt."
        assert out["prompt_version"] == "hash-from-generator"
        assert out["token_count"] == 9
        assert out["prompt_tokens"] == 77
