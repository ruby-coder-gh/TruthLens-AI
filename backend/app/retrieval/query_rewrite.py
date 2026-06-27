"""LLM-based query reformulation for better retrieval."""

from __future__ import annotations

import json
from typing import Any

from app.config import settings
from app.utils.logger import logger


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

        response = llm.invoke(messages)
        rewritten = response.content.strip().strip('"').strip("'")

        logger.info(
            "query_rewritten",
            original_length=len(query),
            rewritten_length=len(rewritten),
        )
        return rewritten

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

        response = llm.invoke([("human", prompt.format(query=query))])
        content = response.content.strip()

        # Try to parse JSON
        if content.startswith("["):
            parsed = json.loads(content)
            if isinstance(parsed, list):
                variations.extend(parsed[:n_variations])

        logger.info("query_expanded", original=query[:100], variations=len(variations))
    except Exception as e:
        logger.warning("query_expand_failed", error=str(e), query=query[:100])

    return variations
