"""WebSocket message schemas."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


class WSQueryPayload(BaseModel):
    workspace_id: str
    query: str
    top_k: int = 5
    filters: dict[str, Any] | None = None


class WSCancelPayload(BaseModel):
    pass


class WSFeedbackPayload(BaseModel):
    query_id: str
    rating: int
    comment: str | None = None


class WSTokenPayload(BaseModel):
    query_id: str
    token: str
    index: int


class WSSourceItem(BaseModel):
    chunk_id: str
    document_id: str
    document_name: str | None = None
    excerpt: str
    relevance_score: float = 0.0
    rerank_score: float | None = None
    page_number: int | None = None


class WSSourcesPayload(BaseModel):
    query_id: str
    sources: list[WSSourceItem]


class WSGuardrailPayload(BaseModel):
    query_id: str
    passed: bool
    score: float
    details: str = ""


class WSTrustScorePayload(BaseModel):
    query_id: str
    score: float
    components: dict[str, float]


class WSCompletePayload(BaseModel):
    query_id: str
    latency_ms: int
    model_used: str
    token_count: int


class WSErrorPayload(BaseModel):
    code: str
    message: str
    query_id: str | None = None


class WSProgressPayload(BaseModel):
    query_id: str
    phase: Literal["retrieval", "generation", "guardrail", "evaluation"]
    progress: float


class WSAckPayload(BaseModel):
    query_id: str
    status: str = "processing"


class WSStreamEndPayload(BaseModel):
    query_id: str


class WSMessage(BaseModel):
    type: str
    payload: dict[str, Any]
