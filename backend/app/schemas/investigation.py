"""Investigation schemas."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class InvestigationRequest(BaseModel):
    """Request to run an investigation."""
    query: str
    workspace_id: str
    top_k: int = 10
    filters: dict[str, Any] | None = None


class SubQuestionResult(BaseModel):
    """Result of a sub-question investigation."""
    id: str
    question: str
    purpose: str
    partial_answer: str
    citations: list[dict[str, Any]] = []
    trust_score: float | None = None
    guardrail_passed: bool = True
    latency_ms: int = 0


class ReasoningStepResult(BaseModel):
    """A step in the reasoning trace."""
    phase: str
    title: str
    description: str
    details: dict[str, Any] = {}
    timestamp_ms: int = 0


class InvestigationResponse(BaseModel):
    """Response from an investigation."""
    final_report: str
    trust_score: float | None = None
    trust_components: dict[str, Any] = {}
    reasoning_trace: list[dict[str, Any]] = []
    sub_questions: list[dict[str, Any]] = []
    latency_ms: int = 0
    error: str | None = None
