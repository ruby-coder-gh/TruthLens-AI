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


# ─── Comparison WebSocket Schemas ────────────────────────────────────────────


class WSComparisonPayload(BaseModel):
    """Payload for starting a comparison."""
    workspace_id: str
    question: str
    document_ids: list[str]
    top_k: int = 5
    filters: dict[str, Any] | None = None


class WSComparisonDocResultPayload(BaseModel):
    """Per-document result in a comparison (streamed as each doc completes)."""
    comparison_id: str
    document_id: str
    document_name: str
    answer_text: str
    sources: list[WSSourceItem]
    trust_score: float | None
    guardrail_passed: bool
    guardrail_score: float


class WSComparisonSynthesisPayload(BaseModel):
    """Final synthesis result for a comparison."""
    comparison_id: str
    synthesis_text: str
    agreement_score: float
    trust_score: float
    per_doc_stances: dict[str, str]  # document_id -> "supports" | "contradicts" | "silent"


class WSComparisonProgressPayload(BaseModel):
    comparison_id: str
    phase: Literal["retrieval", "generation", "synthesis", "evaluation"]
    progress: float
    completed_docs: int
    total_docs: int


class WSMessage(BaseModel):
    type: str
    payload: dict[str, Any]
