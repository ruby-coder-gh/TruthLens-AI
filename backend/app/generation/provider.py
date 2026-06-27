"""LLM provider factory: API (OpenAI-compatible) → Ollama fallback."""

from __future__ import annotations

from typing import Any

from app.config import settings
from app.utils.logger import logger

_provider: str | None = None  # None=unset, "api", "ollama"


def get_chat_llm(
    temperature: float | None = None,
    max_tokens: int | None = None,
    timeout: int | None = None,
    model: str = "",
    **kwargs: Any,
) -> Any:
    """Get configured LLM (BaseChatModel).

    Provider selection:
      LLM_PROVIDER=api   → always OpenAI-compatible API
      LLM_PROVIDER=ollama → always Ollama
      LLM_PROVIDER=auto   → probe API once, cache decision

    Args:
        temperature: Generation temperature.
        max_tokens: Max output tokens.
        timeout: Request timeout in seconds.
        model: Model name override (empty = default per provider).
        **kwargs: Extra args (provider-specific, filtered internally).

    Returns:
        BaseChatModel instance (ChatOpenAI or ChatOllama).
    """
    p = _resolve_provider()

    if p == "api":
        return _build_api_llm(temperature, max_tokens, timeout, model, **kwargs)

    # Ollama fallback — also used for crag_graph fallback node
    fallback = kwargs.pop("_fallback", False)
    return _build_ollama_llm(temperature, max_tokens, timeout, model, fallback, **kwargs)


def _resolve_provider() -> str:
    """Determine active provider, cached per process."""
    global _provider
    if _provider is not None:
        return _provider

    mode = settings.LLM_PROVIDER.strip().lower()

    if mode == "ollama":
        _provider = "ollama"
        return _provider

    if mode == "api":
        if not settings.OPENAI_API_KEY:
            logger.warning("LLM_PROVIDER=api but OPENAI_API_KEY empty, falling back to Ollama")
            _provider = "ollama"
        else:
            _provider = "api"
        return _provider

    # auto mode — probe API once
    if not settings.OPENAI_API_KEY:
        _provider = "ollama"
        return _provider

    _provider = "api" if _probe_api() else "ollama"
    return _provider


def get_provider_name() -> str:
    """Return active provider name ('api' or 'ollama')."""
    return _resolve_provider()


def reset_provider_cache() -> None:
    """Force re-probe on next call (useful after config change)."""
    global _provider
    _provider = None


def _probe_api() -> bool:
    """Quick check if API provider is reachable (GET /models, 5s timeout)."""
    import httpx

    try:
        base = settings.OPENAI_BASE_URL.rstrip("/")
        headers = {"Authorization": f"Bearer {settings.OPENAI_API_KEY}"}
        r = httpx.get(f"{base}/models", headers=headers, timeout=5)
        ok = 200 <= r.status_code < 300
        if ok:
            logger.info("api_provider_available", base=base)
        else:
            logger.warning("api_provider_unreachable", status=r.status_code, base=base)
        return ok
    except Exception as e:
        logger.warning("api_probe_failed", error=str(e))
        return False


def _build_api_llm(
    temperature: float | None,
    max_tokens: int | None,
    timeout: int | None,
    model: str,
    **kwargs: Any,
) -> Any:
    """Build ChatOpenAI instance."""
    from langchain_openai import ChatOpenAI

    # Strip Ollama-specific kwargs
    for k in ("num_predict", "num_ctx", "top_k", "streaming", "_fallback"):
        kwargs.pop(k, None)

    # OpenRouter attribution headers
    default_headers: dict[str, str] = {}
    if "openrouter" in settings.OPENAI_BASE_URL.lower():
        default_headers["HTTP-Referer"] = "https://truthlens.ai"
        default_headers["X-Title"] = "TruthLens AI"

    return ChatOpenAI(
        model=model or settings.OPENAI_MODEL,
        temperature=temperature if temperature is not None else settings.OLLAMA_TEMPERATURE,
        max_tokens=max_tokens if max_tokens is not None else settings.OLLAMA_MAX_TOKENS,
        timeout=timeout if timeout is not None else settings.OPENAI_TIMEOUT,
        openai_api_key=settings.OPENAI_API_KEY,
        openai_api_base=settings.OPENAI_BASE_URL or None,
        default_headers=default_headers or None,
        **kwargs,
    )


def _build_ollama_llm(
    temperature: float | None,
    max_tokens: int | None,
    timeout: int | None,
    model: str,
    fallback: bool = False,
    **kwargs: Any,
) -> Any:
    """Build ChatOllama instance."""
    from langchain_ollama import ChatOllama

    # Strip API-specific kwargs
    kwargs.pop("streaming", None)
    kwargs.pop("_fallback", None)

    actual_model = model or (settings.OLLAMA_FALLBACK_MODEL if fallback else settings.OLLAMA_PRIMARY_MODEL)

    return ChatOllama(
        model=actual_model,
        base_url=settings.OLLAMA_BASE_URL,
        temperature=temperature if temperature is not None else settings.OLLAMA_TEMPERATURE,
        num_predict=max_tokens if max_tokens is not None else settings.OLLAMA_MAX_TOKENS,
        timeout=timeout if timeout is not None else settings.OLLAMA_TIMEOUT,
        **kwargs,
    )
