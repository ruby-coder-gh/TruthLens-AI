"""Feedback routes: /api/queries/{query_id}/feedback/*"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import APIRouter, Depends

from app.core.deps import check_workspace_access, get_current_user, get_db
from app.core.exceptions import NotFoundException
from app.models.feedback import Feedback
from app.models.query import Query
from app.models.user import User
from app.schemas.common import ListResponse
from app.schemas.feedback import FeedbackCreate, FeedbackResponse

router = APIRouter(tags=["feedback"])


@router.post("/queries/{query_id}/feedback", response_model=FeedbackResponse, status_code=201)
async def submit_feedback(
    query_id: str,
    body: FeedbackCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Submit feedback/rating for a query."""
    # Check query exists
    query_result = await db.execute(select(Query).where(Query.id == query_id))
    query = query_result.scalar_one_or_none()
    if not query:
        raise NotFoundException("Query", query_id)

    # Verify workspace access
    await check_workspace_access(query.workspace_id, current_user, db)

    # Check if user already gave feedback
    feedback_result = await db.execute(
        select(Feedback).where(
            Feedback.query_id == query_id,
            Feedback.user_id == current_user.id,
        )
    )
    existing = feedback_result.scalar_one_or_none()
    if existing:
        # Update existing
        existing.rating = body.rating
        existing.comment = body.comment
        await db.flush()
        await db.refresh(existing)
        feedback = existing
    else:
        # Create new
        feedback = Feedback(
            query_id=query_id,
            user_id=current_user.id,
            rating=body.rating,
            comment=body.comment,
        )
        db.add(feedback)
        await db.flush()
        await db.refresh(feedback)

    return FeedbackResponse(
        id=feedback.id,
        query_id=feedback.query_id,
        user_id=feedback.user_id,
        rating=feedback.rating,
        comment=feedback.comment,
        created_at=feedback.created_at,
    )


@router.get("/queries/{query_id}/feedback", response_model=ListResponse[FeedbackResponse])
async def list_feedback(
    query_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List feedback for a query."""
    # Check query exists + workspace access
    query_result = await db.execute(select(Query).where(Query.id == query_id))
    query = query_result.scalar_one_or_none()
    if not query:
        raise NotFoundException("Query", query_id)
    await check_workspace_access(query.workspace_id, current_user, db)

    feedback_result = await db.execute(
        select(Feedback).where(Feedback.query_id == query_id).order_by(Feedback.created_at.desc())
    )
    feedbacks = feedback_result.scalars().all()

    return ListResponse(
        data=[
            FeedbackResponse(
                id=f.id,
                query_id=f.query_id,
                user_id=f.user_id,
                rating=f.rating,
                comment=f.comment,
                created_at=f.created_at,
            )
            for f in feedbacks
        ]
    )
