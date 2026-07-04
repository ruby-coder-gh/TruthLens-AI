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


# ─── Comparison Schemas ──────────────────────────────────────────────────────


class ComparisonSource(BaseModel):
    """Source chunk used in a comparison result."""

    chunk_id: str
    document_id: str
    document_name: str
    excerpt: str
    relevance_score: float
    rerank_score: float | None = None
    confidence: float | None = None
    matched_chunks: int | None = None


class ComparisonResultResponse(BaseModel):
    """Per-document result in a comparison."""

    id: str
    document_id: str
    document_name: str
    answer_text: str
    sources: list[ComparisonSource]
    trust_score: float | None
    stance: str  # "supports" | "contradicts" | "silent"
    created_at: datetime


class ComparisonSummary(BaseModel):
    """Summary item for comparison history list."""

    id: str
    workspace_id: str
    question: str
    document_count: int
    agreement_score: float | None
    trust_score: float | None
    created_at: datetime


class ComparisonResponse(BaseModel):
    """Full comparison detail response."""

    id: str
    workspace_id: str
    question: str
    document_ids: list[str]
    synthesis_text: str | None
    agreement_score: float | None
    trust_score: float | None
    results: list[ComparisonResultResponse]
    created_at: datetime


class ComparisonCreateRequest(BaseModel):
    """Request to create a new comparison."""

    question: str
    document_ids: list[str]


class ComparisonCreateResponse(BaseModel):
    """Response after creating a comparison (async)."""

    comparison_id: str
    status: str  # "processing" | "completed" | "failed"
