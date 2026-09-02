"""Tests for generator.generate() with mocked ChatOllama.

Patches sys.modules['langchain_ollama'] because the real import is broken
(version conflict with langchain_core). The module is lazy-imported inside
generator functions, so we inject a mock module before the function runs.
"""

from __future__ import annotations

import sys
import types
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.generation.generator import GenerationInput, generate, stream


class MockResponse:
    """Mock LangChain response / message chunk.

    `usage_metadata` and `response_metadata` are only set when a test supplies
    them, so the attribute is genuinely absent otherwise — that is the
    "provider reported nothing" case the generator must fall back from.
    """

    def __init__(
        self,
        content: str,
        usage_metadata: dict | None = None,
        response_metadata: dict | None = None,
    ):
        self.content = content
        if usage_metadata is not None:
            self.usage_metadata = usage_metadata
        if response_metadata is not None:
            self.response_metadata = response_metadata


# ── Helpers ────────────────────────────────────────────────────


def _mock_langchain_ollama(llm_instance):
    """Create a mock module for langchain_ollama with ChatOllama = llm_instance."""
    import types
    mock_module = types.ModuleType("langchain_ollama")
    mock_module.ChatOllama = llm_instance
    return mock_module


@pytest.fixture
def mock_ollama_module():
    """Inject mock langchain_ollama module into sys.modules."""
    mocks = {}

    def _inject(llm_cls=None, llm_instance=None):
        mock_mod = types.ModuleType("langchain_ollama")
        if llm_cls is not None:
            mock_mod.ChatOllama = llm_cls
        elif llm_instance is not None:
            # When used as `ChatOllama(...)`, return the instance
            mock_cls = MagicMock(return_value=llm_instance)
            mock_mod.ChatOllama = mock_cls
        # Also mock langchain_core.messages
        mock_core = types.ModuleType("langchain_core")
        mock_messages = types.ModuleType("langchain_core.messages")
        mock_messages.HumanMessage = MagicMock()
        mock_messages.SystemMessage = MagicMock()
        mock_core.messages = mock_messages
        sys.modules["langchain_core"] = mock_core
        sys.modules["langchain_core.messages"] = mock_messages
        sys.modules["langchain_ollama"] = mock_mod
        mocks["mod"] = mock_mod
        return mock_mod

    yield _inject

    # Cleanup
    sys.modules.pop("langchain_ollama", None)
    sys.modules.pop("langchain_core", None)
    sys.modules.pop("langchain_core.messages", None)


# ── Tests ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_generate_with_context(mock_ollama_module):
    """Generate answer from context returns result with text."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MockResponse(
        content="Based on the context, AI is artificial intelligence."
    )
    mock_ollama_module(llm_instance=mock_llm)

    inp = GenerationInput(
        query="What is AI?",
        contexts=[{"content": "AI is artificial intelligence.", "document_name": "doc1.txt"}],
    )

    with patch("app.generation.generator.cite", new=AsyncMock(return_value=[])):
        result = await generate(inp)

    assert "AI" in result.text
    assert result.token_count > 0
    assert result.model_used != ""
    assert result.latency_ms >= 0


@pytest.mark.asyncio
async def test_generate_without_context(mock_ollama_module):
    """Generate without context still returns answer."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MockResponse(content="I cannot find this information in your documents.")
    mock_ollama_module(llm_instance=mock_llm)

    inp = GenerationInput(query="What is X?")

    with patch("app.generation.generator.cite", new=AsyncMock(return_value=[])):
        result = await generate(inp)

    assert isinstance(result.text, str)
    assert len(result.text) > 0


@pytest.mark.asyncio
async def test_generate_with_conversation_history(mock_ollama_module):
    """Generate uses conversation history."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MockResponse(content="Following up on that...")
    mock_ollama_module(llm_instance=mock_llm)

    inp = GenerationInput(
        query="Tell me more",
        contexts=[{"content": "Additional info here.", "document_name": "doc2.txt"}],
        conversation_history=[
            {"role": "user", "content": "What is this about?"},
            {"role": "assistant", "content": "This is about testing."},
        ],
    )

    with patch("app.generation.generator.cite", new=AsyncMock(return_value=[])):
        result = await generate(inp)

    assert result.text is not None
    assert mock_llm.invoke.called


@pytest.mark.asyncio
async def test_generate_fallback_model(mock_ollama_module):
    """Generate falls back to secondary model on failure."""
    mock_primary = MagicMock()
    mock_primary.invoke.side_effect = Exception("Primary model unavailable")

    mock_fallback = MagicMock()
    mock_fallback.invoke.return_value = MockResponse(content="Fallback model answer.")

    # ChatOllama called twice: first returns primary, second returns fallback
    mock_cls = MagicMock()
    mock_cls.side_effect = [mock_primary, mock_fallback]
    mock_ollama_module(llm_cls=mock_cls)

    inp = GenerationInput(
        query="Test fallback",
        contexts=[{"content": "Some context here.", "document_name": "doc.txt"}],
    )

    with patch("app.generation.generator.cite", new=AsyncMock(return_value=[])):
        result = await generate(inp)

    assert "Fallback" in result.text


@pytest.mark.asyncio
async def test_generate_both_models_fail(mock_ollama_module):
    """Generate raises RuntimeError when both models fail."""
    mock_both = MagicMock()
    mock_both.invoke.side_effect = Exception("All models down")
    mock_ollama_module(llm_instance=mock_both)

    inp = GenerationInput(
        query="Will fail",
        contexts=[{"content": "Doesn't matter.", "document_name": "doc.txt"}],
    )

    with pytest.raises(RuntimeError):
        await generate(inp)


@pytest.mark.asyncio
async def test_generate_custom_system_prompt(mock_ollama_module):
    """Generate uses custom system prompt."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MockResponse(content="Custom response.")
    mock_ollama_module(llm_instance=mock_llm)

    inp = GenerationInput(
        query="Custom test",
        contexts=[{"content": "Some data.", "document_name": "d.txt"}],
        system_prompt="You are a test assistant. Be very brief.",
    )

    with patch("app.generation.generator.cite", new=AsyncMock(return_value=[])):
        result = await generate(inp)

    assert result.text is not None


@pytest.mark.asyncio
async def test_stream_basic(mock_ollama_module):
    """Stream yields tokens."""
    mock_llm = MagicMock()

    async def async_chunks(_):
        yield MockResponse("Hello ")
        yield MockResponse("world")

    mock_llm.astream = async_chunks
    mock_ollama_module(llm_instance=mock_llm)

    inp = GenerationInput(
        query="Stream test",
        contexts=[{"content": "Stream content.", "document_name": "s.txt"}],
    )

    tokens = [t async for t in stream(inp)]
    assert len(tokens) >= 1


@pytest.mark.asyncio
async def test_stream_fallback(mock_ollama_module):
    """Stream falls back on primary failure."""
    mock_primary = MagicMock()

    async def fail_stream(_):
        raise Exception("Stream failed")

    mock_primary.astream = fail_stream

    mock_fallback = MagicMock()

    async def fallback_chunks(_):
        yield MockResponse("Fallback token")

    mock_fallback.astream = fallback_chunks

    mock_cls = MagicMock()
    mock_cls.side_effect = [mock_primary, mock_fallback]
    mock_ollama_module(llm_cls=mock_cls)

    inp = GenerationInput(query="Stream fallback")

    tokens = [t async for t in stream(inp)]
    assert len(tokens) >= 1


# ── Token accounting / prompt + model pinning ──────────────────


@pytest.mark.asyncio
async def test_generate_uses_provider_usage_metadata_for_token_counts(mock_ollama_module):
    """When the provider reports usage, it wins over the word-count estimate."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MockResponse(
        content="Two words",  # word count would be 2
        usage_metadata={"input_tokens": 120, "output_tokens": 42},
    )
    mock_ollama_module(llm_instance=mock_llm)

    inp = GenerationInput(query="q", contexts=[{"content": "c"}])

    with patch("app.generation.generator.cite", new=AsyncMock(return_value=[])):
        result = await generate(inp)

    assert result.prompt_tokens == 120
    assert result.token_count == 42


@pytest.mark.asyncio
async def test_generate_falls_back_to_word_count_without_usage_metadata(mock_ollama_module):
    """Ollama builds that omit usage keep the previous estimate behaviour."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MockResponse(content="one two three four")
    mock_ollama_module(llm_instance=mock_llm)

    inp = GenerationInput(query="q", contexts=[{"content": "c"}])

    with patch("app.generation.generator.cite", new=AsyncMock(return_value=[])):
        result = await generate(inp)

    assert result.token_count == 4
    assert result.prompt_tokens is None


@pytest.mark.asyncio
async def test_generate_ignores_non_numeric_usage_values(mock_ollama_module):
    """A malformed usage payload must not poison the token columns."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MockResponse(
        content="one two three",
        usage_metadata={"input_tokens": None, "output_tokens": "lots"},
    )
    mock_ollama_module(llm_instance=mock_llm)

    inp = GenerationInput(query="q", contexts=[{"content": "c"}])

    with patch("app.generation.generator.cite", new=AsyncMock(return_value=[])):
        result = await generate(inp)

    assert result.prompt_tokens is None
    assert result.token_count == 3


@pytest.mark.asyncio
async def test_generate_stamps_prompt_version_hash(mock_ollama_module):
    """Every result records the content hash of the system prompt used."""
    from app.generation.generator import DEFAULT_SYSTEM_PROMPT
    from app.prompts.hashing import compute_hash

    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MockResponse(content="answer")
    mock_ollama_module(llm_instance=mock_llm)

    with patch("app.generation.generator.cite", new=AsyncMock(return_value=[])):
        default_result = await generate(GenerationInput(query="q"))
        pinned_result = await generate(
            GenerationInput(query="q", system_prompt="A pinned prompt.")
        )

    assert default_result.prompt_version == compute_hash(DEFAULT_SYSTEM_PROMPT)
    assert pinned_result.prompt_version == compute_hash("A pinned prompt.")
    assert pinned_result.prompt_version != default_result.prompt_version


@pytest.mark.asyncio
async def test_generate_prefers_the_model_the_provider_reports(mock_ollama_module):
    """`model_used` comes from the response, not from config guesswork."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MockResponse(
        content="answer", response_metadata={"model": "served-model:7b"}
    )
    mock_ollama_module(llm_instance=mock_llm)

    with patch("app.generation.generator.cite", new=AsyncMock(return_value=[])):
        result = await generate(GenerationInput(query="q"))

    assert result.model_used == "served-model:7b"


@pytest.mark.asyncio
async def test_generate_passes_pinned_model_to_the_provider(mock_ollama_module):
    """A prompt version may pin a model; it must reach `get_chat_llm`."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MockResponse(content="answer")
    mock_cls = MagicMock(return_value=mock_llm)
    mock_ollama_module(llm_cls=mock_cls)

    with patch("app.generation.generator.cite", new=AsyncMock(return_value=[])):
        await generate(GenerationInput(query="q", model="pinned-model:1b"))

    assert mock_cls.call_args.kwargs["model"] == "pinned-model:1b"


@pytest.mark.asyncio
async def test_stream_populates_the_metadata_sink(mock_ollama_module):
    """`stream()` surfaces usage/model off the chunks for the WS path."""
    mock_llm = MagicMock()

    async def async_chunks(_):
        yield MockResponse("Hello ")
        yield MockResponse(
            "world",
            usage_metadata={"input_tokens": 77, "output_tokens": 9},
            response_metadata={"model": "served-model:7b"},
        )

    mock_llm.astream = async_chunks
    mock_ollama_module(llm_instance=mock_llm)

    sink: dict = {}
    tokens = [t async for t in stream(GenerationInput(query="q"), metadata_sink=sink)]

    assert tokens == ["Hello ", "world"]
    assert sink["prompt_tokens"] == 77
    assert sink["output_tokens"] == 9
    assert sink["model_used"] == "served-model:7b"


@pytest.mark.asyncio
async def test_stream_without_provider_usage_leaves_sink_empty(mock_ollama_module):
    """No usage reported → nothing recorded, so callers keep their estimate."""
    mock_llm = MagicMock()

    async def async_chunks(_):
        yield MockResponse("a")
        yield MockResponse("b")

    mock_llm.astream = async_chunks
    mock_ollama_module(llm_instance=mock_llm)

    sink: dict = {}
    [t async for t in stream(GenerationInput(query="q"), metadata_sink=sink)]

    assert sink == {}
