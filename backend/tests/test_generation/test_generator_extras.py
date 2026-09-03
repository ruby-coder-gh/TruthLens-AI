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


class TestPromptSpotlighting:
    """F7a: context blocks are wrapped in spotlight markers; system prompt warns about them."""

    def test_context_blocks_wrapped_in_spotlight_markers(self):
        contexts = [{"content": "Some retrieved text.", "document_name": "doc1.pdf"}]
        text = _build_context_text(contexts)
        assert "<<<source:1>>>" in text
        assert "<<<end>>>" in text
        assert "[source:1]" in text
        assert "Some retrieved text." in text

    def test_multiple_context_blocks_each_get_own_markers(self):
        contexts = [
            {"content": "Content A", "document_name": "doc1.pdf"},
            {"content": "Content B", "document_name": "doc2.pdf"},
        ]
        text = _build_context_text(contexts)
        assert "<<<source:1>>>" in text
        assert "<<<source:2>>>" in text
        assert text.count("<<<end>>>") == 2

    def test_system_prompt_warns_markers_are_data_not_instructions(self):
        prompt = DEFAULT_SYSTEM_PROMPT.lower()
        assert "<<<source" in prompt or "markers" in prompt
        assert "never" in prompt or "not instructions" in prompt or "untrusted" in prompt


class TestStreamer:
    """Test streamer utilities."""

    @pytest.mark.asyncio
    async def test_stream_tokens_no_ollama(self, monkeypatch):
        """Should handle Ollama unavailable gracefully.

        Force the Ollama provider at an unreachable address and disable the
        API provider so the test is deterministic regardless of whether a
        local Ollama or a real OPENAI_API_KEY happens to be present in the
        environment (LLM_PROVIDER=auto would otherwise probe the real
        OpenAI-compatible endpoint over the network).
        """
        from app.config import settings
        from app.generation import provider as provider_mod
        from app.generation.streamer import stream_tokens
        from app.generation.generator import GenerationInput

        monkeypatch.setattr(settings, "LLM_PROVIDER", "ollama")
        monkeypatch.setattr(settings, "OPENAI_API_KEY", "")
        monkeypatch.setattr(settings, "OLLAMA_BASE_URL", "http://127.0.0.1:1")
        provider_mod.reset_provider_cache()
        try:
            inp = GenerationInput(
                query="test",
                contexts=[{"content": "test context", "document_name": "doc"}],
            )

            async def mock_send(msg: dict) -> None:
                pass

            text, count, model, prompt_tokens, prompt_version = await stream_tokens(
                inp, "query-id", mock_send
            )
            # Should return some text even on error
            assert isinstance(text, str)
            assert isinstance(count, int)
            assert isinstance(model, str)
            assert prompt_tokens is None
            assert isinstance(prompt_version, str)
        finally:
            provider_mod.reset_provider_cache()
