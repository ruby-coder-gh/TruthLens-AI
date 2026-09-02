"""In-memory registry of WebSocket stream buffers (reconnect / resume support).

Every outbound frame of a `/ws/query` stream is written through a `StreamSink`
which stamps it with a monotonic, gapless, 1-based `seq` and appends it to a
per-query `StreamBuffer` before attempting delivery. Two properties fall out of
that:

* **Detachable delivery** — if the socket dies mid-stream the send fails, the
  sink silently detaches and the pipeline keeps running to completion (so the
  answer is still persisted) instead of being cancelled.
* **Resume** — a reconnecting client sends `{"type": "resume", "payload":
  {"query_id", "last_seq"}}`; the registry replays every buffered frame with
  `seq > last_seq` on the new socket and, if the stream is still running,
  re-attaches the sink so subsequent frames go to the new socket too.

Buffers are bounded (`WS_RESUME_MAX_BUFFERS`) and swept on every registry access:
finished buffers expire `WS_RESUME_TTL_SECONDS` after their last frame, and any
buffer older than `MAX_BUFFER_AGE_SECONDS` is dropped regardless of state.

This state is per-process and deliberately in-memory: a resume only works
against the worker that ran the query, and an expired/unknown `query_id` yields
`RESUME_UNAVAILABLE` so the client can simply re-send the query.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from app.config import settings
from app.utils.logger import logger

# An async callable that puts one JSON frame on the wire (`WebSocket.send_json`).
SendJson = Callable[[dict[str, Any]], Awaitable[None]]

AuthorizeHook = Callable[["StreamBuffer"], Awaitable[bool]]

# Hard ceiling: no buffer outlives this, even one whose stream never finished.
MAX_BUFFER_AGE_SECONDS = 600

# Wire code returned to the client when a stream cannot be resumed.
RESUME_UNAVAILABLE = "RESUME_UNAVAILABLE"


@dataclass
class StreamBuffer:
    """Replay buffer for a single query stream."""

    query_id: str
    user_id: str | None = None
    workspace_id: str | None = None
    frames: list[dict[str, Any]] = field(default_factory=list)
    done: bool = False
    created_at: float = field(default_factory=time.time)
    last_activity: float = field(default_factory=time.time)
    # Set by the WS handler after `asyncio.create_task`, so a client that
    # resumes on a new connection can still cancel the running pipeline (and so
    # the loop keeps a strong reference to the orphaned task).
    task: asyncio.Task[None] | None = field(default=None, repr=False, compare=False)
    sink: StreamSink | None = field(default=None, repr=False, compare=False)

    def next_seq(self) -> int:
        return len(self.frames) + 1


class StreamSink:
    """Frame writer for one query: assigns `seq`, buffers, then tries to send.

    Callers emit with a single call — `await sink.emit(type, payload)` — or pass
    `sink.send` anywhere a raw `send_json`-style callable is expected (e.g. to
    `stream_tokens`). Delivery failures never propagate: they detach the sink.
    """

    def __init__(self, buffer: StreamBuffer, send: SendJson | None = None) -> None:
        self._buffer = buffer
        self._send = send
        self._lock = asyncio.Lock()
        buffer.sink = self

    @property
    def buffer(self) -> StreamBuffer:
        return self._buffer

    @property
    def query_id(self) -> str:
        return self._buffer.query_id

    @property
    def attached(self) -> bool:
        return self._send is not None

    def attach(self, send: SendJson) -> None:
        """Point the sink at a (new) live socket."""
        self._send = send

    def detach(self, send: SendJson | None = None) -> None:
        """Stop delivering frames.

        When `send` is given the sink only detaches if that is still the current
        target, so a stale connection tearing down cannot unhook the socket that
        resumed the stream in the meantime.
        """
        if send is None or self._send is send:
            self._send = None

    def mark_done(self) -> None:
        """Mark the stream finished; the buffer stays replayable for the TTL."""
        self._buffer.done = True
        self._buffer.last_activity = time.time()

    async def emit(self, type: str, payload: dict[str, Any]) -> None:
        """Emit one frame. The single entry point for pipeline code."""
        await self.send({"type": type, "payload": payload})

    async def send(self, message: dict[str, Any]) -> None:
        """Stamp `seq` onto a `{type, payload}` message, buffer it, deliver it."""
        async with self._lock:
            frame = dict(message)
            frame["seq"] = self._buffer.next_seq()
            self._buffer.frames.append(frame)
            self._buffer.last_activity = time.time()
            await self._deliver(frame)

    async def replay(self, send: SendJson, last_seq: int) -> tuple[int, bool]:
        """Replay frames after `last_seq`, then re-attach if still streaming.

        Held under the sink lock so a concurrent `emit` cannot interleave with
        the replay or slip a frame onto the old socket after the handover.
        Returns `(frames_replayed, attached)`.
        """
        async with self._lock:
            pending = [f for f in self._buffer.frames if int(f.get("seq", 0)) > last_seq]
            replayed = 0
            for frame in pending:
                try:
                    await send(frame)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    logger.info(
                        "ws_resume_replay_failed",
                        query_id=self._buffer.query_id,
                        replayed=replayed,
                        error=str(exc),
                    )
                    return replayed, False
                replayed += 1

            if self._buffer.done:
                return replayed, False

            self._send = send
            return replayed, True

    async def _deliver(self, frame: dict[str, Any]) -> None:
        send = self._send
        if send is None:
            return
        try:
            await send(frame)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # The socket is gone. Keep buffering so a reconnect can catch up.
            self._send = None
            logger.info(
                "ws_sink_detached",
                query_id=self._buffer.query_id,
                seq=frame.get("seq"),
                error=str(exc),
            )


@dataclass
class ResumeResult:
    """Outcome of a `resume` attempt."""

    ok: bool
    replayed: int = 0
    live: bool = False
    reason: str | None = None


class StreamRegistry:
    """Bounded, self-sweeping `query_id -> StreamBuffer` map."""

    def __init__(self, *, ttl_seconds: int | None = None, max_buffers: int | None = None) -> None:
        self._buffers: dict[str, StreamBuffer] = {}
        self._ttl_seconds = ttl_seconds
        self._max_buffers = max_buffers
        self._lock: asyncio.Lock | None = None
        self._lock_loop: asyncio.AbstractEventLoop | None = None

    @property
    def ttl_seconds(self) -> int:
        return self._ttl_seconds if self._ttl_seconds is not None else settings.WS_RESUME_TTL_SECONDS

    @property
    def max_buffers(self) -> int:
        return self._max_buffers if self._max_buffers is not None else settings.WS_RESUME_MAX_BUFFERS

    @property
    def size(self) -> int:
        return len(self._buffers)

    async def create(
        self,
        query_id: str,
        user_id: str | None,
        workspace_id: str | None,
        send: SendJson | None = None,
    ) -> StreamSink:
        """Register a buffer for `query_id` and return its sink."""
        buffer = StreamBuffer(query_id=query_id, user_id=user_id, workspace_id=workspace_id)
        sink = StreamSink(buffer, send)
        async with self._get_lock():
            self._sweep_locked()
            self._buffers[query_id] = buffer
            self._enforce_bounds_locked()
        return sink

    async def get(self, query_id: str) -> StreamBuffer | None:
        async with self._get_lock():
            self._sweep_locked()
            return self._buffers.get(query_id)

    async def drop(self, query_id: str) -> bool:
        """Forget a stream (explicit `cancel`, or a superseded query)."""
        async with self._get_lock():
            return self._buffers.pop(query_id, None) is not None

    async def sweep(self) -> int:
        """Expire stale buffers. Returns how many were dropped."""
        async with self._get_lock():
            return self._sweep_locked()

    async def resume(
        self,
        query_id: str,
        user_id: str | None,
        last_seq: int,
        send: SendJson,
        authorize: AuthorizeHook | None = None,
    ) -> ResumeResult:
        """Replay `seq > last_seq` on `send` and re-attach if still streaming.

        `reason` is for server-side logging only — every failure maps to the same
        `RESUME_UNAVAILABLE` wire code so a caller cannot probe which query ids
        exist.
        """
        async with self._get_lock():
            self._sweep_locked()
            buffer = self._buffers.get(query_id)
            if buffer is None:
                return ResumeResult(ok=False, reason="unknown_query")
            if buffer.user_id != user_id:
                logger.warning(
                    "ws_resume_owner_mismatch", query_id=query_id, user_id=user_id
                )
                return ResumeResult(ok=False, reason="owner_mismatch")

        if authorize is not None and not await authorize(buffer):
            logger.warning(
                "ws_resume_forbidden",
                query_id=query_id,
                user_id=user_id,
                workspace_id=buffer.workspace_id,
            )
            return ResumeResult(ok=False, reason="forbidden")

        sink = buffer.sink
        if sink is None:  # pragma: no cover - a buffer always has its sink
            return ResumeResult(ok=False, reason="unknown_query")

        try:
            last_seq = int(last_seq)
        except (TypeError, ValueError):
            last_seq = 0
        last_seq = max(0, last_seq)

        replayed, live = await sink.replay(send, last_seq)
        logger.info(
            "ws_resume",
            query_id=query_id,
            user_id=user_id,
            last_seq=last_seq,
            replayed=replayed,
            live=live,
        )
        return ResumeResult(ok=True, replayed=replayed, live=live)

    # ─── internals ────────────────────────────────────────────────────────────

    def _get_lock(self) -> asyncio.Lock:
        """Return a lock bound to the running loop.

        The registry is a module-level singleton, but `asyncio.Lock` binds to the
        first loop that contends on it and then refuses any other. Production has
        one loop; tests have one per test. Re-creating the lock when the loop
        changes keeps mutual exclusion where it matters (within a loop) without
        leaking a dead binding across loops.
        """
        loop = asyncio.get_running_loop()
        if self._lock is None or self._lock_loop is not loop:
            self._lock = asyncio.Lock()
            self._lock_loop = loop
        return self._lock

    def _sweep_locked(self) -> int:
        now = time.time()
        ttl = self.ttl_seconds
        expired = [
            query_id
            for query_id, buffer in self._buffers.items()
            if (buffer.done and now - buffer.last_activity > ttl)
            or now - buffer.created_at > MAX_BUFFER_AGE_SECONDS
        ]
        for query_id in expired:
            del self._buffers[query_id]
        if expired:
            logger.debug("ws_stream_buffers_swept", count=len(expired))
        return len(expired)

    def _enforce_bounds_locked(self) -> None:
        """Evict until under `max_buffers`, finished buffers first, oldest first."""
        max_buffers = max(1, self.max_buffers)
        while len(self._buffers) > max_buffers:
            victim = next(
                (query_id for query_id, buffer in self._buffers.items() if buffer.done),
                next(iter(self._buffers)),
            )
            del self._buffers[victim]
            logger.info("ws_stream_buffer_evicted", query_id=victim)


# Process-wide registry used by the WebSocket handlers.
stream_registry = StreamRegistry()
