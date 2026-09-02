"""Schemas for ingest-time prompt-injection quarantine (F7a)."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, field_serializer

from app.schemas._datetime import utc_iso

if TYPE_CHECKING:
    from app.models.chunk_quarantine import ChunkQuarantine

QuarantineStatus = Literal["quarantined", "released", "dismissed"]


class QuarantineChunkResponse(BaseModel):
    id: str
    workspace_id: str
    document_id: str
    document_name: str | None = None
    chunk_index: int
    content: str
    pattern: str | None = None
    severity: str | None = None
    status: QuarantineStatus
    reviewed_by: str | None = None
    reviewed_at: datetime | None = None
    created_at: datetime

    _serialize_created_at = field_serializer("created_at")(utc_iso)
    _serialize_reviewed_at = field_serializer("reviewed_at")(utc_iso)


class QuarantineActionResponse(BaseModel):
    id: str
    status: QuarantineStatus
    message: str


def to_quarantine_response(
    record: "ChunkQuarantine", document_name: str | None = None
) -> QuarantineChunkResponse:
    """Build the API response for a `ChunkQuarantine` row.

    `document_name` must be supplied by the caller (e.g. from an explicit
    `join(Document)` selecting only `Document.original_filename`) — this
    function deliberately never touches `record.document` (that relationship
    is `lazy="raise"`; walking it would also selectin-load every full chunk
    body for the document via `Document.chunks`).
    """
    return QuarantineChunkResponse(
        id=record.id,
        workspace_id=record.workspace_id,
        document_id=record.document_id,
        document_name=document_name,
        chunk_index=record.chunk_index,
        content=record.content,
        pattern=record.pattern,
        severity=record.severity,
        status=record.status,  # type: ignore[arg-type]
        reviewed_by=record.reviewed_by,
        reviewed_at=record.reviewed_at,
        created_at=record.created_at,
    )
