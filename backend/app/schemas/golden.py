"""Schemas for review-queue -> golden-set promotion."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_serializer

from app.schemas._datetime import utc_iso

GoldenCategory = Literal["answerable", "unanswerable", "ambiguous"]
GoldenSource = Literal["builtin", "promoted"]
# A promotion is a proposal until an admin approves it; only `approved` rows
# are loaded into an eval run. Builtin entries are `approved` by definition.
GoldenStatus = Literal["pending", "approved"]


class GoldenPromoteRequest(BaseModel):
    """Reviewer input when turning a reviewed answer into a golden entry."""

    category: GoldenCategory
    # Defaults to the query's response_text; supplied when the reviewer corrected it.
    reference_answer: str | None = Field(default=None, max_length=20_000)
    difficulty: int = Field(default=1, ge=1, le=3)
    notes: str | None = Field(default=None, max_length=2_000)


class GoldenEntryResponse(BaseModel):
    id: str
    question: str
    reference_answer: str
    source_documents: list[str] = Field(default_factory=list)
    expected_grounding: bool
    category: str
    difficulty: int
    notes: str | None = None
    source: GoldenSource = "promoted"
    status: GoldenStatus = "pending"
    approved_by: str | None = None
    approved_at: datetime | None = None
    source_query_id: str | None = None
    workspace_id: str | None = None
    created_by: str | None = None
    created_at: datetime | None = None

    _serialize_datetimes = field_serializer("approved_at", "created_at")(utc_iso)

    @classmethod
    def from_row(cls, row: Any) -> "GoldenEntryResponse":
        """Shape a promoted ``golden_entries`` row into the public contract.

        Duck-typed on purpose so this schema module stays free of model imports.
        """
        return cls(
            id=row.id,
            question=row.question,
            reference_answer=row.reference_answer,
            source_documents=list(row.source_documents or []),
            expected_grounding=bool(row.expected_grounding),
            category=row.category,
            difficulty=row.difficulty,
            notes=row.notes,
            source="promoted",
            status=row.status,
            approved_by=row.approved_by,
            approved_at=row.approved_at,
            source_query_id=row.source_query_id,
            workspace_id=row.workspace_id,
            created_by=row.created_by,
            created_at=row.created_at,
        )
