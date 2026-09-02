"""Analytics schemas for admin dashboard."""
from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, field_serializer
from app.schemas._datetime import utc_iso

class FlaggedAnswerResponse(BaseModel):
    id: str
    query_text: str
    response_text: str | None = None
    trust_score: float | None = None
    user_name: str | None = None
    workspace_name: str | None = None
    created_at: datetime

    _serialize_created_at = field_serializer("created_at")(utc_iso)

class UsageStatsResponse(BaseModel):
    date: str
    query_count: int
    user_count: int

class TrustScoreDistribution(BaseModel):
    range: str  # "0-25", "26-50", "51-75", "76-100"
    count: int

class UserActivityResponse(BaseModel):
    id: str
    query_text: str
    trust_score: float | None = None
    created_at: datetime

    _serialize_created_at = field_serializer("created_at")(utc_iso)

class AdminSettingsResponse(BaseModel):
    app_name: str
    app_version: str
    max_upload_size_mb: int
    trust_score_high_threshold: float
    trust_score_low_threshold: float
    rate_limit_enabled: bool
    rate_limit_requests: int
    rate_limit_window_seconds: int

class AdminSettingsUpdate(BaseModel):
    max_upload_size_mb: int | None = None
    trust_score_high_threshold: float | None = None
    trust_score_low_threshold: float | None = None
    rate_limit_enabled: bool | None = None

class UsageRow(BaseModel):
    key: str
    label: str
    queries: int
    output_tokens: int
    prompt_tokens: int
    avg_latency_ms: float | None = None
    cache_hits: int
    est_cost_usd: float

class UsageTotals(BaseModel):
    queries: int
    output_tokens: int
    prompt_tokens: int
    avg_latency_ms: float | None = None
    cache_hits: int
    est_cost_usd: float

class UsageReportResponse(BaseModel):
    rows: list[UsageRow]
    totals: UsageTotals
    pricing_source: Literal["config", "none"]
    period: dict[str, str | None]

class PricingResponse(BaseModel):
    pricing: dict[str, dict[str, float]]

class EvalRunResponse(BaseModel):
    id: str
    run_at: datetime
    faithfulness: float | None = None
    context_precision: float | None = None
    context_recall: float | None = None
    answer_relevance: float | None = None
    answer_correctness: float | None = None
    refusal_accuracy: float | None = None
    golden_set_version: str | None = None
    notes: str | None = None

    _serialize_run_at = field_serializer("run_at")(utc_iso)
