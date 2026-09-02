"""Tests for streamer.

`stream_tokens` returns everything the WS save-path needs to record an honest
row: the text, the output-token count, the model the provider actually served,
the input-token count, and the hash of the system prompt that produced it.
"""

from __future__ import annotations

import pytest

from app.config import settings
from app.generation.generator import DEFAULT_SYSTEM_PROMPT, GenerationInput
from app.prompts.hashing import compute_hash


async def _noop_send(msg):
    return None


def _fake_stream(tokens, metadata=None):
    """Build a `generator.stream` replacement that reports `metadata`."""

    async def _stream(inp, metadata_sink=None):
        if metadata_sink is not None and metadata:
            metadata_sink.update(metadata)
        for token in tokens:
            yield token

    return _stream


@pytest.mark.asyncio
async def test_stream_token_generator():
    """Test that stream_tokens handles empty input gracefully."""
    from app.generation.streamer import stream_tokens

    inp = GenerationInput(query="test", contexts=[])
    text, count, model, prompt_tokens, prompt_version = await stream_tokens(
        inp, "query-id", _noop_send
    )
    assert isinstance(text, str)
    assert isinstance(count, int)
    assert isinstance(model, str)
    assert prompt_tokens is None or isinstance(prompt_tokens, int)
    assert isinstance(prompt_version, str)


@pytest.mark.asyncio
async def test_stream_tokens_uses_provider_reported_usage(monkeypatch):
    """Provider usage wins over the chunk-count estimate."""
    from app.generation.streamer import stream_tokens

    monkeypatch.setattr(
        "app.generation.generator.stream",
        _fake_stream(
            ["a", "b", "c"],
            {"prompt_tokens": 77, "output_tokens": 9, "model_used": "served:7b"},
        ),
    )

    text, count, model, prompt_tokens, _ = await stream_tokens(
        GenerationInput(query="q"), "qid", _noop_send
    )

    assert text == "abc"
    assert count == 9
    assert prompt_tokens == 77
    assert model == "served:7b"


@pytest.mark.asyncio
async def test_stream_tokens_falls_back_to_chunk_count_and_config(monkeypatch):
    """Without provider usage the previous estimate/inference is preserved."""
    from app.generation.streamer import stream_tokens

    monkeypatch.setattr("app.generation.generator.stream", _fake_stream(["a", "b", "c"]))

    text, count, model, prompt_tokens, _ = await stream_tokens(
        GenerationInput(query="q"), "qid", _noop_send
    )

    assert text == "abc"
    assert count == 3
    assert prompt_tokens is None
    assert model == settings.OLLAMA_PRIMARY_MODEL


@pytest.mark.asyncio
async def test_stream_tokens_reports_the_prompt_version(monkeypatch):
    """The hash recorded is the hash of the prompt actually sent."""
    from app.generation.streamer import stream_tokens

    monkeypatch.setattr("app.generation.generator.stream", _fake_stream(["x"]))

    _, _, _, _, default_hash = await stream_tokens(
        GenerationInput(query="q"), "qid", _noop_send
    )
    _, _, _, _, pinned_hash = await stream_tokens(
        GenerationInput(query="q", system_prompt="A pinned prompt."), "qid", _noop_send
    )

    assert default_hash == compute_hash(DEFAULT_SYSTEM_PROMPT)
    assert pinned_hash == compute_hash("A pinned prompt.")


@pytest.mark.asyncio
async def test_stream_tokens_error_path_still_returns_full_tuple(monkeypatch):
    """A mid-stream failure reports what was produced, not a shape change."""
    from app.generation.streamer import stream_tokens

    async def _exploding_stream(inp, metadata_sink=None):
        yield "partial"
        raise RuntimeError("provider died")

    monkeypatch.setattr("app.generation.generator.stream", _exploding_stream)

    sent: list[dict] = []

    async def _record(msg):
        sent.append(msg)

    text, count, model, prompt_tokens, prompt_version = await stream_tokens(
        GenerationInput(query="q"), "qid", _record
    )

    assert text == "partial"
    assert count == 1
    assert prompt_tokens is None
    assert prompt_version == compute_hash(DEFAULT_SYSTEM_PROMPT)
    assert model
    assert sent[-1]["type"] == "error"
    assert sent[-1]["payload"]["code"] == "GENERATION_FAILED"
