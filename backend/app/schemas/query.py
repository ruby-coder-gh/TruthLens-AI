"""Query schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel


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


class QuerySummary(BaseModel):
    id: str
    workspace_id: str
    query_text: str
    trust_score: float | None = None
    guardrail_passed: bool | None = None
    model_used: str | None = None
    created_at: datetime


class SourceResponse(BaseModel):
    chunk_id: str
    document_id: str
    document_name: str | None = None
    excerpt: str
    relevance_score: float = 0.0
    rerank_score: float | None = None
    page_number: int | None = None


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
