"""LLM-based query reformulation for better retrieval."""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from app.config import settings
from app.utils.logger import logger

_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


def _strip_reasoning(content: Any) -> str:
    """Strip ``<think>…</think>`` reasoning blocks emitted by reasoning models.

    Models such as qwen3 wrap their chain-of-thought in ``<think>`` tags before
    the real answer, and sometimes return only the reasoning. Remove complete
    blocks, drop any unterminated leading block, and return the remaining text.
    """
    if isinstance(content, list):
        content = " ".join(
            str(part.get("text", "")) if isinstance(part, dict) else str(part)
            for part in content
        )
    text = _THINK_RE.sub("", str(content))
    if "<think>" in text and "</think>" not in text:
        text = text.split("<think>", 1)[0]
    return text.strip()


async def rewrite(
    query: str,
    conversation_history: list[dict[str, Any]] | None = None,
) -> str:
    """Rewrite/expand query using an LLM for better retrieval.

    Args:
        query: Original user query.
        conversation_history: Optional list of {"role": ..., "content": ...} messages.

    Returns:
        Rewritten query string.
    """
    if not settings.REWRITE_ENABLED:
        return query

    try:
        from app.generation.provider import get_chat_llm

        llm = get_chat_llm(
            temperature=settings.REWRITE_TEMPERATURE,
            max_tokens=settings.REWRITE_MAX_TOKENS,
        )

        system_prompt = (
            "You are a query rewriting assistant for a RAG system. "
            "Your task is to rewrite the user's query into a standalone, "
            "well-formed question optimized for search retrieval. "
            "Expand acronyms, resolve pronouns, add relevant context. "
            "Respond with ONLY the rewritten query — no explanations."
        )

        messages = [("system", system_prompt)]
        if conversation_history:
            for msg in conversation_history[-4:]:  # Last 4 messages
                role = msg.get("role", "user")
                content = msg.get("content", "")
                messages.append((role, content))

        messages.append(("human", query))

        # ChatOllama has no `timeout` field (langchain-ollama 1.1.0), so a
        # provider-level timeout is silently dropped — bound the wait here or a
        # reasoning model can stall the whole query for half a minute.
        response = await asyncio.wait_for(
            asyncio.to_thread(llm.invoke, messages),
            timeout=settings.REWRITE_TIMEOUT_SECONDS,
        )
        rewritten = _strip_reasoning(response.content).strip('"').strip("'").strip()

        # Reasoning models can return an empty string once <think> blocks are
        # stripped. Never hand an empty query downstream — fall back to the original.
        if not rewritten:
            # A reasoning model that never closed its <think> block returns empty
            # content with done_reason="length". Log loudly: a silent fallback on
            # every query looks identical to a working rewriter.
            metadata = getattr(response, "response_metadata", {}) or {}
            logger.warning(
                "query_rewrite_empty_fallback",
                original_length=len(query),
                done_reason=metadata.get("done_reason"),
                eval_count=metadata.get("eval_count"),
            )
            return query

        logger.info(
            "query_rewritten",
            original_length=len(query),
            rewritten_length=len(rewritten),
        )
        return rewritten

    except TimeoutError:
        logger.warning(
            "query_rewrite_timeout",
            timeout_seconds=settings.REWRITE_TIMEOUT_SECONDS,
            original_length=len(query),
        )
        return query

    except Exception as e:
        logger.warning("query_rewrite_failed", error=str(e), query=query[:100])
        return query


async def expand(
    query: str,
    n_variations: int = 3,
) -> list[str]:
    """Generate multiple query variations for expanded retrieval.

    Args:
        query: Original query.
        n_variations: Number of variations to generate.

    Returns:
        List of query variations including the original.
    """
    variations = [query]

    try:
        from app.generation.provider import get_chat_llm

        llm = get_chat_llm(
            temperature=0.3,
            max_tokens=512,
        )

        prompt = (
            f"Generate {n_variations} different versions of the following query. "
            "Each version should rephrase the query using different keywords "
            "while preserving the original meaning. "
            "Return as a JSON array of strings.\n\nQuery: {query}"
        )

        response = await asyncio.to_thread(llm.invoke, [("human", prompt.format(query=query))])
        content = _strip_reasoning(response.content)

        # Extract the JSON array even if the model wraps it in prose/reasoning.
        start, end = content.find("["), content.rfind("]")
        if start != -1 and end > start:
            parsed = json.loads(content[start : end + 1])
            if isinstance(parsed, list):
                variations.extend(str(v) for v in parsed[:n_variations])

        logger.info("query_expanded", original=query[:100], variations=len(variations))
    except Exception as e:
        logger.warning("query_expand_failed", error=str(e), query=query[:100])

    return variations
