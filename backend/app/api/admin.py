"""Admin routes: /api/admin/*"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import APIRouter, Depends

from app.core.deps import get_current_admin, get_db
from app.models.audit_log import AuditLog
from app.models.document import Document
from app.models.feedback import Feedback
from app.models.query import Query
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.common import AdminStatsResponse, AuditLogResponse, EvaluationResponse, PaginatedResponse
from app.utils.logger import logger

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(get_current_admin)])


@router.get("/stats", response_model=AdminStatsResponse)
async def get_admin_stats(db: AsyncSession = Depends(get_db)):
    """Get system-wide metrics (admin only)."""
    # Counts
    users = await db.execute(select(func.count(User.id)))
    total_users = users.scalar() or 0

    workspaces = await db.execute(select(func.count(Workspace.id)))
    total_workspaces = workspaces.scalar() or 0

    docs = await db.execute(select(func.count(Document.id)))
    total_documents = docs.scalar() or 0

    queries = await db.execute(select(func.count(Query.id)))
    total_queries = queries.scalar() or 0

    feedback = await db.execute(select(func.count(Feedback.id)))
    total_feedback = feedback.scalar() or 0

    # Average trust score
    trust = await db.execute(
        select(func.avg(Query.trust_score)).where(Query.trust_score.isnot(None))
    )
    avg_trust = trust.scalar()

    # Average rating
    rating = await db.execute(
        select(func.avg(Feedback.rating))
    )
    avg_rating = rating.scalar()

    return AdminStatsResponse(
        total_users=total_users,
        total_workspaces=total_workspaces,
        total_documents=total_documents,
        total_queries=total_queries,
        total_chunks=0,  # Would need separate count
        avg_trust_score=round(float(avg_trust), 4) if avg_trust else None,
        avg_rating=round(float(avg_rating), 2) if avg_rating else None,
        total_feedback=total_feedback,
    )


@router.get("/logs", response_model=PaginatedResponse[AuditLogResponse])
async def get_audit_logs(
    page: int = 1,
    page_size: int = 50,
    action: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Get audit log entries (admin only)."""
    query = select(AuditLog)
    count_query = select(func.count(AuditLog.id))

    if action:
        query = query.where(AuditLog.action == action)
        count_query = count_query.where(AuditLog.action == action)

    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0

    offset = (page - 1) * page_size
    result = await db.execute(
        query.order_by(AuditLog.created_at.desc()).offset(offset).limit(page_size)
    )
    logs = result.scalars().all()

    return PaginatedResponse(
        data=[
            AuditLogResponse(
                id=log.id,
                user_id=log.user_id,
                action=log.action,
                resource_type=log.resource_type,
                resource_id=log.resource_id,
                details=json.loads(log.details) if log.details else None,
                ip_address=log.ip_address,
                created_at=log.created_at,
            )
            for log in logs
        ],
        meta={"page": page, "page_size": page_size, "total": total},
    )


@router.get("/evaluation", response_model=EvaluationResponse)
async def get_evaluation(db: AsyncSession = Depends(get_db)):
    """Get RAGAS evaluation scores (admin only)."""
    from app.evaluation.ragas_eval import RagasScores

    # Attempt to load cached evaluation results
    try:
        with open("data/evaluation_results.json") as f:
            data = json.load(f)
        return EvaluationResponse(
            faithfulness=data.get("faithfulness"),
            answer_relevance=data.get("answer_relevance"),
            context_precision=data.get("context_precision"),
            context_recall=data.get("context_recall"),
            answer_correctness=data.get("answer_correctness"),
            last_updated=datetime.fromisoformat(data["last_updated"]) if data.get("last_updated") else None,
        )
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        return EvaluationResponse()


@router.post("/evaluation/run", status_code=202)
async def run_evaluation(db: AsyncSession = Depends(get_db)):
    """Trigger RAGAS evaluation on golden dataset (admin only)."""
    from app.evaluation.ragas_eval import ragas_evaluate

    # Get sample queries with responses
    result = await db.execute(
        select(Query).where(
            Query.response_text.isnot(None),
            Query.trust_score.isnot(None),
        ).order_by(func.random()).limit(20)
    )
    queries = result.scalars().all()

    if not queries:
        return {"message": "No queries with responses found for evaluation"}

    q_texts = [q.query_text for q in queries]
    answers = [q.response_text or "" for q in queries]
    contexts = []
    for q in queries:
        try:
            sources = json.loads(q.response_sources or "[]")
            ctx = [s.get("excerpt", s.get("content", "")) for s in sources]
        except (json.JSONDecodeError, TypeError):
            ctx = []
        contexts.append(ctx)

    scores = await ragas_evaluate(q_texts, answers, contexts)

    # Cache results
    import json as json_mod

    results_data = {
        "faithfulness": scores.faithfulness,
        "answer_relevance": scores.answer_relevance,
        "context_precision": scores.context_precision,
        "context_recall": scores.context_recall,
        "answer_correctness": scores.answer_correctness,
        "last_updated": datetime.now(timezone.utc).isoformat(),
    }

    from pathlib import Path
    eval_path = Path("data/evaluation_results.json")
    eval_path.parent.mkdir(parents=True, exist_ok=True)
    with open(eval_path, "w") as f:
        json_mod.dump(results_data, f)

    logger.info("evaluation_run_complete", scores=vars(scores))
    return {"message": "Evaluation complete", "scores": vars(scores)}
