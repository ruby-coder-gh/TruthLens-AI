"""Tests for query_rewrite with mocked ChatOllama.

Patches sys.modules['langchain_ollama'] since the real import is broken.
The module is lazy-imported inside rewrite/expand functions.
"""

from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock, patch

import pytest

from app.retrieval.query_rewrite import rewrite, expand


class MockResponse:
    def __init__(self, content: str):
        self.content = content


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
