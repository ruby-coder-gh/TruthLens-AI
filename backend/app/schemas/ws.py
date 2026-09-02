"""WebSocket message schemas."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


class WSQueryPayload(BaseModel):
    workspace_id: str
    query: str
    top_k: int = 5
    filters: dict[str, Any] | None = None
    force_refresh: bool = False


class WSCancelPayload(BaseModel):
    pass


class WSResumePayload(BaseModel):
    """Client -> server: resume a stream after a reconnect.

    Sent after `auth_success`. `last_seq` is the highest `seq` the client has
    already rendered (0 = replay everything still buffered).
    """

    query_id: str
    last_seq: int = 0


class WSResumedPayload(BaseModel):
    """Server -> client: sent once the replay for a `resume` has been flushed.

    Emitted inside the sink's replay lock, so it is guaranteed to arrive after
    every replayed frame and before any live frame of the resumed stream.

    `live` is True when the stream is still running and now delivers to this
    socket; False when the buffer was already complete (nothing more follows).
    """

    query_id: str
    from_seq: int
    replayed: int
    live: bool


class WSCancelAckPayload(BaseModel):
    """Server -> client: `cancel` arrived with no query running.

    A no-op cancel (e.g. Stop pressed on unmount after the stream finished) is
    acknowledged rather than treated as an error, and leaves the buffer
    resumable. When a query *is* cancelled the server still sends the
    `CANCELLED` error frame instead.
    """

    query_id: str | None = None
    cancelled: bool = False


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
    from_cache: bool = False


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
    """Envelope for one WebSocket frame.

    `seq` is a monotonic, gapless, 1-based counter scoped to a single `query_id`,
    stamped by `app.api.stream_registry.StreamSink` on every frame that belongs
    to a query stream (ack, progress, sources, token, stream_end, guardrail,
    trust_score, complete, and that stream's error frames). It is what a client
    replays from via the `resume` opcode.

    Connection-level frames — `auth_success`, `resumed`, and errors raised before
    a stream exists (UNAUTHORIZED, INVALID_INPUT, FORBIDDEN, RESUME_UNAVAILABLE)
    — carry no `seq`.
    """

    type: str
    payload: dict[str, Any]
    seq: int | None = None
