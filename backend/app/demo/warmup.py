"""Background warmup: loads the embedder/reranker/NLI models and pings Ollama
with keep_alive, so the first *real* user query isn't the one paying model
cold-start latency. Runs from `main.py`'s lifespan when DEMO_MODE or
DEMO_WARMUP is set; never blocks startup and never crashes when a model or
Ollama itself is unavailable.
"""

from __future__ import annotations

import asyncio

from app.config import settings
from app.utils.logger import logger

ModelState = str  # "cold" | "loading" | "warm" | "error"

_state: dict[str, ModelState] = {
    "embedder": "cold",
    "reranker": "cold",
    "nli": "cold",
}

_warmup_task: asyncio.Task | None = None


def get_state() -> dict[str, ModelState]:
    """Return a snapshot of each model's warmup state."""
    return dict(_state)


def is_warm() -> bool:
    """True once every tracked model has finished loading successfully."""
    return all(v == "warm" for v in _state.values())


def _load_embedder() -> None:
    from app.ingestion.embedder import _load_model

    _load_model()


def _load_reranker() -> None:
    from app.retrieval.reranker import _load_reranker as _load

    _load()


def _load_nli() -> None:
    from app.generation.guardrail import _load_nli_model

    _load_nli_model()


async def _warm_one(name: str, loader) -> None:
    _state[name] = "loading"
    try:
        await asyncio.to_thread(loader)
        _state[name] = "warm"
        logger.info("demo_warmup_model_ready", model=name)
    except Exception as e:
        _state[name] = "error"
        logger.warning("demo_warmup_model_failed", model=name, error=str(e))


async def _warm_ollama() -> None:
    """One tiny generate call so Ollama loads the primary model into memory
    and keeps it resident for `OLLAMA_KEEP_ALIVE`. Never raises — a down or
    slow Ollama must not break startup or the rest of warmup."""
    try:
        from app.generation.provider import get_chat_llm

        llm = get_chat_llm(max_tokens=8, timeout=30)
        await asyncio.wait_for(asyncio.to_thread(llm.invoke, "Hi"), timeout=35)
        logger.info("demo_warmup_ollama_ready", model=settings.OLLAMA_PRIMARY_MODEL)
    except Exception as e:
        logger.warning("demo_warmup_ollama_failed", error=str(e))


async def _run() -> None:
    await asyncio.gather(
        _warm_one("embedder", _load_embedder),
        _warm_one("reranker", _load_reranker),
        _warm_one("nli", _load_nli),
    )
    await _warm_ollama()


def start_warmup() -> asyncio.Task | None:
    """Start the background warmup task if DEMO_MODE or DEMO_WARMUP is set.

    Returns the tracked task (or None if warmup is disabled) so the lifespan
    can hold a reference and avoid it being garbage-collected mid-flight.
    """
    global _warmup_task
    if not (settings.DEMO_MODE or settings.DEMO_WARMUP):
        return None
    _warmup_task = asyncio.create_task(_run())
    return _warmup_task
