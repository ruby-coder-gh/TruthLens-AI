"""WebSocket handler for streaming queries: /ws/query"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import decode_token
from app.core.exceptions import UnauthorizedException
from app.database import async_session_factory
from app.models.query import Query
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.utils.logger import logger

router = APIRouter()


async def _validate_ws_token(websocket: WebSocket) -> tuple[str, str, str] | None:
    """Validate JWT token from WebSocket query params.

    Returns (user_id, username, role) or None on failure.
    """
    token = websocket.query_params.get("token")
    if not token:
        return None

    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            return None
        user_id = payload.get("sub")
        role = payload.get("role", "user")
        return user_id, user_id, role  # username not in token
    except Exception:
        return None


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


async def _run_query_pipeline(
    query_text: str,
    workspace_id: str,
    user_id: str | None,
    query_id: str,
    top_k: int,
    filters: dict[str, Any] | None,
    send_json: Any,
) -> None:
    """Run the full query pipeline and stream results via WebSocket."""
    from app.generation.generator import GenerationInput
    from app.generation.streamer import stream_tokens
    from app.generation.guardrail import check as guardrail_check
    from app.evaluation.trust_score import compute_trust
    from app.retrieval.hybrid_search import hybrid_search
    from app.retrieval.reranker import rerank
    from app.retrieval.query_rewrite import rewrite as rewrite_query

    start_time = time.time()
    model_used = "unknown"
    total_tokens = 0

    try:
        # 1. Acknowledge
        await send_json({
            "type": "ack",
            "payload": {"query_id": query_id, "status": "processing"},
        })

        # 2. Query rewrite
        await send_json({
            "type": "progress",
            "payload": {"query_id": query_id, "phase": "retrieval", "progress": 0.1},
        })

        rewritten = await rewrite_query(query_text)

        # 3. Hybrid search
        await send_json({
            "type": "progress",
            "payload": {"query_id": query_id, "phase": "retrieval", "progress": 0.3},
        })

        results = await hybrid_search(
            rewritten or query_text,
            workspace_id,
            top_k=top_k * 2,
            filters=filters,
        )

        # 4. Rerank
        reranked = await rerank(rewritten or query_text, results, top_k=top_k)

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
        await send_json({
            "type": "sources",
            "payload": {
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
        })

        # 6. Generate (stream)
        await send_json({
            "type": "progress",
            "payload": {"query_id": query_id, "phase": "generation", "progress": 0.6},
        })

        gen_input = GenerationInput(
            query=query_text,
            rewritten_query=rewritten,
            contexts=contexts,
        )

        async def token_sender(msg: dict) -> None:
            await send_json(msg)

        full_text, token_count, model_used = await stream_tokens(
            gen_input, query_id, token_sender
        )
        total_tokens = token_count

        # 7. Guardrail check
        await send_json({
            "type": "progress",
            "payload": {"query_id": query_id, "phase": "guardrail", "progress": 0.8},
        })

        guardrail_result = await guardrail_check(full_text, contexts)

        await send_json({
            "type": "guardrail",
            "payload": {
                "query_id": query_id,
                "passed": guardrail_result.passed,
                "score": guardrail_result.score,
                "details": guardrail_result.details,
            },
        })

        # 8. Trust score
        trust = await compute_trust(
            retrieval_results=reranked,
            guardrail_result=guardrail_result,
            query=query_text,
        )

        await send_json({
            "type": "trust_score",
            "payload": {
                "query_id": query_id,
                "score": trust.overall,
                "components": {
                    "retrieval_quality": trust.retrieval_quality,
                    "faithfulness": trust.faithfulness,
                    "relevance": trust.relevance,
                    "source_authority": trust.source_authority,
                },
            },
        })

        elapsed_ms = int((time.time() - start_time) * 1000)

        # 9. Complete
        await send_json({
            "type": "complete",
            "payload": {
                "query_id": query_id,
                "latency_ms": elapsed_ms,
                "model_used": model_used,
                "token_count": total_tokens,
            },
        })

        # 10. Save query to DB
        await _save_query(
            query_id=query_id,
            workspace_id=workspace_id,
            user_id=user_id,
            query_text=query_text,
            rewritten_query=rewritten,
            response_text=full_text,
            response_sources=contexts,
            trust_score=trust.overall,
            guardrail_score=guardrail_result.score,
            guardrail_passed=guardrail_result.passed,
            model_used=model_used,
            latency_ms=elapsed_ms,
            token_count=total_tokens,
        )

    except asyncio.CancelledError:
        logger.info("query_cancelled", query_id=query_id)
        await send_json({
            "type": "error",
            "payload": {"code": "CANCELLED", "message": "Query cancelled", "query_id": query_id},
        })
    except Exception as e:
        logger.error("query_pipeline_failed", error=str(e), query_id=query_id, exc_info=True)
        await send_json({
            "type": "error",
            "payload": {"code": "INTERNAL_ERROR", "message": str(e), "query_id": query_id},
        })


async def _save_query(
    query_id: str,
    workspace_id: str,
    user_id: str | None,
    query_text: str,
    rewritten_query: str | None,
    response_text: str,
    response_sources: list[dict[str, Any]],
    trust_score: float,
    guardrail_score: float,
    guardrail_passed: bool,
    model_used: str,
    latency_ms: int,
    token_count: int,
) -> None:
    """Save query result to database."""
    import json as json_mod

    async with async_session_factory() as db:
        query = Query(
            id=query_id,
            workspace_id=workspace_id,
            user_id=user_id,
            query_text=query_text,
            rewritten_query=rewritten_query,
            response_text=response_text,
            response_sources=json_mod.dumps(response_sources),
            trust_score=trust_score,
            guardrail_score=guardrail_score,
            guardrail_passed=guardrail_passed,
            model_used=model_used,
            latency_ms=latency_ms,
            token_count=token_count,
        )
        db.add(query)
        await db.commit()


@router.websocket("/ws/query")
async def websocket_query(websocket: WebSocket):
    """WebSocket endpoint for streaming queries.

    Protocol:
    1. Client connects (no query params).
    2. First message MUST be auth: {"type": "auth", "token": "<jwt>"}
    3. Subsequent messages: {"type": "query", "payload": {"workspace_id": "...", "query": "...", "top_k": 5}}
    4. Server streams back tokens, sources, guardrail, trust_score, complete
    """
    await websocket.accept()

    # First message must be auth (no token in URL to prevent leakage)
    user_id: str | None = None
    try:
        raw = await websocket.receive_text()
        auth_msg = json.loads(raw)
        if auth_msg.get("type") != "auth" or not auth_msg.get("token"):
            await websocket.send_json({
                "type": "error",
                "payload": {"code": "UNAUTHORIZED", "message": "First message must be auth with token"},
            })
            await websocket.close(code=4001)
            return
        payload = decode_token(auth_msg["token"])
        if payload.get("type") != "access":
            await websocket.send_json({
                "type": "error",
                "payload": {"code": "UNAUTHORIZED", "message": "Invalid token type"},
            })
            await websocket.close(code=4001)
            return
        user_id = payload.get("sub")
        if not user_id:
            await websocket.send_json({
                "type": "error",
                "payload": {"code": "UNAUTHORIZED", "message": "Invalid token payload"},
            })
            await websocket.close(code=4001)
            return

        await websocket.send_json({"type": "auth_success"})
    except Exception:
        await websocket.send_json({
            "type": "error",
            "payload": {"code": "UNAUTHORIZED", "message": "Authentication failed"},
        })
        await websocket.close(code=4001)
        return

    current_task: asyncio.Task | None = None
    logger.info("ws_connected", user_id=user_id)

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

            if msg_type == "query":
                # Cancel existing task
                if current_task and not current_task.done():
                    current_task.cancel()

                workspace_id = msg_payload.get("workspace_id")
                query_text = msg_payload.get("query")
                top_k = msg_payload.get("top_k", 5)
                filters = msg_payload.get("filters")

                if not workspace_id or not query_text:
                    await websocket.send_json({
                        "type": "error",
                        "payload": {"code": "INVALID_INPUT", "message": "workspace_id and query are required"},
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

                query_id = str(uuid.uuid4())

                # Launch pipeline in background task
                current_task = asyncio.create_task(
                    _run_query_pipeline(
                        query_text=query_text,
                        workspace_id=workspace_id,
                        user_id=user_id,
                        query_id=query_id,
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
                        "payload": {"code": "CANCELLED", "message": "Query cancelled", "query_id": None},
                    })

            else:
                await websocket.send_json({
                    "type": "error",
                    "payload": {"code": "INVALID_INPUT", "message": f"Unknown message type: {msg_type}"},
                })

    except WebSocketDisconnect:
        logger.info("ws_disconnected", user_id=user_id)
        if current_task and not current_task.done():
            current_task.cancel()
    except Exception as e:
        logger.error("ws_error", error=str(e), user_id=user_id)
        try:
            await websocket.send_json({
                "type": "error",
                "payload": {"code": "INTERNAL_ERROR", "message": str(e)},
            })
        except Exception:
            pass
        finally:
            try:
                await websocket.close(code=1011)
            except Exception:
                pass
