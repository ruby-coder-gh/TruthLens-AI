"""Async token generator for WebSocket streaming push."""

from __future__ import annotations

import asyncio
from typing import Any

from app.config import settings
from app.generation.generator import GenerationInput
from app.generation.provider import get_provider_name
from app.utils.logger import logger


async def stream_tokens(
    input: GenerationInput,
    query_id: str,
    send_fn: Any,  # Callable that sends WS messages
) -> tuple[str, int, str]:
    """Stream generation tokens to WebSocket client.

    Args:
        input: GenerationInput with query and contexts.
        query_id: UUID of the query (for WS messages).
        send_fn: Async callable to send WS message dicts.

    Returns:
        Tuple of (full_text, token_count, model_used).
    """
    from app.generation.generator import stream

    full_text: list[str] = []
    token_index = 0
    provider = get_provider_name()
    model_used = settings.OPENAI_MODEL if provider == "api" else settings.OLLAMA_PRIMARY_MODEL

    try:
        async for token in stream(input):
            full_text.append(token)
            await send_fn({
                "type": "token",
                "payload": {
                    "query_id": query_id,
                    "token": token,
                    "index": token_index,
                },
            })
            token_index += 1
            # Small yield to let event loop handle other tasks
            await asyncio.sleep(0)

        # Signal stream end
        await send_fn({
            "type": "stream_end",
            "payload": {"query_id": query_id},
        })

    except Exception as e:
        logger.error("stream_tokens_failed", error=str(e), query_id=query_id)
        await send_fn({
            "type": "error",
            "payload": {
                "code": "GENERATION_FAILED",
                "message": str(e),
                "query_id": query_id,
            },
        })
        return "".join(full_text), token_index, model_used

    answer = "".join(full_text)
    return answer, token_index, model_used
