"""Extended tests for generator — input classes, edge cases, streaming."""

from __future__ import annotations

import pytest

from app.generation.generator import GenerationInput, GenerationResult, CitedSpan, DEFAULT_SYSTEM_PROMPT, _build_context_text


class TestGenerationResult:
    """Test GenerationResult class."""

    def test_default_construction(self):
        result = GenerationResult()
        assert result.text == ""
        assert result.cited_spans == []
        assert result.token_count == 0
        assert result.model_used == ""
        assert result.latency_ms == 0

    def test_with_all_fields(self):
        spans = [CitedSpan(text="test", chunk_id="c1", start_index=0, end_index=4)]
        result = GenerationResult(
            text="Answer text",
            cited_spans=spans,
            token_count=10,
            model_used="llama3.1:8b",
            latency_ms=150,
        )
        assert result.text == "Answer text"
        assert len(result.cited_spans) == 1
        assert result.token_count == 10
        assert result.model_used == "llama3.1:8b"
        assert result.latency_ms == 150


class TestCitedSpan:
    """Test CitedSpan class."""

    def test_construction(self):
        span = CitedSpan(text="source text", chunk_id="chunk-1", start_index=5, end_index=16)
        assert span.text == "source text"
        assert span.chunk_id == "chunk-1"
        assert span.start_index == 5
        assert span.end_index == 16


class TestGenerationInput:
    """Test GenerationInput edge cases."""

    def test_with_rewritten_query(self):
        inp = GenerationInput(query="original", rewritten_query="expanded version")
        assert inp.query == "original"
        assert inp.rewritten_query == "expanded version"

    def test_with_system_prompt(self):
        custom = "Custom system prompt"
        inp = GenerationInput(query="q", system_prompt=custom)
        assert inp.system_prompt == custom

    def test_with_conversation_history(self):
        history = [{"role": "user", "content": "Hello"}, {"role": "assistant", "content": "Hi"}]
        inp = GenerationInput(query="q", conversation_history=history)
        assert len(inp.conversation_history) == 2

    def test_context_text_fallback_to_text_key(self):
        contexts = [{"text": "fallback content", "document_name": "doc1"}]
        text = _build_context_text(contexts)
        assert "fallback content" in text

    def test_context_text_without_document_name(self):
        contexts = [{"content": "some content"}]
        text = _build_context_text(contexts)
        assert "some content" in text
        assert "Source 1" in text

    def test_default_system_prompt_contains_key_phrases(self):
        assert "based ONLY on the provided context" in DEFAULT_SYSTEM_PROMPT
        assert "source" in DEFAULT_SYSTEM_PROMPT.lower()


class TestStreamer:
    """Test streamer utilities."""

    @pytest.mark.asyncio
    async def test_stream_tokens_no_ollama(self):
        """Should handle Ollama unavailable gracefully."""
        from app.generation.streamer import stream_tokens
        from app.generation.generator import GenerationInput

        inp = GenerationInput(
            query="test",
            contexts=[{"content": "test context", "document_name": "doc"}],
        )

        async def mock_send(msg: dict) -> None:
            pass

        text, count, model = await stream_tokens(inp, "query-id", mock_send)
        # Should return some text even on error
        assert isinstance(text, str)
        assert isinstance(count, int)
        assert isinstance(model, str)
