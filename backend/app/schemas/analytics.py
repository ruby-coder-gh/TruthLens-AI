"""Analytics schemas for admin dashboard."""
from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel

class FlaggedAnswerResponse(BaseModel):
    id: str
    query_text: str
    response_text: str | None = None
    trust_score: float | None = None
    user_name: str | None = None
    workspace_name: str | None = None
    created_at: datetime

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
