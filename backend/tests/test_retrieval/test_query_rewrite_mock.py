"""Tests for query_rewrite with mocked ChatOllama.

Patches sys.modules['langchain_ollama'] since the real import is broken.
The module is lazy-imported inside rewrite/expand functions.
"""

from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock

import pytest

from app.retrieval.query_rewrite import rewrite, expand


class MockResponse:
    def __init__(self, content: str):
        self.content = content


@pytest.fixture(autouse=True)
def _rewrite_enabled(monkeypatch):
    """The shipped default is REWRITE_ENABLED=False (the configured reasoning
    model never produced a usable rewrite). These tests exercise the enabled
    path, so turn it on explicitly."""
    from app.config import settings

    monkeypatch.setattr(settings, "REWRITE_ENABLED", True)


@pytest.fixture
def mock_ollama():
    """Inject mock langchain_ollama module into sys.modules."""
    mock_mod = types.ModuleType("langchain_ollama")
    mock_core = types.ModuleType("langchain_core")

    def _setup(return_instance=None, side_effect=None):
        mock_cls = MagicMock(return_value=return_instance) if return_instance else MagicMock()
        if side_effect:
            mock_cls.side_effect = side_effect
        mock_mod.ChatOllama = mock_cls
        sys.modules["langchain_ollama"] = mock_mod
        sys.modules["langchain_core"] = mock_core
        return mock_cls

    yield _setup

    sys.modules.pop("langchain_ollama", None)
    sys.modules.pop("langchain_core", None)


@pytest.mark.asyncio
async def test_rewrite_success(mock_ollama):
    """Rewrite returns LLM output when Ollama works."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MockResponse(content="What is retrieval augmented generation in detail?")
    mock_ollama(return_instance=mock_llm)

    result = await rewrite("What is RAG?")
    assert result == "What is retrieval augmented generation in detail?"


@pytest.mark.asyncio
async def test_rewrite_strips_quotes(mock_ollama):
    """Rewrite strips surrounding quotes from LLM output."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MockResponse(content='"What is artificial intelligence?"')
    mock_ollama(return_instance=mock_llm)

    result = await rewrite("What is AI?")
    assert result == "What is artificial intelligence?"


@pytest.mark.asyncio
async def test_rewrite_strips_single_quotes(mock_ollama):
    """Rewrite strips surrounding single quotes."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MockResponse(content="'Explain machine learning concepts.'")
    mock_ollama(return_instance=mock_llm)

    result = await rewrite("Explain ML?")
    assert result == "Explain machine learning concepts."


@pytest.mark.asyncio
async def test_rewrite_fallback_on_error(mock_ollama):
    """Rewrite returns original query on error."""
    mock_llm = MagicMock()
    mock_llm.invoke.side_effect = Exception("Ollama unavailable")
    mock_ollama(return_instance=mock_llm)

    result = await rewrite("Original query here")
    assert result == "Original query here"


@pytest.mark.asyncio
async def test_rewrite_with_conversation_history(mock_ollama):
    """Rewrite uses conversation history."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MockResponse(content="Expanded query with context.")
    mock_ollama(return_instance=mock_llm)

    history = [
        {"role": "user", "content": "What is Python?"},
        {"role": "assistant", "content": "Python is a programming language."},
    ]

    result = await rewrite("What about Java?", conversation_history=history)
    assert result is not None
    assert mock_llm.invoke.called


@pytest.mark.asyncio
async def test_expand_success(mock_ollama):
    """Expand returns list including original query."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MockResponse(
        content='["What is RAG technology?", "Explain RAG in simple terms", "How does RAG work?"]'
    )
    mock_ollama(return_instance=mock_llm)

    result = await expand("What is RAG?", n_variations=3)
    assert len(result) >= 1
    assert "What is RAG?" in result
    assert any("RAG technology" in v for v in result)


@pytest.mark.asyncio
async def test_expand_fallback_on_error(mock_ollama):
    """Expand returns just the original query on error."""
    mock_llm = MagicMock()
    mock_llm.invoke.side_effect = Exception("Ollama error")
    mock_ollama(return_instance=mock_llm)

    result = await expand("Test query")
    assert result == ["Test query"]


@pytest.mark.asyncio
async def test_expand_malformed_json(mock_ollama):
    """Expand handles malformed JSON from LLM."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MockResponse(content="This is not valid JSON at all")
    mock_ollama(return_instance=mock_llm)

    result = await expand("Test")
    assert result == ["Test"]


@pytest.mark.asyncio
async def test_expand_limits_variations(mock_ollama):
    """Expand limits variations to n_variations."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MockResponse(
        content='["Var 1", "Var 2", "Var 3", "Var 4", "Var 5"]'
    )
    mock_ollama(return_instance=mock_llm)

    result = await expand("Original", n_variations=2)
    assert len(result) == 3
    assert result[0] == "Original"


class TestRewriteEmptyContentFallback:
    """A reasoning model that never closes its ``<think>`` block returns empty
    content with ``done_reason="length"``. The rewriter must fall back to the
    original query and say so loudly — a silent fallback on every query is
    indistinguishable from a working rewriter (QA: 100% fallback rate).
    """

    async def test_empty_content_falls_back_and_warns(self, monkeypatch):
        from app.retrieval import query_rewrite

        class _Response:
            content = ""
            response_metadata = {"done_reason": "length", "eval_count": 1024}

        class _LLM:
            def invoke(self, messages):
                return _Response()

        warnings: list[tuple[str, dict]] = []
        monkeypatch.setattr("app.generation.provider.get_chat_llm", lambda **kw: _LLM())
        monkeypatch.setattr(
            query_rewrite.logger,
            "warning",
            lambda event, **kw: warnings.append((event, kw)),
        )

        result = await query_rewrite.rewrite("what is the notice period?")

        assert result == "what is the notice period?"
        assert warnings and warnings[0][0] == "query_rewrite_empty_fallback"
        assert warnings[0][1]["done_reason"] == "length"

    async def test_reasoning_wrapped_answer_is_used(self, monkeypatch):
        """A closed ``<think>`` block is stripped and the real answer survives."""
        from app.retrieval import query_rewrite

        class _Response:
            content = "<think>The user means the MSA contract.</think>What is the termination notice period in the Master Services Agreement?"
            response_metadata = {"done_reason": "stop"}

        class _LLM:
            def invoke(self, messages):
                return _Response()

        monkeypatch.setattr("app.generation.provider.get_chat_llm", lambda **kw: _LLM())
        result = await query_rewrite.rewrite("what is the termination notice period in the MSA?")
        assert result == "What is the termination notice period in the Master Services Agreement?"


class TestRewriteTimeout:
    """The provider drops an unsupported `timeout` kwarg silently (ChatOllama has
    no such field), so the bound has to live in the rewriter itself — otherwise a
    reasoning model stalls the whole query for tens of seconds before falling back.
    """

    async def test_slow_model_is_bounded_and_falls_back(self, monkeypatch):
        import asyncio

        from app.config import settings
        from app.retrieval import query_rewrite

        class _LLM:
            def invoke(self, messages):
                import time

                time.sleep(5)  # far beyond the timeout below
                return type("R", (), {"content": "too late", "response_metadata": {}})()

        warnings: list[tuple[str, dict]] = []
        monkeypatch.setattr(settings, "REWRITE_ENABLED", True)
        monkeypatch.setattr(settings, "REWRITE_TIMEOUT_SECONDS", 1)
        monkeypatch.setattr("app.generation.provider.get_chat_llm", lambda **kw: _LLM())
        monkeypatch.setattr(
            query_rewrite.logger, "warning", lambda event, **kw: warnings.append((event, kw))
        )

        started = asyncio.get_event_loop().time()
        result = await query_rewrite.rewrite("what is the notice period?")
        elapsed = asyncio.get_event_loop().time() - started

        assert result == "what is the notice period?"
        assert elapsed < 4, f"rewrite was not bounded: took {elapsed:.1f}s"
        assert warnings and warnings[0][0] == "query_rewrite_timeout"

    async def test_disabled_by_default_returns_the_original_query(self, monkeypatch):
        """The shipped default is off — a reasoning model never produced a usable
        rewrite and cost 7-30s per query."""
        import app.config as config_module
        from app.retrieval import query_rewrite

        # Read the shipped default off a fresh Settings instance: the autouse
        # fixture flips the live singleton on for the other tests here.
        assert config_module.Settings.model_fields["REWRITE_ENABLED"].default is False
        monkeypatch.setattr(config_module.settings, "REWRITE_ENABLED", False)
        assert await query_rewrite.rewrite("unchanged?") == "unchanged?"
