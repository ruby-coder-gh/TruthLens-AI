"""Tests for the WebSocket stream registry: seq frames, detach, resume."""

from __future__ import annotations

import asyncio
import sys
import time
import types
from types import SimpleNamespace
from typing import Any

import pytest


# ─── Helpers ──────────────────────────────────────────────────────────────────


class Recorder:
    """Fake `send_json` that records frames and can fail like a dead socket."""

    def __init__(self, fail_after: int | None = None) -> None:
        self.frames: list[dict[str, Any]] = []
        self.fail_after = fail_after
        self.failures = 0

    async def __call__(self, message: dict[str, Any]) -> None:
        if self.fail_after is not None and len(self.frames) >= self.fail_after:
            self.failures += 1
            raise RuntimeError('Cannot call "send" once a close message has been sent.')
        self.frames.append(message)

    @property
    def types(self) -> list[str]:
        return [f.get("type") for f in self.frames]

    @property
    def seqs(self) -> list[int]:
        return [f["seq"] for f in self.frames if "seq" in f]


def _patch_pipeline_steps(
    monkeypatch: pytest.MonkeyPatch,
    captured: dict[str, Any],
    *,
    stream_tokens: Any = None,
) -> None:
    """Monkeypatch every external step `_run_query_pipeline` imports.

    Mirrors the module-substitution pattern in `tests/test_api/test_ws.py`.
    """
    from app.api import ws as ws_api

    async def fake_rewrite(query: str) -> str:
        return query

    async def fake_hybrid_search(query: str, workspace_id: str, top_k: int, filters=None):
        return [_fake_result()]

    async def fake_rerank(query: str, results, top_k: int):
        return [_fake_result()]

    async def default_stream_tokens(gen_input, query_id: str, send_fn):
        await send_fn({"type": "token", "payload": {"query_id": query_id, "token": "ok", "index": 0}})
        await send_fn({"type": "stream_end", "payload": {"query_id": query_id}})
        return "final answer", 1, "mock-model"

    async def fake_guardrail_check(answer: str, contexts):
        return SimpleNamespace(passed=True, score=0.95, details="ok")

    async def fake_compute_trust(*args, **kwargs):
        return SimpleNamespace(
            overall=0.9,
            retrieval_quality=0.9,
            faithfulness=0.95,
            relevance=0.9,
            source_authority=0.8,
        )

    async def fake_save_query(**kwargs):
        captured["saved"] = kwargs

    async def fake_document_version(*args, **kwargs):
        return 0

    async def fake_cache_lookup(*args, **kwargs):
        return captured.get("cached_query")

    _install_module(monkeypatch, "app.retrieval.query_rewrite", rewrite=fake_rewrite)
    _install_module(monkeypatch, "app.retrieval.hybrid_search", hybrid_search=fake_hybrid_search)
    _install_module(monkeypatch, "app.retrieval.reranker", rerank=fake_rerank)
    _install_module(
        monkeypatch,
        "app.generation.streamer",
        stream_tokens=stream_tokens or default_stream_tokens,
    )
    _install_module(monkeypatch, "app.generation.guardrail", check=fake_guardrail_check)
    _install_module(monkeypatch, "app.evaluation.trust_score", compute_trust=fake_compute_trust)

    monkeypatch.setattr(ws_api, "_save_query", fake_save_query)
    monkeypatch.setattr(ws_api, "get_workspace_document_version", fake_document_version)
    monkeypatch.setattr(ws_api, "lookup_cached_query", fake_cache_lookup)


def _install_module(monkeypatch: pytest.MonkeyPatch, name: str, **attrs: Any) -> None:
    module = types.ModuleType(name)
    for key, value in attrs.items():
        setattr(module, key, value)
    monkeypatch.setitem(sys.modules, name, module)


def _fake_result() -> SimpleNamespace:
    return SimpleNamespace(
        chunk_id="chunk-1",
        document_id="doc-1",
        content="source content",
        score=0.9,
        final_score=0.9,
        rerank_score=0.9,
        metadata={"document_name": "Doc 1"},
    )


async def _new_sink(registry, recorder, *, query_id="q-1", user_id="user-1", workspace_id="ws-1"):
    return await registry.create(
        query_id=query_id,
        user_id=user_id,
        workspace_id=workspace_id,
        send=recorder,
    )


@pytest.fixture
def registry():
    from app.api.stream_registry import StreamRegistry

    return StreamRegistry()


# ─── seq numbering ────────────────────────────────────────────────────────────


class TestSeqNumbering:
    async def test_pipeline_frames_carry_monotonic_seq(self, monkeypatch, registry):
        """Every outbound frame gets a top-level, gapless, 1-based `seq`."""
        from app.api import ws as ws_api

        captured: dict[str, Any] = {}
        _patch_pipeline_steps(monkeypatch, captured)
        recorder = Recorder()
        sink = await _new_sink(registry, recorder)

        await ws_api._run_query_pipeline(
            query_text="What is the policy?",
            workspace_id="ws-1",
            user_id="user-1",
            query_id="q-1",
            top_k=5,
            filters=None,
            sink=sink,
        )

        assert recorder.frames, "pipeline sent no frames"
        assert all("seq" in frame for frame in recorder.frames)
        assert recorder.seqs == list(range(1, len(recorder.frames) + 1))
        assert "complete" in recorder.types
        assert sink.buffer.frames == recorder.frames

    async def test_cached_replay_frames_carry_seq(self, registry):
        """Cache replay goes through the same sink so `seq` is uniform."""
        from app.api import ws as ws_api

        recorder = Recorder()
        sink = await _new_sink(registry, recorder)
        cached = SimpleNamespace(
            id="q-1",
            response_text="cached answer",
            response_sources="[]",
            guardrail_score=0.9,
            guardrail_passed=True,
            trust_score=0.8,
            model_used="mock-model",
            token_count=3,
        )

        await ws_api._send_cached_query(cached, sink, 12)

        assert recorder.seqs == list(range(1, len(recorder.frames) + 1))
        assert recorder.types == ["ack", "sources", "token", "guardrail", "trust_score", "complete"]
        assert recorder.frames[-1]["payload"]["from_cache"] is True

    async def test_seq_continues_across_emit_and_send(self, registry):
        """`emit(type, payload)` and `send(message)` share one counter."""
        recorder = Recorder()
        sink = await _new_sink(registry, recorder)

        await sink.emit("ack", {"query_id": "q-1"})
        await sink.send({"type": "token", "payload": {"query_id": "q-1", "token": "a", "index": 0}})
        await sink.emit("complete", {"query_id": "q-1"})

        assert recorder.seqs == [1, 2, 3]


# ─── detach ───────────────────────────────────────────────────────────────────


class TestDetach:
    async def test_send_failure_detaches_and_pipeline_still_completes(self, monkeypatch, registry):
        """A dead socket detaches the sink; the pipeline finishes and persists."""
        from app.api import ws as ws_api

        captured: dict[str, Any] = {}
        _patch_pipeline_steps(monkeypatch, captured)
        recorder = Recorder(fail_after=2)
        sink = await _new_sink(registry, recorder)

        await ws_api._run_query_pipeline(
            query_text="What is the policy?",
            workspace_id="ws-1",
            user_id="user-1",
            query_id="q-1",
            top_k=5,
            filters=None,
            sink=sink,
        )

        assert sink.attached is False
        assert len(recorder.frames) == 2
        assert recorder.failures == 1, "sink must stop sending after the first failure"
        assert "complete" in [f["type"] for f in sink.buffer.frames]
        assert captured["saved"]["query_text"] == "What is the policy?"
        assert sink.buffer.done is True

    async def test_cancelled_pipeline_routes_error_frame_through_sink(self, monkeypatch, registry):
        """CANCELLED frame goes through the sink, never raw `send_json` on a dead socket."""
        from app.api import ws as ws_api

        async def cancelling_stream_tokens(gen_input, query_id: str, send_fn):
            raise asyncio.CancelledError()

        captured: dict[str, Any] = {}
        _patch_pipeline_steps(monkeypatch, captured, stream_tokens=cancelling_stream_tokens)
        recorder = Recorder(fail_after=0)  # socket already closed
        sink = await _new_sink(registry, recorder)

        await ws_api._run_query_pipeline(
            query_text="What is the policy?",
            workspace_id="ws-1",
            user_id="user-1",
            query_id="q-1",
            top_k=5,
            filters=None,
            sink=sink,
        )

        last = sink.buffer.frames[-1]
        assert last["type"] == "error"
        assert last["payload"]["code"] == "CANCELLED"
        assert last["payload"]["query_id"] == "q-1"
        assert recorder.failures == 1
        assert sink.attached is False

    async def test_detach_only_releases_the_matching_socket(self, registry):
        """Detaching with a stale send target must not unhook a newer socket."""
        first = Recorder()
        second = Recorder()
        sink = await _new_sink(registry, first)

        sink.attach(second)
        sink.detach(first)  # the old connection tearing down

        await sink.emit("token", {"query_id": "q-1"})
        assert second.types == ["token"]

        sink.detach(second)
        assert sink.attached is False


# ─── resume ───────────────────────────────────────────────────────────────────


class TestResume:
    async def test_replays_only_frames_after_last_seq(self, registry):
        from app.api.stream_registry import StreamRegistry  # noqa: F401

        original = Recorder()
        sink = await _new_sink(registry, original)
        for i in range(4):
            await sink.emit("token", {"query_id": "q-1", "index": i})

        reconnect = Recorder()
        result = await registry.resume(
            query_id="q-1", user_id="user-1", last_seq=2, send=reconnect
        )

        assert result.ok is True
        assert result.replayed == 2
        assert reconnect.seqs == [3, 4]

    async def test_reattaches_live_sink_so_new_frames_reach_new_socket(self, registry):
        original = Recorder()
        sink = await _new_sink(registry, original)
        await sink.emit("ack", {"query_id": "q-1"})
        sink.detach()

        reconnect = Recorder()
        result = await registry.resume(
            query_id="q-1", user_id="user-1", last_seq=0, send=reconnect
        )
        await sink.emit("complete", {"query_id": "q-1"})

        assert result.live is True
        assert sink.attached is True
        assert reconnect.types == ["ack", "complete"]
        assert original.types == ["ack"]

    async def test_done_buffer_replays_tail_without_reattaching(self, registry):
        sink = await _new_sink(registry, Recorder())
        await sink.emit("ack", {"query_id": "q-1"})
        await sink.emit("complete", {"query_id": "q-1"})
        sink.mark_done()
        sink.detach()  # original socket dropped

        reconnect = Recorder()
        result = await registry.resume(
            query_id="q-1", user_id="user-1", last_seq=1, send=reconnect
        )

        assert result.ok is True
        assert result.live is False
        assert reconnect.types == ["complete"]
        assert sink.attached is False

    async def test_unknown_query_id_is_unavailable(self, registry):
        reconnect = Recorder()
        result = await registry.resume(
            query_id="nope", user_id="user-1", last_seq=0, send=reconnect
        )

        assert result.ok is False
        assert result.reason == "unknown_query"
        assert reconnect.frames == []

    async def test_wrong_user_is_unavailable_and_replays_nothing(self, registry):
        sink = await _new_sink(registry, Recorder())
        await sink.emit("ack", {"query_id": "q-1"})

        attacker = Recorder()
        result = await registry.resume(
            query_id="q-1", user_id="mallory", last_seq=0, send=attacker
        )

        assert result.ok is False
        assert result.reason == "owner_mismatch"
        assert attacker.frames == []
        assert sink.attached is True, "a rejected resume must not steal the live socket"

    async def test_authorize_hook_can_deny_resume(self, registry):
        sink = await _new_sink(registry, Recorder())
        await sink.emit("ack", {"query_id": "q-1"})

        async def deny(buffer) -> bool:
            assert buffer.workspace_id == "ws-1"
            return False

        reconnect = Recorder()
        result = await registry.resume(
            query_id="q-1", user_id="user-1", last_seq=0, send=reconnect, authorize=deny
        )

        assert result.ok is False
        assert result.reason == "forbidden"
        assert reconnect.frames == []

    async def test_resume_survives_a_second_dead_socket(self, registry):
        """If the reconnecting socket also dies mid-replay, nothing raises."""
        sink = await _new_sink(registry, Recorder())
        await sink.emit("ack", {"query_id": "q-1"})
        await sink.emit("token", {"query_id": "q-1"})
        sink.detach()  # first socket dropped

        dead = Recorder(fail_after=1)
        result = await registry.resume(
            query_id="q-1", user_id="user-1", last_seq=0, send=dead
        )

        assert result.ok is True
        assert result.live is False
        assert sink.attached is False


# ─── sweep / bounds / drop ────────────────────────────────────────────────────


class TestSweepAndBounds:
    async def test_drops_done_buffers_past_ttl(self, registry):
        from app.api.stream_registry import StreamRegistry

        registry = StreamRegistry(ttl_seconds=60)
        sink = await _new_sink(registry, Recorder())
        sink.mark_done()
        sink.buffer.last_activity = time.time() - 61

        dropped = await registry.sweep()

        assert dropped == 1
        assert await registry.get("q-1") is None

    async def test_keeps_done_buffer_inside_ttl(self, registry):
        from app.api.stream_registry import StreamRegistry

        registry = StreamRegistry(ttl_seconds=60)
        sink = await _new_sink(registry, Recorder())
        sink.mark_done()
        sink.buffer.last_activity = time.time() - 5

        assert await registry.sweep() == 0
        assert await registry.get("q-1") is not None

    async def test_keeps_active_buffer_past_ttl(self, registry):
        """A still-running stream is not swept just because it is slow."""
        from app.api.stream_registry import StreamRegistry

        registry = StreamRegistry(ttl_seconds=1)
        sink = await _new_sink(registry, Recorder())
        sink.buffer.last_activity = time.time() - 300

        assert await registry.sweep() == 0
        assert await registry.get("q-1") is not None

    async def test_drops_buffers_older_than_max_age(self, registry):
        from app.api.stream_registry import stream_registry as _singleton  # noqa: F401
        from app.api.stream_registry import MAX_BUFFER_AGE_SECONDS

        sink = await _new_sink(registry, Recorder())
        sink.buffer.created_at = time.time() - (MAX_BUFFER_AGE_SECONDS + 1)

        assert await registry.sweep() == 1
        assert await registry.get("q-1") is None

    async def test_evicts_oldest_when_over_max_buffers(self):
        from app.api.stream_registry import StreamRegistry

        registry = StreamRegistry(max_buffers=3)
        for i in range(5):
            await _new_sink(registry, Recorder(), query_id=f"q-{i}")

        assert registry.size == 3
        assert await registry.get("q-0") is None
        assert await registry.get("q-1") is None
        assert await registry.get("q-4") is not None

    async def test_eviction_prefers_finished_buffers(self):
        from app.api.stream_registry import StreamRegistry

        registry = StreamRegistry(max_buffers=2)
        live = await _new_sink(registry, Recorder(), query_id="live")
        finished = await _new_sink(registry, Recorder(), query_id="finished")
        finished.mark_done()

        await _new_sink(registry, Recorder(), query_id="newest")

        assert registry.size == 2
        assert await registry.get("finished") is None
        assert await registry.get("live") is not None
        assert live.buffer.done is False

    async def test_drop_makes_resume_unavailable(self, registry):
        sink = await _new_sink(registry, Recorder())
        await sink.emit("ack", {"query_id": "q-1"})

        assert await registry.drop("q-1") is True

        result = await registry.resume(
            query_id="q-1", user_id="user-1", last_seq=0, send=Recorder()
        )
        assert result.ok is False
        assert result.reason == "unknown_query"

    async def test_ttl_and_bounds_default_to_settings(self):
        from app.api.stream_registry import StreamRegistry
        from app.config import settings

        registry = StreamRegistry()

        assert registry.ttl_seconds == settings.WS_RESUME_TTL_SECONDS
        assert registry.max_buffers == settings.WS_RESUME_MAX_BUFFERS


# ─── /ws/query handshake + opcodes ────────────────────────────────────────────


class FakeWebSocket:
    """Minimal in-loop stand-in for Starlette's WebSocket.

    The repo's `client` fixture is an httpx `AsyncClient`, which has no
    `websocket_connect`; Starlette's `TestClient` would run the app in a second
    event loop (incompatible with the async test engine/session fixtures). Driving
    `websocket_query` with this fake keeps the handshake test in one event loop.
    """

    DISCONNECT = object()
    FAIL = object()

    def __init__(self, cookies: dict[str, str] | None = None) -> None:
        self.cookies = cookies or {}
        self.sent: list[dict[str, Any]] = []
        self.accepted = False
        self.closed_code: int | None = None
        self.dead = False
        self._incoming: asyncio.Queue[Any] = asyncio.Queue()
        self._frame = asyncio.Event()

    # -- server side --------------------------------------------------------
    async def accept(self) -> None:
        self.accepted = True

    async def receive_text(self) -> str:
        from fastapi import WebSocketDisconnect

        item = await self._incoming.get()
        if item is self.DISCONNECT:
            raise WebSocketDisconnect(1006)
        if item is self.FAIL:
            raise RuntimeError("transport blew up")
        return str(item)

    async def send_json(self, message: dict[str, Any]) -> None:
        if self.dead:
            raise RuntimeError('Cannot call "send" once a close message has been sent.')
        self.sent.append(message)
        self._frame.set()

    async def close(self, code: int = 1000) -> None:
        self.closed_code = code

    # -- client side --------------------------------------------------------
    def push(self, message: dict[str, Any]) -> None:
        import json

        self._incoming.put_nowait(json.dumps(message))

    def disconnect(self) -> None:
        self._incoming.put_nowait(self.DISCONNECT)

    def fail(self) -> None:
        self._incoming.put_nowait(self.FAIL)

    async def wait_for(self, frame_type: str, *, start: int = 0, timeout: float = 2.0):
        async def _wait():
            while True:
                for frame in self.sent[start:]:
                    if frame.get("type") == frame_type:
                        return frame
                self._frame.clear()
                await self._frame.wait()

        return await asyncio.wait_for(_wait(), timeout)

    def frames(self, frame_type: str) -> list[dict[str, Any]]:
        return [f for f in self.sent if f.get("type") == frame_type]


@pytest.fixture
def ws_harness(monkeypatch):
    """Patch auth/workspace/pipeline so `websocket_query` can be driven directly."""
    from app.api import ws as ws_api
    from app.api.stream_registry import StreamRegistry

    registry = StreamRegistry()
    monkeypatch.setattr(ws_api, "stream_registry", registry)

    state: dict[str, Any] = {
        "started": asyncio.Event(),
        "release": asyncio.Event(),
        "cancelled": False,
        "allowed": True,
    }

    async def fake_resolve(token: str) -> str | None:
        return "user-1" if token == "good-token" else None

    async def fake_access(user_id: str, workspace_id: str) -> bool:
        return bool(state["allowed"])

    async def fake_pipeline(*, query_id: str, sink, **kwargs) -> None:
        state["sink"] = sink
        state["query_id"] = query_id
        await sink.emit("ack", {"query_id": query_id, "status": "processing"})
        await sink.emit("token", {"query_id": query_id, "token": "hello", "index": 0})
        state["started"].set()
        try:
            await state["release"].wait()
        except asyncio.CancelledError:
            state["cancelled"] = True
            raise
        await sink.emit(
            "complete",
            {
                "query_id": query_id,
                "latency_ms": 1,
                "model_used": "mock-model",
                "token_count": 1,
                "from_cache": False,
            },
        )
        sink.mark_done()

    monkeypatch.setattr(ws_api, "_resolve_ws_user_id", fake_resolve)
    monkeypatch.setattr(ws_api, "_check_workspace_access", fake_access)
    monkeypatch.setattr(ws_api, "_run_query_pipeline", fake_pipeline)

    state["registry"] = registry
    return state


def _auth_msg() -> dict[str, Any]:
    return {"type": "auth", "token": "good-token"}


def _query_msg() -> dict[str, Any]:
    return {"type": "query", "payload": {"workspace_id": "ws-1", "query": "What is the policy?"}}


async def _connect(ws_harness) -> tuple[FakeWebSocket, asyncio.Task]:
    from app.api import ws as ws_api

    ws = FakeWebSocket()
    task = asyncio.create_task(ws_api.websocket_query(ws))
    ws.push(_auth_msg())
    await ws.wait_for("auth_success")
    return ws, task


class TestWebSocketQueryOpcodes:
    async def test_resume_on_unknown_query_id_returns_resume_unavailable(self, ws_harness):
        ws, task = await _connect(ws_harness)

        ws.push({"type": "resume", "payload": {"query_id": "does-not-exist", "last_seq": 0}})
        error = await ws.wait_for("error")

        assert error["payload"]["code"] == "RESUME_UNAVAILABLE"
        assert error["payload"]["query_id"] == "does-not-exist"
        assert "reason" not in error["payload"], "must not leak whether the id exists"
        assert "seq" not in error, "connection-level frames are not part of a stream"

        ws.disconnect()
        await task

    async def test_resume_without_query_id_is_invalid_input(self, ws_harness):
        ws, task = await _connect(ws_harness)

        ws.push({"type": "resume", "payload": {"last_seq": 3}})
        error = await ws.wait_for("error")

        assert error["payload"]["code"] == "INVALID_INPUT"

        ws.disconnect()
        await task

    async def test_cancel_echo_includes_query_id_and_drops_the_buffer(self, ws_harness):
        ws, task = await _connect(ws_harness)
        ws.push(_query_msg())
        await ws_harness["started"].wait()
        query_id = ws_harness["query_id"]

        ws.push({"type": "cancel"})
        error = await ws.wait_for("error")

        assert error["payload"]["code"] == "CANCELLED"
        assert error["payload"]["query_id"] == query_id
        assert await ws_harness["registry"].get(query_id) is None

        ws.disconnect()
        await task

    async def test_disconnect_detaches_the_sink_instead_of_cancelling(self, ws_harness):
        ws, task = await _connect(ws_harness)
        ws.push(_query_msg())
        await ws_harness["started"].wait()
        query_id = ws_harness["query_id"]

        ws.disconnect()
        await task

        buffer = await ws_harness["registry"].get(query_id)
        assert buffer is not None, "the buffer survives the disconnect"
        assert buffer.sink.attached is False
        assert ws_harness["cancelled"] is False
        assert buffer.task is not None and not buffer.task.done()

        # the pipeline finishes on its own, with nobody listening
        ws_harness["release"].set()
        await buffer.task
        assert buffer.done is True
        assert [f["type"] for f in buffer.frames][-1] == "complete"

    async def test_reconnect_resumes_the_stream_on_a_new_socket(self, ws_harness):
        """auth_success -> resume -> replay of seq > last_seq -> live frames."""
        ws_a, task_a = await _connect(ws_harness)
        ws_a.push(_query_msg())
        await ws_harness["started"].wait()
        query_id = ws_harness["query_id"]

        assert [f["type"] for f in ws_a.sent] == ["auth_success", "ack", "token"]
        assert ws_a.sent[1]["seq"] == 1
        assert ws_a.sent[2]["seq"] == 2

        ws_a.disconnect()
        await task_a

        ws_b, task_b = await _connect(ws_harness)
        ws_b.push({"type": "resume", "payload": {"query_id": query_id, "last_seq": 1}})
        resumed = await ws_b.wait_for("resumed")

        assert resumed["payload"] == {
            "query_id": query_id,
            "from_seq": 1,
            "replayed": 1,
            "live": True,
        }
        assert [f["type"] for f in ws_b.sent] == ["auth_success", "token", "resumed"]
        assert ws_b.sent[1]["seq"] == 2, "replays the frame the client missed"

        ws_harness["release"].set()
        complete = await ws_b.wait_for("complete")
        assert complete["seq"] == 3, "live frames continue the same seq run"

        ws_b.disconnect()
        await task_b

    async def test_resume_of_another_users_stream_is_unavailable(self, ws_harness, monkeypatch):
        from app.api import ws as ws_api

        ws_a, task_a = await _connect(ws_harness)
        ws_a.push(_query_msg())
        await ws_harness["started"].wait()
        query_id = ws_harness["query_id"]
        ws_a.disconnect()
        await task_a

        async def other_user(token: str) -> str | None:
            return "mallory"

        monkeypatch.setattr(ws_api, "_resolve_ws_user_id", other_user)
        ws_b, task_b = await _connect(ws_harness)
        ws_b.push({"type": "resume", "payload": {"query_id": query_id, "last_seq": 0}})
        error = await ws_b.wait_for("error")

        assert error["payload"]["code"] == "RESUME_UNAVAILABLE"
        assert ws_b.frames("token") == [], "no frames leaked to the wrong user"

        ws_b.disconnect()
        await task_b
        ws_harness["release"].set()
        await ws_harness["sink"].buffer.task

    async def test_resume_requires_current_workspace_access(self, ws_harness):
        ws_a, task_a = await _connect(ws_harness)
        ws_a.push(_query_msg())
        await ws_harness["started"].wait()
        query_id = ws_harness["query_id"]
        ws_a.disconnect()
        await task_a

        ws_harness["allowed"] = False  # membership revoked while disconnected

        ws_b, task_b = await _connect(ws_harness)
        ws_b.push({"type": "resume", "payload": {"query_id": query_id, "last_seq": 0}})
        error = await ws_b.wait_for("error")

        assert error["payload"]["code"] == "RESUME_UNAVAILABLE"
        assert ws_b.frames("token") == []

        ws_b.disconnect()
        await task_b
        ws_harness["release"].set()
        await ws_harness["sink"].buffer.task

    async def test_connection_error_detaches_the_sink_before_closing(self, ws_harness):
        """A 1011 close must not leave the pipeline writing into a dead socket."""
        ws, task = await _connect(ws_harness)
        ws.push(_query_msg())
        await ws_harness["started"].wait()
        query_id = ws_harness["query_id"]

        ws.fail()
        await task

        buffer = await ws_harness["registry"].get(query_id)
        assert ws.closed_code == 1011
        assert buffer is not None and buffer.sink.attached is False

        ws_harness["release"].set()
        await buffer.task
        assert ws.frames("complete") == [], "no frames delivered after the close"

    async def test_cancel_after_resume_reaches_the_running_pipeline(self, ws_harness):
        """The resumed connection owns the task, so Stop still works."""
        ws_a, task_a = await _connect(ws_harness)
        ws_a.push(_query_msg())
        await ws_harness["started"].wait()
        query_id = ws_harness["query_id"]
        ws_a.disconnect()
        await task_a

        ws_b, task_b = await _connect(ws_harness)
        ws_b.push({"type": "resume", "payload": {"query_id": query_id, "last_seq": 2}})
        await ws_b.wait_for("resumed")

        ws_b.push({"type": "cancel"})
        error = await ws_b.wait_for("error")

        assert error["payload"]["code"] == "CANCELLED"
        assert error["payload"]["query_id"] == query_id
        assert ws_harness["cancelled"] is True

        ws_b.disconnect()
        await task_b
