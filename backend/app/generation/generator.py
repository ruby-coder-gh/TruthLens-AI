"""Ollama-based answer generation with context."""

from __future__ import annotations

import time
from typing import Any, AsyncIterator

from app.config import settings
from app.utils.logger import logger


class GenerationInput:
    """Input to the generator."""

    def __init__(
        self,
        query: str,
        rewritten_query: str | None = None,
        contexts: list[dict[str, Any]] | None = None,
        conversation_history: list[dict[str, Any]] | None = None,
        system_prompt: str | None = None,
    ) -> None:
        self.query = query
        self.rewritten_query = rewritten_query
        self.contexts = contexts or []
        self.conversation_history = conversation_history or []
        self.system_prompt = system_prompt


class CitedSpan:
    """A span of text with its source chunk."""

    def __init__(self, text: str, chunk_id: str, start_index: int, end_index: int) -> None:
        self.text = text
        self.chunk_id = chunk_id
        self.start_index = start_index
        self.end_index = end_index


class GenerationResult:
    """Result of generation."""

    def __init__(
        self,
        text: str = "",
        cited_spans: list[CitedSpan] | None = None,
        token_count: int = 0,
        model_used: str = "",
        latency_ms: int = 0,
    ) -> None:
        self.text = text
        self.cited_spans = cited_spans or []
        self.token_count = token_count
        self.model_used = model_used
        self.latency_ms = latency_ms


DEFAULT_SYSTEM_PROMPT = (
    "You are a precise, factual Q&A assistant. Answer based ONLY on the provided context. "
    "If the context doesn't contain the answer, say 'I cannot find this information in your documents.' "
    "Cite sources by [source:N] where N is the source number. "
    "Be concise and accurate. Do not make up information."
)


def _build_context_text(contexts: list[dict[str, Any]]) -> str:
    """Build context string from retrieved chunks."""
    parts = []
    for i, ctx in enumerate(contexts):
        content = ctx.get("content", ctx.get("text", ""))
        doc_name = ctx.get("document_name", ctx.get("metadata", {}).get("document_name", f"Source {i+1}"))
        parts.append(f"[source:{i+1}] From '{doc_name}':\n{content}\n")
    return "\n".join(parts)


async def generate(input: GenerationInput) -> GenerationResult:
    """Generate answer from retrieved context using Ollama.

    Args:
        input: GenerationInput with query and contexts.

    Returns:
        GenerationResult with answer text.
    """
    from langchain_ollama import ChatOllama
    from langchain_core.messages import HumanMessage, SystemMessage

    start_time = time.time()

    context_text = _build_context_text(input.contexts)
    system_prompt = input.system_prompt or DEFAULT_SYSTEM_PROMPT

    llm = ChatOllama(
        model=settings.OLLAMA_PRIMARY_MODEL,
        base_url=settings.OLLAMA_BASE_URL,
        temperature=settings.OLLAMA_TEMPERATURE,
        top_p=settings.OLLAMA_TOP_P,
        num_predict=settings.OLLAMA_MAX_TOKENS,
        num_ctx=settings.OLLAMA_NUM_CTX,
        timeout=settings.OLLAMA_TIMEOUT,
    )

    query_text = input.rewritten_query or input.query

    messages = [
        SystemMessage(content=f"{system_prompt}\n\nContext:\n{context_text}"),
    ]

    # Add conversation history
    for msg in input.conversation_history[-6:]:  # Last 6 messages
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "user":
            messages.append(HumanMessage(content=content))
        else:
            messages.append(HumanMessage(content=f"[Previous response]: {content}"))

    messages.append(HumanMessage(content=f"Question: {query_text}"))

    try:
        response = llm.invoke(messages)
        answer = response.content.strip()
    except Exception as e:
        logger.error("generation_failed", error=str(e))
        # Try fallback model
        try:
            llm_fallback = ChatOllama(
                model=settings.OLLAMA_FALLBACK_MODEL,
                base_url=settings.OLLAMA_BASE_URL,
                temperature=settings.OLLAMA_TEMPERATURE,
            )
            response = llm_fallback.invoke(messages)
            answer = response.content.strip()
            model_used = settings.OLLAMA_FALLBACK_MODEL
        except Exception as e2:
            logger.error("fallback_generation_failed", error=str(e2))
            raise RuntimeError(f"Generation failed: {e}") from e
    else:
        model_used = settings.OLLAMA_PRIMARY_MODEL

    elapsed_ms = int((time.time() - start_time) * 1000)
    token_count = len(answer.split())

    # Post-process: add citations
    cited_spans = await cite(answer, input.contexts)

    result = GenerationResult(
        text=answer,
        cited_spans=cited_spans,
        token_count=token_count,
        model_used=model_used,
        latency_ms=elapsed_ms,
    )

    logger.info(
        "generation_complete",
        model=model_used,
        token_count=token_count,
        latency_ms=elapsed_ms,
        context_chunks=len(input.contexts),
    )
    return result


async def stream(input: GenerationInput) -> AsyncIterator[str]:
    """Stream tokens from Ollama generation.

    Args:
        input: GenerationInput.

    Yields:
        Tokens one by one.
    """
    from langchain_ollama import ChatOllama
    from langchain_core.messages import HumanMessage, SystemMessage

    context_text = _build_context_text(input.contexts)
    system_prompt = input.system_prompt or DEFAULT_SYSTEM_PROMPT

    llm = ChatOllama(
        model=settings.OLLAMA_PRIMARY_MODEL,
        base_url=settings.OLLAMA_BASE_URL,
        temperature=settings.OLLAMA_TEMPERATURE,
        top_p=settings.OLLAMA_TOP_P,
        num_predict=settings.OLLAMA_MAX_TOKENS,
        num_ctx=settings.OLLAMA_NUM_CTX,
        streaming=True,
    )

    query_text = input.rewritten_query or input.query
    messages = [
        SystemMessage(content=f"{system_prompt}\n\nContext:\n{context_text}"),
        HumanMessage(content=f"Question: {query_text}"),
    ]

    try:
        async for chunk in llm.astream(messages):
            if chunk.content:
                yield chunk.content
    except Exception as e:
        logger.error("stream_generation_failed", error=str(e))
        # Fallback model
        try:
            llm_fallback = ChatOllama(
                model=settings.OLLAMA_FALLBACK_MODEL,
                base_url=settings.OLLAMA_BASE_URL,
                temperature=settings.OLLAMA_TEMPERATURE,
                streaming=True,
            )
            async for chunk in llm_fallback.astream(messages):
                if chunk.content:
                    yield chunk.content
        except Exception as e2:
            logger.error("fallback_stream_failed", error=str(e2))
            yield f"\n\n[Error: Generation failed — {e}]"
