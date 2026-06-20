"""Tests for streamer."""

from __future__ import annotations

import pytest

from app.generation.generator import GenerationInput


@pytest.mark.asyncio
async def test_stream_token_generator():
    """Test that stream_tokens handles empty input gracefully."""
    from app.generation.streamer import stream_tokens

    async def mock_send(msg):
        pass

    inp = GenerationInput(query="test", contexts=[])
    text, count, model = await stream_tokens(inp, "query-id", mock_send)
    assert isinstance(text, str)
    assert isinstance(count, int)
