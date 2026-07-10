"""Feedback schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, field_serializer, field_validator

from app.schemas._datetime import utc_iso


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

    _serialize_created_at = field_serializer("created_at")(utc_iso)
