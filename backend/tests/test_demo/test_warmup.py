"""Tests for app.demo.warmup state transitions."""

from __future__ import annotations

import pytest

from app.demo import warmup


@pytest.fixture(autouse=True)
def _reset_warmup_state():
    """`warmup._state` is process-global — isolate each test."""
    warmup._state = {"embedder": "cold", "reranker": "cold", "nli": "cold"}
    warmup._warmup_task = None
    yield
    warmup._state = {"embedder": "cold", "reranker": "cold", "nli": "cold"}
    warmup._warmup_task = None


def test_get_state_starts_cold():
    assert warmup.get_state() == {"embedder": "cold", "reranker": "cold", "nli": "cold"}
    assert warmup.is_warm() is False


@pytest.mark.asyncio
async def test_run_marks_every_model_warm_on_success(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(warmup, "_load_embedder", lambda: None)
    monkeypatch.setattr(warmup, "_load_reranker", lambda: None)
    monkeypatch.setattr(warmup, "_load_nli", lambda: None)

    async def _noop_ollama():
        return None

    monkeypatch.setattr(warmup, "_warm_ollama", _noop_ollama)

    await warmup._run()

    assert warmup.get_state() == {"embedder": "warm", "reranker": "warm", "nli": "warm"}
    assert warmup.is_warm() is True


@pytest.mark.asyncio
async def test_run_marks_only_the_failing_model_as_error(monkeypatch: pytest.MonkeyPatch):
    def _boom():
        raise RuntimeError("model download failed")

    monkeypatch.setattr(warmup, "_load_embedder", _boom)
    monkeypatch.setattr(warmup, "_load_reranker", lambda: None)
    monkeypatch.setattr(warmup, "_load_nli", lambda: None)

    async def _noop_ollama():
        return None

    monkeypatch.setattr(warmup, "_warm_ollama", _noop_ollama)

    await warmup._run()

    state = warmup.get_state()
    assert state["embedder"] == "error"
    assert state["reranker"] == "warm"
    assert state["nli"] == "warm"
    assert warmup.is_warm() is False


@pytest.mark.asyncio
async def test_warm_ollama_never_raises_when_provider_fails(monkeypatch: pytest.MonkeyPatch):
    """A down/slow Ollama must not break startup."""

    def _raise_get_chat_llm(*args, **kwargs):
        raise RuntimeError("connection refused")

    monkeypatch.setattr("app.generation.provider.get_chat_llm", _raise_get_chat_llm)

    await warmup._warm_ollama()  # must not raise


def test_start_warmup_returns_none_when_disabled(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(warmup.settings, "DEMO_MODE", False)
    monkeypatch.setattr(warmup.settings, "DEMO_WARMUP", False)

    assert warmup.start_warmup() is None


@pytest.mark.asyncio
async def test_start_warmup_creates_a_tracked_task_when_enabled(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(warmup.settings, "DEMO_MODE", False)
    monkeypatch.setattr(warmup.settings, "DEMO_WARMUP", True)

    async def _fast_run():
        warmup._state["embedder"] = "warm"
        warmup._state["reranker"] = "warm"
        warmup._state["nli"] = "warm"

    monkeypatch.setattr(warmup, "_run", _fast_run)

    task = warmup.start_warmup()
    assert task is not None
    await task
    assert warmup.is_warm() is True
