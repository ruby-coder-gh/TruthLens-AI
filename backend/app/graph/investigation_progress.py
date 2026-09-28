"""In-memory progress registry for background investigation runs (BUG-10).

`POST /workspaces/{id}/investigate` returns 202 immediately and runs the
graph in a tracked background task (see `app/api/investigations.py`). The
graph's nodes report step-level progress here as they run; the API's
`/investigations/{id}/progress` route reads it back while the client polls.

Keyed by investigation id. Written from the worker thread `run_investigation`
executes in (via `asyncio.to_thread`) and read from the event loop thread, so
every mutation goes through `_lock`.

# ponytail: unbounded dict for the life of the process, no TTL/eviction (unlike
# `stream_registry`, which bounds itself). A finished entry never gets removed.
# Fine at demo/small-team volume; add a sweep (same idea as
# `stream_registry.sweep`) if this process runs long enough / handles enough
# investigations for it to matter. It's also purely process-local — a restart
# loses in-flight progress (the progress endpoint falls back to whatever the
# DB row already has in that case).
"""

from __future__ import annotations

import threading
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Literal

Status = Literal["running", "done", "failed"]
SubQuestionStatus = Literal["pending", "running", "done"]

# decompose + synthesize + trust_score, before the sub-question count is known.
_BASE_STEPS = 3


@dataclass
class _SubQuestionProgress:
    text: str
    status: SubQuestionStatus = "pending"


@dataclass
class _Progress:
    status: Status = "running"
    step: str = "decompose"
    done_steps: int = 0
    total_steps: int = _BASE_STEPS
    sub_questions: list[_SubQuestionProgress] = field(default_factory=list)
    error: str | None = None
    started_at: float = field(default_factory=time.time)
    # Set once by `finish()`; freezes `elapsed_ms` instead of letting it keep
    # climbing on every later `get()` call for a run that already ended.
    final_latency_ms: int | None = None


_lock = threading.Lock()
_registry: dict[str, _Progress] = {}


def start(investigation_id: str) -> None:
    """Register a new run. Call before the background task is scheduled."""
    with _lock:
        _registry[investigation_id] = _Progress()


def set_sub_questions(investigation_id: str, questions: list[str]) -> None:
    """Record the decomposed sub-questions; marks decompose done."""
    with _lock:
        progress = _registry.get(investigation_id)
        if progress is None:
            return
        progress.sub_questions = [_SubQuestionProgress(text=q) for q in questions]
        progress.total_steps = len(questions) + _BASE_STEPS
        progress.done_steps = min(1, progress.total_steps)
        progress.step = "investigate"


def mark_sub_question(investigation_id: str, index: int, status: SubQuestionStatus) -> None:
    """Update one sub-question's status; `"done"` advances the step counter."""
    with _lock:
        progress = _registry.get(investigation_id)
        if progress is None or not (0 <= index < len(progress.sub_questions)):
            return
        progress.sub_questions[index].status = status
        if status == "done":
            progress.done_steps = min(progress.done_steps + 1, progress.total_steps)


def set_step(investigation_id: str, step: str) -> None:
    """Rename the current phase without touching the step counter."""
    with _lock:
        progress = _registry.get(investigation_id)
        if progress is None:
            return
        progress.step = step


def advance_step(investigation_id: str, step: str) -> None:
    """Mark the current phase complete and move the label to the next one."""
    with _lock:
        progress = _registry.get(investigation_id)
        if progress is None:
            return
        progress.step = step
        progress.done_steps = min(progress.done_steps + 1, progress.total_steps)


def finish(investigation_id: str, *, status: Literal["done", "failed"], latency_ms: int, error: str | None = None) -> None:
    """Close out a run once its result is persisted."""
    with _lock:
        progress = _registry.get(investigation_id)
        if progress is None:
            return
        progress.status = status
        progress.step = status
        progress.done_steps = progress.total_steps
        progress.final_latency_ms = latency_ms
        progress.error = error


def get(investigation_id: str) -> dict[str, Any] | None:
    """Snapshot for the progress endpoint, or `None` if unknown/expired."""
    with _lock:
        progress = _registry.get(investigation_id)
        if progress is None:
            return None
        elapsed_ms = (
            progress.final_latency_ms
            if progress.final_latency_ms is not None
            else int((time.time() - progress.started_at) * 1000)
        )
        return {
            "status": progress.status,
            "step": progress.step,
            "done_steps": progress.done_steps,
            "total_steps": progress.total_steps,
            "sub_questions": [asdict(sq) for sq in progress.sub_questions],
            "elapsed_ms": elapsed_ms,
            "error": progress.error,
        }
