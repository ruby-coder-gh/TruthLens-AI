"""Common shared schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class ErrorResponse(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None


class PaginatedResponse(BaseModel, Generic[T]):
    data: list[T]
    meta: dict[str, Any]


class ListResponse(BaseModel, Generic[T]):
    data: list[T]


class MessageResponse(BaseModel):
    message: str


class AdminStatsResponse(BaseModel):
    total_users: int
    total_workspaces: int
    total_documents: int
    total_queries: int
    total_chunks: int
    avg_trust_score: float | None = None
    avg_rating: float | None = None
    total_feedback: int


class AuditLogResponse(BaseModel):
    id: str
    user_id: str | None = None
    action: str
    resource_type: str
    resource_id: str | None = None
    details: dict[str, Any] | None = None
    ip_address: str | None = None
    created_at: datetime


class EvaluationResponse(BaseModel):
    faithfulness: float | None = None
    answer_relevance: float | None = None
    context_precision: float | None = None
    context_recall: float | None = None
    answer_correctness: float | None = None
    last_updated: datetime | None = None
