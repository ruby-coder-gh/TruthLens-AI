"""Tests for generator."""

from __future__ import annotations

import pytest

from app.generation.generator import GenerationInput, _build_context_text


def test_build_context_text_empty():
    """Test building context from empty list."""
    text = _build_context_text([])
    assert text == ""


def test_build_context_text_single():
    """Test building context from single source."""
    contexts = [{"content": "Test content", "document_name": "doc1.pdf"}]
    text = _build_context_text(contexts)
    assert "Test content" in text
    assert "doc1.pdf" in text


def test_build_context_text_multiple():
    """Test building context from multiple sources."""
    contexts = [
        {"content": "Content A", "document_name": "doc1.pdf"},
        {"content": "Content B", "document_name": "doc2.pdf"},
    ]
    text = _build_context_text(contexts)
    assert "Content A" in text
    assert "Content B" in text
    assert "[source:1]" in text
    assert "[source:2]" in text


def test_generation_input_defaults():
    """Test GenerationInput default values."""
    inp = GenerationInput(query="test")
    assert inp.query == "test"
    assert inp.contexts == []
    assert inp.conversation_history == []
    assert inp.system_prompt is None


@pytest.mark.asyncio
async def test_generate_no_ollama(monkeypatch):
    """generate() raises when no LLM provider is reachable.

    Force the Ollama provider at an unreachable address and disable the API
    provider so the test is deterministic regardless of whether a local Ollama
    happens to be running.
    """
    from app.config import settings
    from app.generation import provider as provider_mod
    from app.generation.generator import generate

    monkeypatch.setattr(settings, "LLM_PROVIDER", "ollama")
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "")
    monkeypatch.setattr(settings, "OLLAMA_BASE_URL", "http://127.0.0.1:1")
    provider_mod.reset_provider_cache()
    try:
        inp = GenerationInput(
            query="What is AI?",
            contexts=[{"content": "AI is artificial intelligence.", "document_name": "test.txt"}],
        )
        with pytest.raises(Exception):
            await generate(inp)
    finally:
        provider_mod.reset_provider_cache()
