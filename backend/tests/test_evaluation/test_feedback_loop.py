"""Tests for evaluation/feedback_loop.py — ingest_feedback, get_feedback_stats."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.evaluation.feedback_loop import ingest_feedback, get_feedback_stats
from app.models.feedback import Feedback
from app.models.query import Query


class TestIngestFeedback:
    """Test feedback ingestion."""

    async def test_ingest_basic(self, test_db: AsyncSession):
        """Ingest feedback returns feedback object."""
        # Create a query first
        query = Query(
            workspace_id="ws-ingest-1",
            user_id="user-1",
            query_text="test query",
            response_text="test response",
            trust_score=0.8,
        )
        test_db.add(query)
        await test_db.flush()
        await test_db.refresh(query)

        fb = await ingest_feedback(
            db=test_db,
            query_id=query.id,
            user_id="user-1",
            rating=4,
            comment="Good response",
        )
        assert fb.query_id == query.id
        assert fb.rating == 4
        assert fb.comment == "Good response"
        assert fb.id is not None

    async def test_ingest_without_comment(self, test_db: AsyncSession):
        """Ingest feedback without comment."""
        query = Query(
            workspace_id="ws-ingest-2",
            user_id="user-2",
            query_text="test",
            response_text="test",
        )
        test_db.add(query)
        await test_db.flush()
        await test_db.refresh(query)

        fb = await ingest_feedback(
            db=test_db,
            query_id=query.id,
            user_id="user-2",
            rating=5,
        )
        assert fb.rating == 5
        assert fb.comment is None

    async def test_ingest_without_user(self, test_db: AsyncSession):
        """Ingest feedback without user_id (anonymous)."""
        query = Query(
            workspace_id="ws-ingest-3",
            user_id="user-3",
            query_text="anonymous feedback",
            response_text="ok",
        )
        test_db.add(query)
        await test_db.flush()
        await test_db.refresh(query)

        fb = await ingest_feedback(
            db=test_db,
            query_id=query.id,
            user_id=None,
            rating=3,
        )
        assert fb.user_id is None
        assert fb.rating == 3


class TestGetFeedbackStats:
    """Test feedback statistics."""

    async def test_no_feedback(self, test_db: AsyncSession):
        """No feedback returns empty stats."""
        stats = await get_feedback_stats(test_db, "ws-empty", days=30)
        assert stats["avg_rating"] is None
        assert stats["total_count"] == 0
        assert stats["period_days"] == 30
        assert all(v == 0 for v in stats["distribution"].values())

    async def test_with_feedback(self, test_db: AsyncSession):
        """Feedback stats computed correctly."""
        ws_id = "ws-stats-1"

        # Create queries with feedback
        for i in range(5):
            query = Query(
                workspace_id=ws_id,
                user_id="user-stats",
                query_text=f"query {i}",
                response_text=f"response {i}",
            )
            test_db.add(query)
            await test_db.flush()
            await test_db.refresh(query)

            fb = Feedback(
                query_id=query.id,
                user_id="user-stats",
                rating=(i % 5) + 1,  # ratings 1-5
            )
            test_db.add(fb)
        await test_db.flush()

        stats = await get_feedback_stats(test_db, ws_id, days=30)
        assert stats["total_count"] == 5
        assert 1.0 <= stats["avg_rating"] <= 5.0
        assert stats["distribution"]["1"] == 1
        assert stats["distribution"]["5"] == 1

    async def test_feedback_outside_window(self, test_db: AsyncSession):
        """Old feedback excluded from window."""
        ws_id = "ws-window"

        query = Query(
            workspace_id=ws_id,
            user_id="user-window",
            query_text="old query",
            response_text="old",
        )
        test_db.add(query)
        await test_db.flush()
        await test_db.refresh(query)

        fb = Feedback(
            query_id=query.id,
            user_id="user-window",
            rating=5,
            created_at=datetime.now(timezone.utc) - timedelta(days=60),
        )
        test_db.add(fb)
        await test_db.flush()

        stats = await get_feedback_stats(test_db, ws_id, days=30)
        assert stats["total_count"] == 0
        assert stats["avg_rating"] is None

    async def test_multiple_ratings_distribution(self, test_db: AsyncSession):
        """Distribution counts correct for multiple ratings."""
        ws_id = "ws-dist"

        for rating_val in [5, 5, 4, 3, 1]:
            query = Query(
                workspace_id=ws_id,
                user_id="user-dist",
                query_text=f"q-{rating_val}",
                response_text=f"r-{rating_val}",
            )
            test_db.add(query)
            await test_db.flush()
            await test_db.refresh(query)

            fb = Feedback(
                query_id=query.id,
                user_id="user-dist",
                rating=rating_val,
            )
            test_db.add(fb)
        await test_db.flush()

        stats = await get_feedback_stats(test_db, ws_id, days=30)
        assert stats["total_count"] == 5
        assert stats["distribution"]["5"] == 2
        assert stats["distribution"]["4"] == 1
        assert stats["distribution"]["3"] == 1
        assert stats["distribution"]["2"] == 0
        assert stats["distribution"]["1"] == 1
        assert stats["avg_rating"] == (5 + 5 + 4 + 3 + 1) / 5
