"""Schemas for versioned prompts and the eval-gated promotion flow."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_serializer, field_validator

from app.schemas._datetime import utc_iso

PromptStatus = Literal["draft", "staged", "active", "retired"]
EvalSubset = Literal["smoke", "full"]

MAX_PROMPT_CONTENT_CHARS = 20_000


class PromptVersionCreate(BaseModel):
    name: str = Field(default="answer", min_length=1, max_length=64)
    content: str = Field(min_length=1, max_length=MAX_PROMPT_CONTENT_CHARS)
    model_name: str | None = Field(default=None, max_length=64)
    notes: str | None = Field(default=None, max_length=10_000)

    @field_validator("content")
    @classmethod
    def _reject_blank_content(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("content must not be blank")
        return stripped

    @field_validator("name")
    @classmethod
    def _normalise_name(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("name must not be blank")
        return stripped


class PromptEvalSummary(BaseModel):
    """The linked golden-set run, as shown next to a version in the admin table."""

    id: str
    status: str
    subset: str | None = None
    model_used: str | None = None
    golden_set_version: str | None = None
    faithfulness: float | None = None
    context_precision: float | None = None
    context_recall: float | None = None
    answer_relevance: float | None = None
    answer_correctness: float | None = None
    refusal_accuracy: float | None = None
    trust: float | None = None
    verdict: dict[str, Any] | None = None
    run_at: datetime

    _serialize_run_at = field_serializer("run_at")(utc_iso)


class PromptVersionResponse(BaseModel):
    id: str
    name: str
    version: int
    content: str
    content_hash: str
    status: str
    model_name: str | None = None
    created_by: str | None = None
    promoted_at: datetime | None = None
    eval_run_id: str | None = None
    notes: str | None = None
    created_at: datetime
    updated_at: datetime
    eval: PromptEvalSummary | None = None

    _serialize_promoted_at = field_serializer("promoted_at")(utc_iso)
    _serialize_created_at = field_serializer("created_at")(utc_iso)
    _serialize_updated_at = field_serializer("updated_at")(utc_iso)


class ActivePromptResponse(BaseModel):
    """The prompt generation will actually use for `name` right now."""

    name: str
    content: str
    content_hash: str
    model_name: str | None = None
    version: int | None = None
    version_id: str | None = None
    is_default: bool


class PromptDiffResponse(BaseModel):
    from_id: str | None = None
    from_label: str
    to_id: str
    to_label: str
    diff: str


class PromptEvalQueued(BaseModel):
    eval_run_id: str
    prompt_version_id: str
    subset: str
    status: str
