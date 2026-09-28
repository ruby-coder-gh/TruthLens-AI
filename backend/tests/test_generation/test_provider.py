"""Tests for app.generation.provider Ollama kwargs (keep_alive / reasoning).

Verified live against a local qwen3:4b (see provider.py comment): passing
`reasoning=False` does not reliably suppress <think> output, so OLLAMA_THINK=False
must omit the kwarg entirely rather than pass False.
"""

from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock

import pytest

from app.generation import provider


@pytest.fixture
def mock_chat_ollama(monkeypatch: pytest.MonkeyPatch):
    """Inject a mock langchain_ollama module and reset the provider cache."""
    mock_cls = MagicMock()
    mock_mod = types.ModuleType("langchain_ollama")
    mock_mod.ChatOllama = mock_cls
    monkeypatch.setitem(sys.modules, "langchain_ollama", mock_mod)
    provider.reset_provider_cache()
    monkeypatch.setattr(provider.settings, "LLM_PROVIDER", "ollama")
    yield mock_cls
    provider.reset_provider_cache()


def test_ollama_llm_always_gets_keep_alive(mock_chat_ollama, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(provider.settings, "OLLAMA_KEEP_ALIVE", "45m")

    provider.get_chat_llm()

    _, kwargs = mock_chat_ollama.call_args
    assert kwargs["keep_alive"] == "45m"


def test_ollama_llm_omits_reasoning_kwarg_when_think_disabled(mock_chat_ollama, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(provider.settings, "OLLAMA_THINK", False)

    provider.get_chat_llm()

    _, kwargs = mock_chat_ollama.call_args
    assert "reasoning" not in kwargs


def test_ollama_llm_passes_reasoning_true_when_think_enabled(mock_chat_ollama, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(provider.settings, "OLLAMA_THINK", True)

    provider.get_chat_llm()

    _, kwargs = mock_chat_ollama.call_args
    assert kwargs["reasoning"] is True
