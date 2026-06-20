"""Investigation routes: /api/workspaces/{workspace_id}/investigate"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends

from app.core.deps import check_workspace_access, get_current_user
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.investigation import InvestigationRequest, InvestigationResponse
from app.utils.logger import logger

router = APIRouter(tags=["investigation"])


@router.post(
    "/workspaces/{workspace_id}/investigate",
    response_model=InvestigationResponse,
)
async def investigate(
    workspace_id: str,
    body: InvestigationRequest,
    workspace: Workspace = Depends(check_workspace_access),
    current_user: User = Depends(get_current_user),
):
    """Run a multi-step investigation on a complex question.

    Decomposes the question into sub-questions, researches each one,
    and synthesizes a structured report with citations and trust scoring.
    """
    from app.graph.investigation import run_investigation

    logger.info(
        "investigation_api_started",
        query=body.query[:100],
        workspace_id=workspace_id,
        user_id=current_user.id,
    )

    # Run in threadpool to avoid event loop issues with sync code
    result = await asyncio.to_thread(
        run_investigation,
        query=body.query,
        workspace_id=workspace_id,
        user_id=current_user.id,
        top_k=body.top_k,
        filters=body.filters,
    )

    logger.info(
        "investigation_api_complete",
        trust_score=result.get("trust_score"),
        latency_ms=result.get("latency_ms"),
    )

    return InvestigationResponse(
        final_report=result.get("final_report", ""),
        trust_score=result.get("trust_score"),
        trust_components=result.get("trust_components", {}),
        reasoning_trace=result.get("reasoning_trace", []),
        sub_questions=result.get("sub_questions", []),
        latency_ms=result.get("latency_ms", 0),
        error=result.get("error"),
    )
