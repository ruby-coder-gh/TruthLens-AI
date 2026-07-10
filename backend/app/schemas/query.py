"""Query schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, field_serializer

from app.schemas._datetime import utc_iso


class QueryRequest(BaseModel):
    query: str
    workspace_id: str
    top_k: int = 5
    filters: dict[str, Any] | None = None


class QueryResponse(BaseModel):
    id: str
    workspace_id: str
    query_text: str
    rewritten_query: str | None = None
    response_text: str | None = None
    response_sources: list[dict[str, Any]] = []
    trust_score: float | None = None
    guardrail_score: float | None = None
    guardrail_passed: bool | None = None
    model_used: str | None = None
    latency_ms: int | None = None
    token_count: int | None = None
    created_at: datetime

    _serialize_created_at = field_serializer("created_at")(utc_iso)


class QuerySummary(BaseModel):
    id: str
    workspace_id: str
    query_text: str
    trust_score: float | None = None
    guardrail_passed: bool | None = None
    model_used: str | None = None
    created_at: datetime

    _serialize_created_at = field_serializer("created_at")(utc_iso)


class SourceResponse(BaseModel):
    chunk_id: str
    document_id: str
    document_name: str | None = None
    excerpt: str
    relevance_score: float = 0.0
    rerank_score: float | None = None
    page_number: int | None = None
    confidence: float | None = None
    matched_chunks: int | None = None
    explanation: str | None = None
    updated_at: str | None = None
    file_type: str | None = None


class QueryDetailResponse(BaseModel):
    id: str
    workspace_id: str
    query_text: str
    rewritten_query: str | None = None
    response_text: str | None = None
    response_sources: list[dict[str, Any]] = []
    trust_score: float | None = None
    guardrail_score: float | None = None
    guardrail_passed: bool | None = None
    model_used: str | None = None
    latency_ms: int | None = None
    token_count: int | None = None
    created_at: datetime

    _serialize_created_at = field_serializer("created_at")(utc_iso)
