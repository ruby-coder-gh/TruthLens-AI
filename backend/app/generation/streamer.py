"""Async token generator for WebSocket streaming push."""

from __future__ import annotations

import asyncio
from typing import Any

from app.config import settings
from app.generation.generator import DEFAULT_SYSTEM_PROMPT, GenerationInput
from app.generation.provider import get_provider_name
from app.prompts.hashing import compute_hash
from app.utils.logger import logger


async def stream_tokens(
    input: GenerationInput,
    query_id: str,
    send_fn: Any,  # Callable that sends WS messages
) -> tuple[str, int, str, int | None, str]:
    """Stream generation tokens to WebSocket client.

    Args:
        input: GenerationInput with query and contexts.
        query_id: UUID of the query (for WS messages).
        send_fn: Async callable to send WS message dicts.

    Returns:
        Tuple of (full_text, token_count, model_used, prompt_tokens,
        prompt_version). `token_count` / `model_used` prefer what the provider
        reported (LangChain `usage_metadata` / `response_metadata`) and fall
        back to the streamed-chunk count and the configured model.
        `prompt_tokens` is None when the provider reported no input usage.
        `prompt_version` is the content hash of the system prompt used.
    """
    from app.generation.generator import stream

    full_text: list[str] = []
    token_index = 0
    provider = get_provider_name()
    configured_model = settings.OPENAI_MODEL if provider == "api" else settings.OLLAMA_PRIMARY_MODEL
    prompt_version = compute_hash(input.system_prompt or DEFAULT_SYSTEM_PROMPT)

    # Populated by the generator from the provider's own accounting.
    metadata: dict[str, Any] = {}

    def _outcome() -> tuple[str, int, str, int | None, str]:
        reported_output = metadata.get("output_tokens")
        token_count = reported_output if isinstance(reported_output, int) else token_index
        model_used = metadata.get("model_used") or configured_model
        prompt_tokens = metadata.get("prompt_tokens")
        return (
            "".join(full_text),
            token_count,
            model_used,
            prompt_tokens if isinstance(prompt_tokens, int) else None,
            prompt_version,
        )

    try:
        async for token in stream(input, metadata_sink=metadata):
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
        return _outcome()

    return _outcome()
