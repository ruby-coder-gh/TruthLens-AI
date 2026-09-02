"""Answer generation with hybrid LLM provider support."""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any, AsyncIterator

from app.config import settings
from app.generation.citer import CitedSpan, cite
from app.generation.provider import get_chat_llm
from app.prompts.hashing import compute_hash
from app.utils.logger import logger

if TYPE_CHECKING:
    from langchain_core.messages import BaseMessage


class GenerationInput:
    """Input to the generator."""

    def __init__(
        self,
        query: str,
        rewritten_query: str | None = None,
        contexts: list[dict[str, Any]] | None = None,
        conversation_history: list[dict[str, Any]] | None = None,
        system_prompt: str | None = None,
        model: str | None = None,
    ) -> None:
        self.query = query
        self.rewritten_query = rewritten_query
        self.contexts = contexts or []
        self.conversation_history = conversation_history or []
        self.system_prompt = system_prompt
        # Model pinned alongside the prompt version ("" / None = provider default).
        self.model = model


class GenerationResult:
    """Result of generation."""

    def __init__(
        self,
        text: str = "",
        cited_spans: list[CitedSpan] | None = None,
        token_count: int = 0,
        model_used: str = "",
        latency_ms: int = 0,
        prompt_tokens: int | None = None,
        prompt_version: str = "",
    ) -> None:
        self.text = text
        self.cited_spans = cited_spans or []
        self.token_count = token_count
        self.model_used = model_used
        self.latency_ms = latency_ms
        # Input-side token usage, when the provider reports it.
        self.prompt_tokens = prompt_tokens
        # Content hash of the system prompt that produced this answer.
        self.prompt_version = prompt_version


DEFAULT_SYSTEM_PROMPT = (
    "You are a precise, factual Q&A assistant. Answer based ONLY on the provided context. "
    "If the context doesn't contain the answer, say 'I cannot find this information in your documents.' "
    "Cite sources by [source:N] where N is the source number. "
    "Be concise and accurate. Do not make up information."
)


def _positive_int(value: Any) -> int | None:
    """Coerce a provider-reported token count to a non-negative int, or None."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    coerced = int(value)
    return coerced if coerced >= 0 else None


def usage_tokens(message: Any) -> tuple[int | None, int | None]:
    """Read LangChain's standardised `usage_metadata` off a message/chunk.

    Returns ``(input_tokens, output_tokens)``; either element is ``None`` when
    the provider did not report it (Ollama only emits usage on the final
    chunk, and some OpenAI-compatible gateways omit it entirely), in which case
    callers fall back to the word-count estimate.
    """
    usage = getattr(message, "usage_metadata", None)
    if not isinstance(usage, dict):
        return None, None
    return _positive_int(usage.get("input_tokens")), _positive_int(usage.get("output_tokens"))


def response_model_name(message: Any) -> str:
    """Read the model the provider actually served, if it reported one."""
    meta = getattr(message, "response_metadata", None)
    if not isinstance(meta, dict):
        return ""
    for key in ("model_name", "model"):
        value = meta.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


def _build_context_text(contexts: list[dict[str, Any]]) -> str:
    """Build context string from retrieved chunks."""
    parts = []
    for i, ctx in enumerate(contexts):
        content = ctx.get("content", ctx.get("text", ""))
        doc_name = ctx.get("document_name", ctx.get("metadata", {}).get("document_name", f"Source {i+1}"))
        parts.append(f"[source:{i+1}] From '{doc_name}':\n{content}\n")
    return "\n".join(parts)


async def generate(input: GenerationInput) -> GenerationResult:
    """Generate answer from retrieved context using LLM provider.

    Args:
        input: GenerationInput with query and contexts.

    Returns:
        GenerationResult with answer text.
    """
    from langchain_core.messages import HumanMessage, SystemMessage

    start_time = time.time()

    context_text = _build_context_text(input.contexts)
    system_prompt = input.system_prompt or DEFAULT_SYSTEM_PROMPT

    llm = get_chat_llm(
        temperature=settings.OLLAMA_TEMPERATURE,
        max_tokens=settings.OLLAMA_MAX_TOKENS,
        timeout=settings.OLLAMA_TIMEOUT,
        top_p=settings.OLLAMA_TOP_P,
        model=input.model or "",
    )

    query_text = input.rewritten_query or input.query

    messages: list[BaseMessage] = [
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
        model_used = (
            response_model_name(response)
            or input.model
            or getattr(llm, "model_name", "")
            or settings.OPENAI_MODEL
        )
    except Exception as e:
        logger.error("generation_failed", error=str(e))
        # Try fallback model (Ollama only — use explicit fallback model)
        try:
            llm_fallback = get_chat_llm(
                temperature=settings.OLLAMA_TEMPERATURE,
                max_tokens=settings.OLLAMA_MAX_TOKENS,
                timeout=settings.OLLAMA_TIMEOUT,
                _fallback=True,
            )
            response = llm_fallback.invoke(messages)
            answer = response.content.strip()
            model_used = settings.OLLAMA_FALLBACK_MODEL
        except Exception as e2:
            logger.error("fallback_generation_failed", error=str(e2))
            raise RuntimeError(f"Generation failed: {e}") from e

    elapsed_ms = int((time.time() - start_time) * 1000)
    # Prefer the provider's own accounting; fall back to a word-count estimate.
    prompt_tokens, output_tokens = usage_tokens(response)
    token_count = output_tokens if output_tokens is not None else len(answer.split())

    # Post-process: add citations
    cited_spans = await cite(answer, input.contexts)

    result = GenerationResult(
        text=answer,
        cited_spans=cited_spans,
        token_count=token_count,
        model_used=model_used,
        latency_ms=elapsed_ms,
        prompt_tokens=prompt_tokens,
        prompt_version=compute_hash(system_prompt),
    )

    logger.info(
        "generation_complete",
        model=model_used,
        token_count=token_count,
        prompt_tokens=prompt_tokens,
        prompt_version=result.prompt_version,
        latency_ms=elapsed_ms,
        context_chunks=len(input.contexts),
    )
    return result


def capture_stream_metadata(chunk: Any, sink: dict[str, Any] | None) -> None:
    """Record provider-reported usage / model name off a streamed chunk.

    Providers report usage on a single (usually final) chunk, so the last
    non-empty value wins. A ``None`` sink makes this a no-op for callers that
    only want the text.
    """
    if sink is None:
        return
    input_tokens, output_tokens = usage_tokens(chunk)
    if input_tokens is not None:
        sink["prompt_tokens"] = input_tokens
    if output_tokens is not None:
        sink["output_tokens"] = output_tokens
    model = response_model_name(chunk)
    if model:
        sink["model_used"] = model


async def stream(
    input: GenerationInput,
    metadata_sink: dict[str, Any] | None = None,
) -> AsyncIterator[str]:
    """Stream tokens from LLM provider.

    Args:
        input: GenerationInput.
        metadata_sink: Optional dict populated with `prompt_tokens`,
            `output_tokens` and `model_used` as the provider reports them.

    Yields:
        Tokens one by one.
    """
    from langchain_core.messages import HumanMessage, SystemMessage

    context_text = _build_context_text(input.contexts)
    system_prompt = input.system_prompt or DEFAULT_SYSTEM_PROMPT

    llm = get_chat_llm(
        temperature=settings.OLLAMA_TEMPERATURE,
        max_tokens=settings.OLLAMA_MAX_TOKENS,
        timeout=settings.OLLAMA_TIMEOUT,
        top_p=settings.OLLAMA_TOP_P,
        model=input.model or "",
    )

    query_text = input.rewritten_query or input.query
    messages = [
        SystemMessage(content=f"{system_prompt}\n\nContext:\n{context_text}"),
        HumanMessage(content=f"Question: {query_text}"),
    ]

    try:
        async for chunk in llm.astream(messages):
            capture_stream_metadata(chunk, metadata_sink)
            if chunk.content:
                yield chunk.content
    except Exception as e:
        logger.error("stream_generation_failed", error=str(e))
        # Fallback model (Ollama)
        try:
            llm_fallback = get_chat_llm(
                temperature=settings.OLLAMA_TEMPERATURE,
                max_tokens=settings.OLLAMA_MAX_TOKENS,
                timeout=settings.OLLAMA_TIMEOUT,
                _fallback=True,
            )
            async for chunk in llm_fallback.astream(messages):
                capture_stream_metadata(chunk, metadata_sink)
                if chunk.content:
                    yield chunk.content
        except Exception as e2:
            logger.error("fallback_stream_failed", error=str(e2))
            yield f"\n\n[Error: Generation failed — {e}]"
