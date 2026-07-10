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
async def test_generate_no_ollama():
    """Test generate raises when Ollama unavailable."""
    from app.generation.generator import generate

    inp = GenerationInput(query="What is AI?", contexts=[{"content": "AI is artificial intelligence.", "document_name": "test.txt"}])
    with pytest.raises((RuntimeError, Exception)):
        await generate(inp)
