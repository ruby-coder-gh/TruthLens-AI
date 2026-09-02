"""Schemas for the confidence-based query review queue."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_serializer

from app.schemas._datetime import utc_iso
from app.schemas.golden import GoldenStatus

ReviewDisposition = Literal["needs_review", "reviewed", "dismissed"]


class ReviewQueueUpdate(BaseModel):
    review_status: ReviewDisposition
    review_note: str | None = Field(default=None, max_length=10_000)


class ReviewQueueSettingsUpdate(BaseModel):
    review_queue_enabled: bool


class ReviewQueueSettingsResponse(BaseModel):
    review_queue_enabled: bool


class ReviewQueueCountResponse(ReviewQueueSettingsResponse):
    count: int


class ReviewQueueItem(BaseModel):
    id: str
    workspace_id: str
    query_text: str
    response_text: str | None = None
    response_sources: list[dict[str, Any]] = Field(default_factory=list)
    trust_score: float | None = None
    trust_components: dict[str, Any] = Field(default_factory=dict)
    guardrail_score: float | None = None
    guardrail_passed: bool | None = None
    prompt_version: str | None = None
    review_status: ReviewDisposition
    review_note: str | None = None
    reviewed_by: str | None = None
    reviewed_at: datetime | None = None
    # Set when this answer has already been promoted to the golden set (F7b),
    # so the queue can show a "Golden" badge instead of offering promotion again.
    golden_entry_id: str | None = None
    # Approval state of that entry: "pending" until an admin approves it,
    # "approved" once it actually counts towards an eval run. None when the
    # answer has not been promoted.
    golden_status: GoldenStatus | None = None
    created_at: datetime

    _serialize_created_at = field_serializer("created_at")(utc_iso)
    _serialize_reviewed_at = field_serializer("reviewed_at")(utc_iso)
