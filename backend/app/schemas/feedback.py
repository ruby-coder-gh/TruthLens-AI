"""Feedback schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, field_validator


class FeedbackCreate(BaseModel):
    rating: int
    comment: str | None = None

    @field_validator("rating")
    @classmethod
    def validate_rating(cls, v: int) -> int:
        if v < 1 or v > 5:
            raise ValueError("Rating must be between 1 and 5")
        return v


class FeedbackResponse(BaseModel):
    id: str
    query_id: str
    user_id: str | None = None
    rating: int
    comment: str | None = None
    created_at: datetime
