"""WebSocket handler for streaming queries: /ws/query"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.api.stream_registry import (
    RESUME_UNAVAILABLE,
    StreamBuffer,
    StreamSink,
    stream_registry,
    track_task,
)
from app.core.auth import decode_token
from app.database import async_session_factory
from app.models.query import Query
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.models.document import Document
from app.models.comparison import Comparison, ComparisonResult
from app.prompts.registry import get_active as get_active_prompt
from app.query_cache import (
    cached_query_sources,
    get_workspace_document_version,
    lookup_cached_query,
    normalize_query,
)
from app.utils.logger import logger

router = APIRouter()

MIN_TOP_K = 1
MAX_TOP_K = 20


async def _resolve_ws_user_id(token: str) -> str | None:
    """Validate access token and ensure user is active."""
    try:
        payload = decode_token(token)
    except Exception as e:
        logger.warning("ws_token_decode_failed", error=str(e))
        return None

    if payload.get("type") != "access":
        return None

    user_id = payload.get("sub")
    if not user_id:
        return None

    async with async_session_factory() as db:
        result = await db.execute(select(User.id).where(User.id == user_id, User.is_active.is_(True)))
        active_user_id = result.scalar_one_or_none()
        return active_user_id


async def _authenticate_websocket(websocket: WebSocket) -> str | None:
    """Authenticate websocket using HttpOnly cookie; fallback to legacy auth message."""
    cookie_token = websocket.cookies.get("access_token")
    if cookie_token:
        user_id = await _resolve_ws_user_id(cookie_token)
        if not user_id:
            return None
        await websocket.send_json({"type": "auth_success"})
        return user_id

    # Legacy fallback for non-browser clients: first message carries token
    try:
        raw = await websocket.receive_text()
        auth_msg = json.loads(raw)
    except Exception as e:
        logger.info("ws_auth_handshake_failed", error=str(e))
        return None

    if auth_msg.get("type") != "auth" or not auth_msg.get("token"):
        return None

    user_id = await _resolve_ws_user_id(auth_msg["token"])
    if not user_id:
        return None

    await websocket.send_json({"type": "auth_success"})
    return user_id


async def _check_workspace_access(user_id: str, workspace_id: str) -> bool:
    """Check if user has access to workspace."""
    async with async_session_factory() as db:
        # Check owner
        result = await db.execute(
            select(Workspace).where(Workspace.id == workspace_id, Workspace.owner_id == user_id)
        )
        if result.scalar_one_or_none():
            return True

        # Check member
        result = await db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == user_id,
            )
        )
        return result.scalar_one_or_none() is not None


def _source_payload(context: dict[str, Any]) -> dict[str, Any]:
    """Shape persisted retrieval context into the public WebSocket source contract."""
    metadata = context.get("metadata")
    safe_metadata = metadata if isinstance(metadata, dict) else {}
    raw_excerpt = context.get("excerpt") or context.get("content") or ""
    excerpt = raw_excerpt if isinstance(raw_excerpt, str) else str(raw_excerpt)
    raw_score = context.get("relevance_score", context.get("score", 0.0))
    score = float(raw_score) if isinstance(raw_score, (int, float)) else 0.0
    rerank_score = context.get("rerank_score")

    return {
        "chunk_id": str(context.get("chunk_id", "")),
        "document_id": str(context.get("document_id", "")),
        "document_name": context.get("document_name") or safe_metadata.get("document_name", ""),
        "excerpt": excerpt[:300],
        "relevance_score": score,
        "rerank_score": rerank_score if isinstance(rerank_score, (int, float)) else None,
        "page_number": context.get("page_number") or safe_metadata.get("page_number"),
        "matched_chunks": context.get("matched_chunks", 1),
        "confidence": context.get("confidence") if isinstance(context.get("confidence"), (int, float)) else min(1.0, score * 1.5 + 0.3),
    }


async def _send_cached_query(query: Query, sink: StreamSink, elapsed_ms: int) -> None:
    """Return a persisted answer in the normal streaming protocol without running RAG again.

    Goes through the same sink as a live stream, so cached frames are `seq`-numbered
    and resumable exactly like generated ones.
    """
    sources = cached_query_sources(query)
    await sink.emit("ack", {"query_id": query.id, "status": "cached"})
    await sink.emit(
        "sources",
        {"query_id": query.id, "sources": [_source_payload(source) for source in sources]},
    )
    await sink.emit(
        "token",
        {"query_id": query.id, "content": query.response_text or "", "index": 0},
    )
    if query.guardrail_score is not None and query.guardrail_passed is not None:
        await sink.emit(
            "guardrail",
            {
                "query_id": query.id,
                "passed": query.guardrail_passed,
                "score": query.guardrail_score,
                "details": "Served from cached result.",
            },
        )
    if query.trust_score is not None:
        await sink.emit(
            "trust_score",
            {"query_id": query.id, "score": query.trust_score, "components": {}},
        )
    await sink.emit(
        "complete",
        {
            "query_id": query.id,
            "latency_ms": elapsed_ms,
            "model_used": query.model_used or "cached",
            "token_count": query.token_count or 0,
            "from_cache": True,
            # A cache hit is keyed on the active prompt hash, so this is always
            # the prompt currently in force; echoing it saves the client a
            # `GET /admin/prompts/active`. NULL on rows written before pinning.
            "prompt_version": getattr(query, "prompt_version", None),
            # A gated abstention is cacheable (response_text is not NULL), so the
            # replay has to keep saying it was an abstention.
            "edge_case": getattr(query, "edge_case", None),
        },
    )


async def _run_query_pipeline(
    query_text: str,
    workspace_id: str,
    user_id: str | None,
    query_id: str,
    top_k: int,
    filters: dict[str, Any] | None,
    sink: StreamSink,
    force_refresh: bool = False,
) -> None:
    """Run the full query pipeline and stream results through `sink`.

    Every frame is emitted with `await sink.emit(type, payload)`, which stamps a
    monotonic `seq` and buffers the frame for resume. Delivery failures detach
    the sink instead of raising, so a client disconnect no longer aborts the run:
    the pipeline finishes and `_save_query` still persists the answer.
    """
    from app.generation.generator import GenerationInput
    from app.generation.streamer import stream_tokens
    from app.generation.guardrail import check as guardrail_check
    from app.generation.safety import sanitize_input
    from app.evaluation.trust_score import compute_trust
    from app.retrieval.hybrid_search import hybrid_search
    from app.retrieval.reranker import rerank
    from app.retrieval.query_rewrite import rewrite as rewrite_query
    from app.retrieval.sufficiency import maybe_abstain

    sanitized_query = sanitize_input(query_text).strip()

    try:
        top_k = int(top_k)
    except (TypeError, ValueError):
        top_k = 5
    top_k = max(MIN_TOP_K, min(top_k, MAX_TOP_K))

    start_time = time.time()
    model_used = "unknown"
    total_tokens = 0

    try:
        if not sanitized_query:
            raise ValueError("Query is empty after sanitization")

        async with async_session_factory() as db:
            document_version = await get_workspace_document_version(db, workspace_id)
            # Resolve the active prompt here (not just before generation): a
            # promoted prompt must invalidate answers written by the old one.
            resolved_prompt = await get_active_prompt(db)
            if filters:
                logger.info("query_cache_bypassed", workspace_id=workspace_id, reason="filtered_query")
                cached_query = None
            else:
                cached_query = await lookup_cached_query(
                    db,
                    workspace_id=workspace_id,
                    query_text=sanitized_query,
                    document_version=document_version,
                    prompt_version=resolved_prompt.hash,
                    force_refresh=force_refresh,
                )
            await db.commit()

        if cached_query is not None:
            await _send_cached_query(cached_query, sink, int((time.time() - start_time) * 1000))
            return

        # 1. Acknowledge
        await sink.emit("ack", {"query_id": query_id, "status": "processing"})

        # 2. Query rewrite
        await sink.emit(
            "progress",
            {"query_id": query_id, "phase": "retrieval", "progress": 0.1},
        )

        rewritten = await rewrite_query(sanitized_query)

        # 3. Hybrid search
        await sink.emit(
            "progress",
            {"query_id": query_id, "phase": "retrieval", "progress": 0.3},
        )

        results = await hybrid_search(
            rewritten or sanitized_query,
            workspace_id,
            top_k=top_k * 2,
            filters=filters,
        )

        # 4. Rerank
        reranked = await rerank(rewritten or sanitized_query, results, top_k=top_k)

        # 4.5 Evidence-sufficiency gate: abstain rather than generate on thin evidence.
        abstention = maybe_abstain(query_id, reranked, elapsed_ms=int((time.time() - start_time) * 1000))
        if abstention is not None:
            for frame in abstention.frames:
                # Already {type, payload} (sufficiency._abstention_frames), so the
                # sink can stamp `seq` and buffer each one for resume.
                await sink.send(frame)
            await _save_query(
                query_id=query_id, workspace_id=workspace_id, user_id=user_id,
                query_text=sanitized_query, rewritten_query=rewritten,
                normalized_query=normalize_query(sanitized_query),
                document_version=document_version,
                # An abstention still records which prompt was active: the row
                # has to drop out of the cache once that prompt is replaced,
                # exactly like a generated answer. No LLM ran, so there are no
                # prompt tokens to account for.
                prompt_version=resolved_prompt.hash, prompt_tokens=None,
                **abstention.save_fields,
            )
            return

        contexts = [
            {
                "chunk_id": r.chunk_id,
                "document_id": r.document_id,
                "document_name": r.metadata.get("document_name", ""),
                "content": r.content,
                "score": r.final_score,
                "rerank_score": r.rerank_score,
                "metadata": r.metadata,
            }
            for r in reranked
        ]

        # 5. Send sources
        await sink.emit(
            "sources",
            {
                "query_id": query_id,
                "sources": [
                    {
                        "chunk_id": ctx["chunk_id"],
                        "document_id": ctx["document_id"],
                        "document_name": ctx.get("document_name", ""),
                        "excerpt": ctx["content"][:300],
                        "relevance_score": ctx.get("score", 0),
                        "rerank_score": ctx.get("rerank_score"),
                        "matched_chunks": 1,
                        "confidence": min(1.0, ctx.get("score", 0) * 1.5 + 0.3),
                    }
                    for ctx in contexts
                ],
            },
        )

        # 6. Generate (stream)
        await sink.emit(
            "progress",
            {"query_id": query_id, "phase": "generation", "progress": 0.6},
        )

        gen_input = GenerationInput(
            query=sanitized_query,
            rewritten_query=rewritten,
            contexts=contexts,
            system_prompt=None if resolved_prompt.is_default else resolved_prompt.content,
            model=resolved_prompt.model_name,
        )

        full_text, token_count, model_used, prompt_tokens, prompt_version = await stream_tokens(
            gen_input, query_id, sink.send
        )
        total_tokens = token_count

        # 7. Guardrail check
        await sink.emit(
            "progress",
            {"query_id": query_id, "phase": "guardrail", "progress": 0.8},
        )

        guardrail_result = await guardrail_check(full_text, contexts)

        await sink.emit(
            "guardrail",
            {
                "query_id": query_id,
                "passed": guardrail_result.passed,
                "score": guardrail_result.score,
                "details": guardrail_result.details,
            },
        )

        # 8. Trust score
        trust = await compute_trust(
            retrieval_results=reranked,
            guardrail_result=guardrail_result,
            query=sanitized_query,
        )

        await sink.emit(
            "trust_score",
            {
                "query_id": query_id,
                "score": trust.overall,
                "components": {
                    "retrieval_quality": trust.retrieval_quality,
                    "faithfulness": trust.faithfulness,
                    "relevance": trust.relevance,
                    "source_authority": trust.source_authority,
                },
            },
        )

        elapsed_ms = int((time.time() - start_time) * 1000)

        # 9. Complete
        await sink.emit(
            "complete",
            {
                "query_id": query_id,
                "latency_ms": elapsed_ms,
                "model_used": model_used,
                "prompt_version": prompt_version,
                "token_count": total_tokens,
                "from_cache": False,
            },
        )

        # 10. Save query to DB
        await _save_query(
            query_id=query_id,
            workspace_id=workspace_id,
            user_id=user_id,
            query_text=sanitized_query,
            rewritten_query=rewritten,
            response_text=full_text,
            response_sources=contexts,
            trust_score=trust.overall,
            trust_components={
                "retrieval_quality": trust.retrieval_quality,
                "faithfulness": trust.faithfulness,
                "relevance": trust.relevance,
                "source_authority": trust.source_authority,
            },
            guardrail_score=guardrail_result.score,
            guardrail_passed=guardrail_result.passed,
            model_used=model_used,
            latency_ms=elapsed_ms,
            token_count=total_tokens,
            normalized_query=normalize_query(sanitized_query),
            document_version=document_version,
            prompt_tokens=prompt_tokens,
            prompt_version=prompt_version,
        )

    except asyncio.CancelledError:
        logger.info("query_cancelled", query_id=query_id)
        # Routed through the sink: on a closed socket this detaches instead of
        # raising "Cannot call send once a close message has been sent".
        await sink.emit(
            "error",
            {"code": "CANCELLED", "message": "Query cancelled", "query_id": query_id},
        )
    except Exception as e:
        logger.error("query_pipeline_failed", error=str(e), query_id=query_id, exc_info=True)
        await sink.emit(
            "error",
            {"code": "INTERNAL_ERROR", "message": str(e), "query_id": query_id},
        )
    finally:
        # The stream is over either way; the buffer stays replayable for the TTL.
        sink.mark_done()


async def _save_query(
    query_id: str,
    workspace_id: str,
    user_id: str | None,
    query_text: str,
    rewritten_query: str | None,
    response_text: str,
    response_sources: list[dict[str, Any]],
    trust_score: float,
    trust_components: dict[str, float],
    guardrail_score: float,
    guardrail_passed: bool,
    model_used: str,
    latency_ms: int,
    token_count: int,
    normalized_query: str,
    document_version: int,
    edge_case: str | None = None,
    prompt_tokens: int | None = None,
    prompt_version: str | None = None,
) -> None:
    """Save query result to database."""
    import json as json_mod

    async with async_session_factory() as db:
        query = Query(
            id=query_id,
            workspace_id=workspace_id,
            user_id=user_id,
            query_text=query_text,
            normalized_query=normalized_query,
            document_version=document_version,
            rewritten_query=rewritten_query,
            response_text=response_text,
            response_sources=json_mod.dumps(response_sources),
            trust_score=trust_score,
            trust_components=trust_components,
            guardrail_score=guardrail_score,
            guardrail_passed=guardrail_passed,
            model_used=model_used,
            latency_ms=latency_ms,
            token_count=token_count,
            edge_case=edge_case,
            prompt_tokens=prompt_tokens,
            prompt_version=prompt_version,
        )
        db.add(query)
        await db.commit()


async def _handle_resume(
    send_json: Any,
    user_id: str,
    payload: dict[str, Any],
) -> StreamSink | None:
    """Serve a `resume` opcode. Returns the re-attached sink, or None.

    Replays every buffered frame with `seq > last_seq` onto this socket and, if
    the stream is still running, re-points its sink here. Any failure (unknown or
    expired id, another user's stream, workspace access lost) answers with a
    single `RESUME_UNAVAILABLE` error so the client can just re-send the query —
    and so the wire never reveals which query ids exist.
    """
    query_id = payload.get("query_id")
    if not query_id or not isinstance(query_id, str):
        await send_json({
            "type": "error",
            "payload": {"code": "INVALID_INPUT", "message": "query_id is required to resume"},
        })
        return None

    try:
        last_seq = max(0, int(payload.get("last_seq", 0)))
    except (TypeError, ValueError):
        last_seq = 0

    async def _authorize(buffer: StreamBuffer) -> bool:
        if not buffer.workspace_id:
            return False
        return await _check_workspace_access(user_id, buffer.workspace_id)

    async def _send_resumed_marker(replayed: int, live: bool) -> None:
        # Runs inside the sink's replay lock, after the re-attach, so this frame
        # is genuinely "backlog flushed, live frames follow" — a frame emitted by
        # the pipeline mid-replay queues behind it.
        await send_json({
            "type": "resumed",
            "payload": {
                "query_id": query_id,
                "from_seq": last_seq,
                "replayed": replayed,
                "live": live,
            },
        })

    result = await stream_registry.resume(
        query_id=query_id,
        user_id=user_id,
        last_seq=last_seq,
        send=send_json,
        authorize=_authorize,
        on_flushed=_send_resumed_marker,
    )

    if not result.ok:
        logger.info(
            "ws_resume_unavailable", query_id=query_id, user_id=user_id, reason=result.reason
        )
        await send_json({
            "type": "error",
            "payload": {
                "code": RESUME_UNAVAILABLE,
                "message": "Stream is no longer available; re-send the query",
                "query_id": query_id,
            },
        })
        return None

    if not result.live:
        return None

    buffer = await stream_registry.get(query_id)
    return buffer.sink if buffer is not None else None


@router.websocket("/ws/query")
async def websocket_query(websocket: WebSocket):
    """WebSocket endpoint for streaming queries.

    Protocol:
    1. Client connects with valid access_token cookie.
    2. Server replies auth_success.
    3. Client sends query messages: {"type": "query", "payload": {"workspace_id": "...", "query": "...", "top_k": 5}}
    4. Server streams back tokens, sources, guardrail, trust_score, complete.

    Legacy fallback: if no cookie, first message may be {"type": "auth", "token": "<jwt>"}.

    Stream frames (ack/progress/sources/token/stream_end/guardrail/trust_score/
    complete, and the stream's own error frames) carry a top-level `seq`: a
    monotonic, gapless, 1-based counter per query_id. Connection-level frames
    (auth_success, resumed, and errors raised before a query starts) have no `seq`.

    Reconnect: after `auth_success`, send
    {"type": "resume", "payload": {"query_id": "...", "last_seq": <int>}}.
    The server replays every buffered frame with seq > last_seq, then sends
    {"type": "resumed", "payload": {query_id, from_seq, replayed, live}}; when
    `live` is true the running stream continues on this socket. The `resumed`
    frame is emitted inside the replay lock, so it always lands after the last
    replayed frame and before the first live one. If the stream is unknown,
    expired, dropped for outgrowing its frame ceiling, owned by another user, or
    the workspace is no longer accessible, the server replies
    {"type": "error", "payload": {"code": "RESUME_UNAVAILABLE", ...}} and the
    client should re-send the query.

    Cancel: {"type": "cancel"} stops a running query (CANCELLED error frame, and
    the stream stops being resumable). With nothing running the server replies
    {"type": "cancel_ack", "payload": {query_id, "cancelled": false}} and leaves
    the buffer resumable.

    A missing, null, or non-object `payload` is answered with an INVALID_INPUT
    error frame; it never closes the connection.

    Close codes: 4001 = authentication failed, 1011 = unhandled server error.
    """
    await websocket.accept()

    user_id = await _authenticate_websocket(websocket)
    if not user_id:
        await websocket.send_json({
            "type": "error",
            "payload": {"code": "UNAUTHORIZED", "message": "Authentication failed"},
        })
        await websocket.close(code=4001)
        return

    current_task: asyncio.Task | None = None
    current_sink: StreamSink | None = None
    # Bind once: `websocket.send_json` yields a fresh bound method on every
    # attribute access, and the sink compares send targets by identity.
    send_json = websocket.send_json
    logger.info("ws_connected", user_id=user_id)

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await send_json({
                    "type": "error",
                    "payload": {"code": "INVALID_INPUT", "message": "Invalid JSON"},
                })
                continue

            msg_type = data.get("type")
            # `data.get("payload", {})` returns None for an explicit null and any
            # scalar the client sends; both used to blow up on `.get` and close
            # the socket with 1011.
            msg_payload = data.get("payload") or {}
            if not isinstance(msg_payload, dict):
                await send_json({
                    "type": "error",
                    "payload": {"code": "INVALID_INPUT", "message": "payload must be an object"},
                })
                continue

            if msg_type == "query":
                # Supersede the in-flight query: the client abandoned it.
                if current_task and not current_task.done():
                    current_task.cancel()
                if current_sink is not None:
                    await stream_registry.drop(current_sink.query_id)

                workspace_id = msg_payload.get("workspace_id")
                query_text = msg_payload.get("query")
                top_k = msg_payload.get("top_k", 5)
                filters = msg_payload.get("filters")
                force_refresh = bool(msg_payload.get("force_refresh", False))

                if not workspace_id or not query_text:
                    await send_json({
                        "type": "error",
                        "payload": {"code": "INVALID_INPUT", "message": "workspace_id and query are required"},
                    })
                    continue

                # Check workspace access
                has_access = await _check_workspace_access(user_id, workspace_id)
                if not has_access:
                    await send_json({
                        "type": "error",
                        "payload": {"code": "FORBIDDEN", "message": "No access to this workspace"},
                    })
                    continue

                query_id = str(uuid.uuid4())

                current_sink = await stream_registry.create(
                    query_id=query_id,
                    user_id=user_id,
                    workspace_id=workspace_id,
                    send=send_json,
                )

                # Launch pipeline in background task
                current_task = asyncio.create_task(
                    _run_query_pipeline(
                        query_text=query_text,
                        workspace_id=workspace_id,
                        user_id=user_id,
                        query_id=query_id,
                        top_k=top_k,
                        filters=filters,
                        sink=current_sink,
                        force_refresh=force_refresh,
                    )
                )
                # The buffer keeps the task reachable (and alive) across a
                # disconnect so a resumed connection can still cancel it;
                # `track_task` lets shutdown drain it before the engine closes.
                current_sink.buffer.task = current_task
                track_task(current_task)

            elif msg_type == "resume":
                resumed_sink = await _handle_resume(
                    send_json=send_json,
                    user_id=user_id,
                    payload=msg_payload,
                )
                if resumed_sink is not None:
                    current_sink = resumed_sink
                    current_task = resumed_sink.buffer.task

            elif msg_type == "cancel":
                cancel_target = current_sink.query_id if current_sink else None
                if current_task and not current_task.done():
                    current_task.cancel()
                    await send_json({
                        "type": "error",
                        "payload": {
                            "code": "CANCELLED",
                            "message": "Query cancelled",
                            "query_id": cancel_target,
                        },
                    })
                    if current_sink is not None:
                        # An explicitly cancelled query is not resumable.
                        await stream_registry.drop(current_sink.query_id)
                else:
                    # Nothing to stop (e.g. Stop pressed on unmount after the
                    # stream finished). Acknowledge without destroying the
                    # buffer, which the client may still want to resume.
                    await send_json({
                        "type": "cancel_ack",
                        "payload": {"query_id": cancel_target, "cancelled": False},
                    })

            else:
                await send_json({
                    "type": "error",
                    "payload": {"code": "INVALID_INPUT", "message": f"Unknown message type: {msg_type}"},
                })

    except WebSocketDisconnect:
        logger.info("ws_disconnected", user_id=user_id, query_id=current_sink.query_id if current_sink else None)
        # Detach rather than cancel: the pipeline runs to completion (and still
        # persists the answer) and the client can resume onto a new socket.
        if current_sink is not None:
            current_sink.detach(send_json)
    except Exception as e:
        logger.error("ws_error", error=str(e), user_id=user_id)
        # This socket is about to close; stop the pipeline writing into it.
        if current_sink is not None:
            current_sink.detach(send_json)
        try:
            await send_json({
                "type": "error",
                "payload": {"code": "INTERNAL_ERROR", "message": str(e)},
            })
        except Exception as send_err:
            logger.debug("ws_error_send_failed", error=str(send_err), user_id=user_id)
        finally:
            try:
                await websocket.close(code=1011)
            except Exception as close_err:
                logger.debug("ws_close_failed", error=str(close_err), user_id=user_id)


# ─── Comparison WebSocket Handler ──────────────────────────────────────────────

async def _run_comparison_pipeline(
    query_text: str,
    workspace_id: str,
    document_ids: list[str],
    user_id: str | None,
    comparison_id: str,
    top_k: int,
    filters: dict[str, Any] | None,
    send_json: Any,
) -> None:
    """Run the comparison pipeline and stream results via WebSocket."""
    from app.graph.comparison_graph import run_comparison
    from app.generation.safety import sanitize_input

    sanitized_query = sanitize_input(query_text).strip()

    try:
        top_k = int(top_k)
    except (TypeError, ValueError):
        top_k = 5
    top_k = max(MIN_TOP_K, min(top_k, MAX_TOP_K))

    start_time = time.time()

    try:
        if not sanitized_query:
            raise ValueError("Query is empty after sanitization")

        # 1. Acknowledge
        await send_json({
            "type": "ack",
            "payload": {"comparison_id": comparison_id, "status": "processing"},
        })

        # 2. Progress - starting per-doc queries
        await send_json({
            "type": "progress",
            "payload": {
                "comparison_id": comparison_id,
                "phase": "per_doc",
                "progress": 0.1,
                "completed_docs": 0,
                "total_docs": len(document_ids),
            },
        })

        # 3. Run comparison (streams internally)
        result = await run_comparison(
            query=sanitized_query,
            workspace_id=workspace_id,
            document_ids=document_ids,
            user_id=user_id,
            query_id=comparison_id,
            top_k=top_k,
            filters=filters,
        )

        # 4. Send per-doc results as they complete (simulated progress updates)
        doc_results = result.get("doc_results", [])
        for i, dr in enumerate(doc_results):
            await send_json({
                "type": "doc_result",
                "payload": {
                    "comparison_id": comparison_id,
                    "document_id": dr.get("document_id"),
                    "document_name": dr.get("document_name"),
                    "answer_text": dr.get("answer_text"),
                    "sources": dr.get("sources", []),
                    "trust_score": dr.get("trust_score"),
                    "stance": result.get("per_doc_stances", {}).get(dr.get("document_id", ""), "silent"),
                },
            })

            # Progress update
            await send_json({
                "type": "progress",
                "payload": {
                    "comparison_id": comparison_id,
                    "phase": "per_doc",
                    "progress": 0.2 + 0.6 * (i + 1) / len(doc_results) if doc_results else 0.8,
                    "completed_docs": i + 1,
                    "total_docs": len(doc_results),
                },
            })

        # 5. Send synthesis
        await send_json({
            "type": "synthesis",
            "payload": {
                "comparison_id": comparison_id,
                "synthesis_text": result.get("synthesis_text"),
                "agreement_score": result.get("agreement_score"),
                "agreements": result.get("agreements", []),
                "contradictions": result.get("contradictions", []),
                "gaps": result.get("gaps", []),
            },
        })

        # 6. Trust score
        trust_score = result.get("trust_score")
        trust_components = result.get("trust_components", {})
        if trust_score is not None:
            await send_json({
                "type": "trust_score",
                "payload": {
                    "comparison_id": comparison_id,
                    "score": trust_score,
                    "components": trust_components,
                },
            })

        elapsed_ms = int((time.time() - start_time) * 1000)

        # 7. Complete
        await send_json({
            "type": "complete",
            "payload": {
                "comparison_id": comparison_id,
                "latency_ms": elapsed_ms,
                "doc_count": len(doc_results),
            },
        })

        # 8. Save comparison to DB
        await _save_comparison(
            comparison_id=comparison_id,
            workspace_id=workspace_id,
            user_id=user_id,
            query_text=sanitized_query,
            document_ids=document_ids,
            synthesis_text=result.get("synthesis_text"),
            agreement_score=result.get("agreement_score"),
            trust_score=trust_score,
            doc_results=doc_results,
            per_doc_stances=result.get("per_doc_stances", {}),
            latency_ms=elapsed_ms,
        )

    except asyncio.CancelledError:
        logger.info("comparison_cancelled", comparison_id=comparison_id)
        await send_json({
            "type": "error",
            "payload": {"code": "CANCELLED", "message": "Comparison cancelled", "comparison_id": comparison_id},
        })
    except Exception as e:
        logger.error("comparison_pipeline_failed", error=str(e), comparison_id=comparison_id, exc_info=True)
        await send_json({
            "type": "error",
            "payload": {"code": "INTERNAL_ERROR", "message": str(e), "comparison_id": comparison_id},
        })


async def _save_comparison(
    comparison_id: str,
    workspace_id: str,
    user_id: str | None,
    query_text: str,
    document_ids: list[str],
    synthesis_text: str | None,
    agreement_score: float | None,
    trust_score: float | None,
    doc_results: list[dict],
    per_doc_stances: dict[str, str],
    latency_ms: int,
) -> None:
    """Save comparison result to database."""
    import json as json_mod

    async with async_session_factory() as db:
        comparison = Comparison(
            id=comparison_id,
            workspace_id=workspace_id,
            user_id=user_id,
            question=query_text,
            document_ids=document_ids,
            synthesis_text=synthesis_text,
            agreement_score=agreement_score,
            trust_score=trust_score,
        )
        db.add(comparison)

        # Add per-document results
        for dr in doc_results:
            doc_id = dr.get("document_id")
            if not doc_id:
                # document_id is NOT NULL on ComparisonResult; skip malformed rows.
                continue
            doc_id = str(doc_id)
            doc_result = ComparisonResult(
                id=str(uuid.uuid4()),
                comparison_id=comparison_id,
                document_id=doc_id,
                answer_text=dr.get("answer_text", ""),
                sources=json_mod.dumps(dr.get("sources", [])),
                trust_score=dr.get("trust_score"),
                stance=per_doc_stances.get(doc_id, "silent"),
            )
            db.add(doc_result)

        await db.commit()


@router.websocket("/ws/compare")
async def websocket_compare(websocket: WebSocket):
    """WebSocket endpoint for streaming multi-document comparisons.

    Protocol:
    1. Client connects with valid access_token cookie.
    2. Server replies auth_success.
    3. Client sends compare messages: {"type": "compare", "payload": {"workspace_id": "...", "query": "...", "document_ids": [...], "top_k": 5}}
    4. Server streams back: ack, progress, doc_result, synthesis, trust_score, complete.

    Legacy fallback: if no cookie, first message may be {"type": "auth", "token": "<jwt>"}.
    """
    await websocket.accept()

    user_id = await _authenticate_websocket(websocket)
    if not user_id:
        await websocket.send_json({
            "type": "error",
            "payload": {"code": "UNAUTHORIZED", "message": "Authentication failed"},
        })
        await websocket.close(code=4001)
        return

    current_task: asyncio.Task | None = None
    logger.info("ws_compare_connected", user_id=user_id)

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({
                    "type": "error",
                    "payload": {"code": "INVALID_INPUT", "message": "Invalid JSON"},
                })
                continue

            msg_type = data.get("type")
            msg_payload = data.get("payload", {})

            if msg_type == "compare":
                # Cancel existing task
                if current_task and not current_task.done():
                    current_task.cancel()

                workspace_id = msg_payload.get("workspace_id")
                query_text = msg_payload.get("query")
                document_ids = msg_payload.get("document_ids", [])
                top_k = msg_payload.get("top_k", 5)
                filters = msg_payload.get("filters")

                if not workspace_id or not query_text or not document_ids:
                    await websocket.send_json({
                        "type": "error",
                        "payload": {"code": "INVALID_INPUT", "message": "workspace_id, query, and document_ids are required"},
                    })
                    continue

                if len(document_ids) < 2:
                    await websocket.send_json({
                        "type": "error",
                        "payload": {"code": "INVALID_INPUT", "message": "At least 2 documents required for comparison"},
                    })
                    continue

                if len(document_ids) > 10:
                    await websocket.send_json({
                        "type": "error",
                        "payload": {"code": "INVALID_INPUT", "message": "Maximum 10 documents per comparison"},
                    })
                    continue

                # Check workspace access
                has_access = await _check_workspace_access(user_id, workspace_id)
                if not has_access:
                    await websocket.send_json({
                        "type": "error",
                        "payload": {"code": "FORBIDDEN", "message": "No access to this workspace"},
                    })
                    continue

                # Verify documents exist and belong to workspace
                async with async_session_factory() as db:
                    doc_result = await db.execute(
                        select(Document.id).where(
                            Document.id.in_(document_ids),
                            Document.workspace_id == workspace_id,
                        )
                    )
                    valid_doc_ids = [row[0] for row in doc_result.fetchall()]

                if len(valid_doc_ids) != len(document_ids):
                    await websocket.send_json({
                        "type": "error",
                        "payload": {"code": "INVALID_INPUT", "message": "Some documents not found or not in workspace"},
                    })
                    continue

                comparison_id = str(uuid.uuid4())

                # Launch pipeline in background task
                current_task = asyncio.create_task(
                    _run_comparison_pipeline(
                        query_text=query_text,
                        workspace_id=workspace_id,
                        document_ids=valid_doc_ids,
                        user_id=user_id,
                        comparison_id=comparison_id,
                        top_k=top_k,
                        filters=filters,
                        send_json=websocket.send_json,
                    )
                )

            elif msg_type == "cancel":
                if current_task and not current_task.done():
                    current_task.cancel()
                    await websocket.send_json({
                        "type": "error",
                        "payload": {"code": "CANCELLED", "message": "Comparison cancelled", "comparison_id": None},
                    })

            else:
                await websocket.send_json({
                    "type": "error",
                    "payload": {"code": "INVALID_INPUT", "message": f"Unknown message type: {msg_type}"},
                })

    except WebSocketDisconnect:
        logger.info("ws_compare_disconnected", user_id=user_id)
        if current_task and not current_task.done():
            current_task.cancel()
    except Exception as e:
        logger.error("ws_compare_error", error=str(e), user_id=user_id)
        try:
            await websocket.send_json({
                "type": "error",
                "payload": {"code": "INTERNAL_ERROR", "message": str(e)},
            })
        except Exception as send_err:
            logger.debug("ws_compare_error_send_failed", error=str(send_err), user_id=user_id)
        finally:
            try:
                await websocket.close(code=1011)
            except Exception as close_err:
                logger.debug("ws_compare_close_failed", error=str(close_err), user_id=user_id)
