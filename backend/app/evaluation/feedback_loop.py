"""Feedback ingestion — store and trigger re-evaluation."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feedback import Feedback
from app.models.query import Query
from app.utils.logger import logger


async def ingest_feedback(
    db: AsyncSession,
    query_id: str,
    user_id: str | None,
    rating: int,
    comment: str | None = None,
) -> Feedback:
    """Store feedback in database.

    Args:
        db: DB session.
        query_id: Query UUID.
        user_id: User UUID (optional).
        rating: Rating 1-5.
        comment: Optional comment.

    Returns:
        Created Feedback object.
    """
    feedback = Feedback(
        query_id=query_id,
        user_id=user_id,
        rating=rating,
        comment=comment,
    )
    db.add(feedback)
    await db.flush()
    await db.refresh(feedback)

    logger.info(
        "feedback_ingested",
        query_id=query_id,
        rating=rating,
        has_comment=bool(comment),
    )
    return feedback


async def get_feedback_stats(
    db: AsyncSession,
    workspace_id: str,
    days: int = 30,
) -> dict[str, Any]:
    """Get feedback statistics for a workspace.

    Args:
        db: DB session.
        workspace_id: Workspace UUID.
        days: Lookback window in days.

    Returns:
        Dict with avg_rating, distribution, trends.
    """
    from datetime import datetime, timedelta, timezone

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    # Get all feedback for queries in this workspace
    result = await db.execute(
        select(Feedback)
        .join(Query, Feedback.query_id == Query.id)
        .where(
            Query.workspace_id == workspace_id,
            Feedback.created_at >= cutoff,
        )
    )
    feedbacks = result.scalars().all()

    if not feedbacks:
        return {
            "avg_rating": None,
            "total_count": 0,
            "distribution": {str(i): 0 for i in range(1, 6)},
            "period_days": days,
        }

    ratings = [f.rating for f in feedbacks]
    avg_rating = sum(ratings) / len(ratings)

    distribution: dict[str, int] = {}
    for r in range(1, 6):
        distribution[str(r)] = sum(1 for f in feedbacks if f.rating == r)

    return {
        "avg_rating": round(avg_rating, 2),
        "total_count": len(feedbacks),
        "distribution": distribution,
        "period_days": days,
    }
