"""Admin prompt-version routes: /api/admin/prompts/*

Governance flow for the system prompt:

    draft ──eval passes──▶ staged ──promote──▶ active ──superseded──▶ retired
      ▲                                                                  │
      └──────────────────────── rollback ◀───────────────────────────────┘

Promotion is gated on the latest linked golden-set `EvalRun` clearing the
`EVAL_MIN_*` thresholds; `?force=true` records an explicit override in the
audit log rather than silently allowing it.
"""

from __future__ import annotations

import asyncio
import difflib
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Coroutine

from fastapi import APIRouter, Depends, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import get_current_admin, get_db
from app.core.exceptions import (
    AppException,
    ConflictException,
    InvalidInputException,
    NotFoundException,
)
from app.evaluation.golden_runner import (
    STATUS_ERROR,
    STATUS_PASSED,
    STATUS_RUNNING,
    SUBSET_FULL,
    SUBSET_SMOKE,
    current_thresholds,
    evaluate_verdict,
    run_golden_eval,
    run_scores,
    run_trust,
)
from app.models.audit_log import AuditLog
from app.models.eval_run import EvalRun
from app.models.prompt_version import PromptVersion
from app.models.user import User
from app.prompts import registry
from app.schemas.common import ListResponse
from app.schemas.prompt_version import (
    ActivePromptResponse,
    PromptDiffResponse,
    PromptEvalQueued,
    PromptEvalSummary,
    PromptVersionCreate,
    PromptVersionResponse,
)
from app.utils.logger import logger

router = APIRouter(
    prefix="/admin/prompts",
    tags=["admin prompts"],
    dependencies=[Depends(get_current_admin)],
)

DELETABLE_STATUSES = ("draft", "retired")
VALID_SUBSETS = (SUBSET_SMOKE, SUBSET_FULL)

# Serialises the read-modify-write sequences that SQLite cannot express as a
# constraint: per-name version numbering, and "exactly one active per name".
# These are rare admin actions, so a process-wide lock is the cheapest correct
# answer (the app runs as a single process; the `(name, version)` unique index
# is the backstop if that ever changes).
_mutation_lock = asyncio.Lock()

# asyncio only holds a weak reference to a running task, so a bare
# `create_task(...)` can be garbage-collected mid-eval. Keep a strong
# reference until the task completes.
_eval_tasks: set[asyncio.Task[None]] = set()


def _dispatch_eval(coro: Coroutine[Any, Any, None]) -> None:
    """Fire-and-forget an eval job while retaining a reference to it."""
    task = asyncio.create_task(coro)
    _eval_tasks.add(task)
    task.add_done_callback(_eval_tasks.discard)


# ─── Helpers ──────────────────────────────────────────────────────


async def _get_prompt(db: AsyncSession, prompt_id: str) -> PromptVersion:
    prompt = (
        await db.execute(select(PromptVersion).where(PromptVersion.id == prompt_id))
    ).scalar_one_or_none()
    if prompt is None:
        raise NotFoundException("PromptVersion", prompt_id)
    return prompt


async def _eval_runs_by_id(db: AsyncSession, run_ids: list[str]) -> dict[str, EvalRun]:
    if not run_ids:
        return {}
    rows = (
        await db.execute(select(EvalRun).where(EvalRun.id.in_(run_ids)))
    ).scalars().all()
    return {row.id: row for row in rows}


def _eval_summary(run: EvalRun | None) -> PromptEvalSummary | None:
    if run is None:
        return None
    verdict: dict[str, Any] | None = None
    if run.verdict:
        try:
            parsed = json.loads(run.verdict)
            verdict = parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            verdict = None
    return PromptEvalSummary(
        id=run.id,
        status=run.status,
        subset=run.subset,
        model_used=run.model_used,
        golden_set_version=run.golden_set_version,
        faithfulness=run.faithfulness,
        context_precision=run.context_precision,
        context_recall=run.context_recall,
        answer_relevance=run.answer_relevance,
        answer_correctness=run.answer_correctness,
        refusal_accuracy=run.refusal_accuracy,
        trust=run_trust(run),
        verdict=verdict,
        run_at=run.run_at,
    )


def _to_response(prompt: PromptVersion, run: EvalRun | None = None) -> PromptVersionResponse:
    return PromptVersionResponse(
        id=prompt.id,
        name=prompt.name,
        version=prompt.version,
        content=prompt.content,
        content_hash=prompt.content_hash,
        status=prompt.status,
        model_name=prompt.model_name,
        created_by=prompt.created_by,
        promoted_at=prompt.promoted_at,
        eval_run_id=prompt.eval_run_id,
        notes=prompt.notes,
        created_at=prompt.created_at,
        updated_at=prompt.updated_at,
        eval=_eval_summary(run),
    )


async def _linked_run(db: AsyncSession, prompt: PromptVersion) -> EvalRun | None:
    """The run that gates this version: the most recent one linked to it."""
    if prompt.eval_run_id:
        run = (
            await db.execute(select(EvalRun).where(EvalRun.id == prompt.eval_run_id))
        ).scalar_one_or_none()
        if run is not None:
            return run
    return (
        await db.execute(
            select(EvalRun)
            .where(EvalRun.prompt_version_id == prompt.id)
            .order_by(EvalRun.run_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def _has_running_eval(db: AsyncSession, prompt: PromptVersion) -> bool:
    """True while a *live* queued run for this version has not reported back.

    `prompt.eval_run_id` only advances when a run *completes*, so without this
    check a promotion could be waved through on a stale passing run while a
    fresh evaluation is still in flight.

    The check is bounded by `EVAL_RUN_STALE_SECONDS`: a row still marked
    `running` after that long means its worker died (crash, restart, lost
    task), and an unbounded check would let that row wedge the version
    forever. Stale rows are retired to `error` here so the admin UI also stops
    polling them.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=settings.EVAL_RUN_STALE_SECONDS)
    running = (
        await db.execute(
            select(EvalRun).where(
                EvalRun.prompt_version_id == prompt.id,
                EvalRun.status == STATUS_RUNNING,
            )
        )
    ).scalars().all()

    live = False
    for run in running:
        if _as_utc(run.run_at) >= cutoff:
            live = True
            continue
        logger.warning(
            "prompt_eval_run_stale",
            eval_run_id=run.id,
            prompt_version_id=prompt.id,
            run_at=str(run.run_at),
        )
        run.status = STATUS_ERROR
        run.verdict = json.dumps(
            {"passed": False, "failed_metrics": ["stale"], "thresholds": current_thresholds()}
        )

    if running:
        await db.commit()
    return live


def _as_utc(value: datetime) -> datetime:
    """SQLite hands back naive datetimes; compare them as UTC."""
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _eval_in_progress(prompt: PromptVersion) -> AppException:
    """409 for actions that cannot run while an evaluation is live."""
    return AppException(
        "CONFLICT",
        "eval_in_progress",
        status_code=409,
        details={
            "detail": "eval_in_progress",
            "reason": "eval_in_progress",
            "prompt_version_id": prompt.id,
        },
    )


async def _current_active(db: AsyncSession, name: str) -> PromptVersion | None:
    return (
        await db.execute(
            select(PromptVersion)
            .where(PromptVersion.name == name, PromptVersion.status == "active")
            .order_by(PromptVersion.version.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


def _audit(user: User, action: str, prompt: PromptVersion, details: dict[str, Any]) -> AuditLog:
    return AuditLog(
        user_id=user.id,
        action=action,
        resource_type="prompt_version",
        resource_id=prompt.id,
        details=json.dumps(details, default=str),
    )


async def _generate_fn(gen_input: Any) -> Any:
    # Resolved at call time so tests can monkeypatch `generator.generate`.
    from app.generation import generator

    return await generator.generate(gen_input)


async def _guardrail_fn(answer: str, contexts: list[dict[str, Any]]) -> Any:
    from app.generation import guardrail

    return await guardrail.check(answer, contexts)


async def _trust_fn(
    retrieval_results: Any = None,
    guardrail_result: Any = None,
    generation_result: Any = None,
    query: str = "",
) -> Any:
    from app.evaluation import trust_score

    return await trust_score.compute_trust(
        retrieval_results=retrieval_results,
        guardrail_result=guardrail_result,
        generation_result=generation_result,
        query=query,
    )


async def _ragas_fn(
    queries: list[str],
    answers: list[str],
    contexts: list[list[str]],
    ground_truth: list[str] | None = None,
) -> Any:
    from app.evaluation import ragas_eval

    return await ragas_eval.ragas_evaluate(
        queries=queries, answers=answers, contexts=contexts, ground_truth=ground_truth
    )


async def _run_prompt_eval_background(
    prompt_version_id: str, eval_run_id: str, subset: str
) -> None:
    """Score a candidate prompt against the golden set and stage it if it passes.

    Fire-and-forget (same pattern as `admin._run_golden_eval_background`), so it
    must never raise into the event loop: any failure is recorded on the
    EvalRun row as `status="error"` and the prompt stays where it was.
    """
    from app.database import async_session_factory

    try:
        async with async_session_factory() as db:
            prompt = (
                await db.execute(
                    select(PromptVersion).where(PromptVersion.id == prompt_version_id)
                )
            ).scalar_one_or_none()
            if prompt is None:
                # The version was deleted mid-flight; the row would otherwise
                # sit on `running` forever.
                logger.error("prompt_eval_prompt_missing", prompt_version_id=prompt_version_id)
                await _mark_run_errored(eval_run_id, "prompt version no longer exists")
                return

            run = await run_golden_eval(
                # `entries` omitted: the runner loads builtin + reviewer-promoted
                # entries for `subset` and stamps the matching golden_set_version.
                generate_fn=_generate_fn,
                guardrail_fn=_guardrail_fn,
                trust_fn=_trust_fn,
                # ragas is slow and optional; reserve it for an explicit full run.
                ragas_fn=_ragas_fn if subset == SUBSET_FULL else None,
                db=db,
                prompt_override=prompt.content,
                model_override=prompt.model_name,
                prompt_version_id=prompt.id,
                subset=subset,
                run_id=eval_run_id,
            )

            prompt.eval_run_id = run.id
            if run.status == STATUS_PASSED:
                if prompt.status == "draft":
                    prompt.status = "staged"
            elif prompt.status == "staged":
                # A staged version whose latest run failed is no longer a
                # promotion candidate; send it back to draft so the UI agrees
                # with what the promote gate will do.
                prompt.status = "draft"
            await db.commit()

            logger.info(
                "prompt_eval_complete",
                prompt_version_id=prompt.id,
                eval_run_id=run.id,
                status=run.status,
                prompt_status=prompt.status,
            )
    except BaseException as e:  # noqa: BLE001 — must never strand a `running` row
        # BaseException, not Exception: a shutdown cancels this task, and a
        # CancelledError that skipped the write-back would leave the run stuck
        # on `running` and block the gate. Record it, then re-raise so
        # cancellation still propagates.
        logger.error(
            "prompt_eval_failed",
            prompt_version_id=prompt_version_id,
            eval_run_id=eval_run_id,
            error=str(e) or type(e).__name__,
        )
        await _mark_run_errored(eval_run_id, str(e) or type(e).__name__)
        if not isinstance(e, Exception):
            raise


async def _mark_run_errored(eval_run_id: str, message: str) -> None:
    """Best-effort: leave a terminal status so the UI stops polling `running`."""
    from app.database import async_session_factory

    try:
        async with async_session_factory() as db:
            run = (
                await db.execute(select(EvalRun).where(EvalRun.id == eval_run_id))
            ).scalar_one_or_none()
            if run is None:
                return
            run.status = STATUS_ERROR
            run.verdict = json.dumps(
                {"passed": False, "failed_metrics": ["error"], "thresholds": current_thresholds()}
            )
            await db.commit()
    except Exception as e:  # noqa: BLE001 — nothing left to do but log
        logger.error("prompt_eval_error_mark_failed", eval_run_id=eval_run_id, error=str(e))


# ─── Routes ───────────────────────────────────────────────────────


@router.get("", response_model=ListResponse[PromptVersionResponse])
@router.get("/", response_model=ListResponse[PromptVersionResponse], include_in_schema=False)
async def list_prompt_versions(
    name: str | None = None,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """List prompt versions, newest version first within each name."""
    filters = []
    if name:
        filters.append(PromptVersion.name == name)
    if status:
        filters.append(PromptVersion.status == status)

    rows = (
        await db.execute(
            select(PromptVersion)
            .where(*filters)
            .order_by(PromptVersion.name, PromptVersion.version.desc())
        )
    ).scalars().all()

    runs = await _eval_runs_by_id(db, [r.eval_run_id for r in rows if r.eval_run_id])
    return ListResponse(
        data=[_to_response(row, runs.get(row.eval_run_id or "")) for row in rows]
    )


@router.get("/active", response_model=ActivePromptResponse)
async def get_active_prompt(name: str = "answer", db: AsyncSession = Depends(get_db)):
    """The prompt generation will use for `name` right now."""
    resolved = await registry.get_active(db, name)

    version: int | None = None
    if resolved.version_id:
        version = (
            await db.execute(
                select(PromptVersion.version).where(PromptVersion.id == resolved.version_id)
            )
        ).scalar_one_or_none()

    return ActivePromptResponse(
        name=name,
        content=resolved.content,
        content_hash=resolved.hash,
        model_name=resolved.model_name,
        version=version,
        version_id=resolved.version_id,
        is_default=resolved.is_default,
    )


@router.get("/{prompt_id}", response_model=PromptVersionResponse)
async def get_prompt_version(prompt_id: str, db: AsyncSession = Depends(get_db)):
    """A single version with its linked eval scores and verdict."""
    prompt = await _get_prompt(db, prompt_id)
    return _to_response(prompt, await _linked_run(db, prompt))


@router.get("/{prompt_id}/diff", response_model=PromptDiffResponse)
async def diff_prompt_version(
    prompt_id: str,
    against: str = "active",
    db: AsyncSession = Depends(get_db),
):
    """Unified diff from `against` (a version id, or `active`) to this version."""
    prompt = await _get_prompt(db, prompt_id)

    if against == "active":
        resolved = await registry.get_active(db, prompt.name)
        base_content = resolved.content
        base_id = resolved.version_id
        base_label = f"{prompt.name} active ({resolved.hash})"
    else:
        base = await _get_prompt(db, against)
        base_content = base.content
        base_id = base.id
        base_label = f"{base.name} v{base.version} ({base.content_hash})"

    to_label = f"{prompt.name} v{prompt.version} ({prompt.content_hash})"
    diff = "\n".join(
        difflib.unified_diff(
            base_content.splitlines(),
            prompt.content.splitlines(),
            fromfile=base_label,
            tofile=to_label,
            lineterm="",
        )
    )

    return PromptDiffResponse(
        from_id=base_id,
        from_label=base_label,
        to_id=prompt.id,
        to_label=to_label,
        diff=diff,
    )


@router.post("", response_model=PromptVersionResponse, status_code=201)
@router.post("/", response_model=PromptVersionResponse, status_code=201, include_in_schema=False)
async def create_prompt_version(
    payload: PromptVersionCreate,
    user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Stage a new draft. Identical content for the same name is a conflict."""
    content_hash = registry.compute_hash(payload.content)

    async with _mutation_lock:
        existing = (
            await db.execute(
                select(PromptVersion).where(
                    PromptVersion.name == payload.name,
                    PromptVersion.content_hash == content_hash,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            raise ConflictException(
                f"Prompt '{payload.name}' v{existing.version} already has this exact content"
            )

        next_version = (
            await db.execute(
                select(func.coalesce(func.max(PromptVersion.version), 0)).where(
                    PromptVersion.name == payload.name
                )
            )
        ).scalar() or 0

        prompt = PromptVersion(
            name=payload.name,
            version=int(next_version) + 1,
            content=payload.content,
            content_hash=content_hash,
            status="draft",
            model_name=payload.model_name,
            notes=payload.notes,
            created_by=user.id,
        )
        db.add(prompt)
        # Commit inside the lock: a flush alone leaves the new version invisible
        # to the next request's `max(version)` read, which would collide.
        await db.commit()
        await db.refresh(prompt)

    return _to_response(prompt)


@router.post("/{prompt_id}/evaluate", response_model=PromptEvalQueued, status_code=202)
async def evaluate_prompt_version(
    prompt_id: str,
    subset: str = SUBSET_SMOKE,
    db: AsyncSession = Depends(get_db),
):
    """Queue a golden-set run for this version; poll the EvalRun for the result."""
    if subset not in VALID_SUBSETS:
        raise InvalidInputException(
            f"subset must be one of {', '.join(VALID_SUBSETS)}",
            details={"subset": subset},
        )

    prompt = await _get_prompt(db, prompt_id)
    if await _has_running_eval(db, prompt):
        raise _eval_in_progress(prompt)

    run = EvalRun(
        status=STATUS_RUNNING,
        prompt_version_id=prompt.id,
        model_used=prompt.model_name,
        subset=subset,
    )
    db.add(run)
    # Commit before dispatching: the background job opens its own session and
    # must be able to find the row it is supposed to fill in.
    await db.commit()
    await db.refresh(run)

    # The run itself is slow (an LLM call per entry) — dispatch and return.
    _dispatch_eval(_run_prompt_eval_background(prompt.id, run.id, subset))

    return PromptEvalQueued(
        eval_run_id=run.id,
        prompt_version_id=prompt.id,
        subset=subset,
        status=STATUS_RUNNING,
    )


@router.post("/{prompt_id}/promote", response_model=PromptVersionResponse)
async def promote_prompt_version(
    prompt_id: str,
    force: bool = False,
    user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Make this version active — only if its latest eval run passed."""
    async with _mutation_lock:
        prompt = await _get_prompt(db, prompt_id)
        if prompt.status == "active":
            raise ConflictException(f"Prompt '{prompt.name}' v{prompt.version} is already active")

        run = await _linked_run(db, prompt)
        scores = run_scores(run) if run is not None else {}

        if not force:
            if await _has_running_eval(db, prompt):
                raise _eval_gate_failed("eval_incomplete", [], scores)
            if run is None:
                raise _eval_gate_failed("no_eval_run", [], {})
            verdict = evaluate_verdict(run)
            if run.status != STATUS_PASSED or not verdict.passed:
                reason = "eval_incomplete" if run.status == STATUS_RUNNING else "thresholds_not_met"
                raise _eval_gate_failed(reason, verdict.failed_metrics, verdict.scores)

        previous = await _current_active(db, prompt.name)
        from_hash = previous.content_hash if previous else registry.DEFAULT_PROMPT_HASH
        if previous is not None:
            previous.status = "retired"

        prompt.status = "active"
        prompt.promoted_at = datetime.now(timezone.utc)

        db.add(
            _audit(
                user,
                "prompt.promote",
                prompt,
                {
                    "force": force,
                    "scores": scores,
                    "from_hash": from_hash,
                    "to_hash": prompt.content_hash,
                    "name": prompt.name,
                    "version": prompt.version,
                    "eval_run_id": run.id if run else None,
                },
            )
        )

        await db.commit()
        await db.refresh(prompt)
        registry.invalidate(prompt.name)

    return _to_response(prompt, run)


def _eval_gate_failed(
    reason: str, failed_metrics: list[str], scores: dict[str, float | None]
) -> AppException:
    """409 carrying everything the admin UI needs to explain the refusal."""
    return AppException(
        "CONFLICT",
        "eval_gate_failed",
        status_code=409,
        details={
            "detail": "eval_gate_failed",
            "reason": reason,
            "failed_metrics": list(failed_metrics),
            "thresholds": current_thresholds(),
            "scores": scores,
        },
    )


@router.post("/{prompt_id}/rollback", response_model=PromptVersionResponse)
async def rollback_prompt_version(
    prompt_id: str,
    user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Reactivate a retired version, retiring whatever is active now."""
    async with _mutation_lock:
        prompt = await _get_prompt(db, prompt_id)
        if prompt.status != "retired":
            raise ConflictException(
                f"Only retired versions can be rolled back (v{prompt.version} is {prompt.status})"
            )

        previous = await _current_active(db, prompt.name)
        from_hash = previous.content_hash if previous else registry.DEFAULT_PROMPT_HASH
        if previous is not None:
            previous.status = "retired"

        prompt.status = "active"
        prompt.promoted_at = datetime.now(timezone.utc)

        db.add(
            _audit(
                user,
                "prompt.rollback",
                prompt,
                {
                    "from_hash": from_hash,
                    "to_hash": prompt.content_hash,
                    "name": prompt.name,
                    "version": prompt.version,
                },
            )
        )

        await db.commit()
        await db.refresh(prompt)
        registry.invalidate(prompt.name)

    return _to_response(prompt, await _linked_run(db, prompt))


@router.delete("/{prompt_id}", status_code=204)
async def delete_prompt_version(
    prompt_id: str,
    user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Delete a draft or retired version. Active/staged versions are protected."""
    prompt = await _get_prompt(db, prompt_id)
    if prompt.status not in DELETABLE_STATUSES:
        raise ConflictException(
            f"Only {' / '.join(DELETABLE_STATUSES)} versions can be deleted "
            f"(v{prompt.version} is {prompt.status})"
        )
    if await _has_running_eval(db, prompt):
        # The job would come back to a prompt that no longer exists.
        raise _eval_in_progress(prompt)

    db.add(
        _audit(
            user,
            "prompt.delete",
            prompt,
            {
                "name": prompt.name,
                "version": prompt.version,
                "status": prompt.status,
                "content_hash": prompt.content_hash,
            },
        )
    )
    await db.delete(prompt)
    await db.flush()
    registry.invalidate(prompt.name)

    return Response(status_code=204)
