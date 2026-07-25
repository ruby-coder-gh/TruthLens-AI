"""Schemas for query-answer comparisons."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.schemas.query import QueryDetailResponse, SourceResponse


class QuerySourceDiff(BaseModel):
    new_sources: list[SourceResponse] = Field(default_factory=list)
    dropped_sources: list[SourceResponse] = Field(default_factory=list)
    shared_sources: list[SourceResponse] = Field(default_factory=list)


class QueryComparisonResponse(BaseModel):
    original: QueryDetailResponse
    rerun: QueryDetailResponse
    trust_score_delta: float | None = None
    source_diff: QuerySourceDiff
    trust_components: dict[str, Any] = Field(default_factory=dict)
