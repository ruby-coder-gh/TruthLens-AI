"""Schemas for durable investigation cases and analyst review."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_serializer

from app.schemas._datetime import utc_iso


class InvestigationRequest(BaseModel):
    """Body for an investigation; workspace identity is always supplied by the URL."""

    query: str = Field(min_length=1, max_length=20_000)
    top_k: int = Field(default=10, ge=1, le=50)
    filters: dict[str, Any] | None = None


class InvestigationReviewUpdate(BaseModel):
    """A durable reviewer disposition for a case."""

    review_status: Literal["draft", "in_review", "approved", "needs_changes"]
    review_note: str | None = Field(default=None, max_length=10_000)


class InvestigationSummary(BaseModel):
    id: str
    workspace_id: str
    query: str
    trust_score: float | None = None
    review_status: str
    created_at: datetime
    updated_at: datetime

    _serialize_created_at = field_serializer("created_at")(utc_iso)
    _serialize_updated_at = field_serializer("updated_at")(utc_iso)


class InvestigationResponse(BaseModel):
    """An immutable report snapshot plus its current review metadata."""

    id: str
    workspace_id: str
    query: str
    final_report: str
    trust_score: float | None = None
    trust_components: dict[str, Any] = Field(default_factory=dict)
    reasoning_trace: list[dict[str, Any]] = Field(default_factory=list)
    sub_questions: list[dict[str, Any]] = Field(default_factory=list)
    latency_ms: int = 0
    error: str | None = None
    review_status: str = "draft"
    review_note: str | None = None
    reviewed_by: str | None = None
    reviewed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    _serialize_created_at = field_serializer("created_at")(utc_iso)
    _serialize_updated_at = field_serializer("updated_at")(utc_iso)
    _serialize_reviewed_at = field_serializer("reviewed_at")(utc_iso)
