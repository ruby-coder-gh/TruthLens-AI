"""Document schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_serializer, model_validator

from app.schemas._datetime import utc_iso


class DocumentResponse(BaseModel):
    id: str
    workspace_id: str
    filename: str
    original_filename: str
    mime_type: str
    file_size: int
    page_count: int | None = None
    chunk_count: int = 0
    status: str
    error_message: str | None = None
    uploaded_by: str | None = None
    tags: list[str] = []
    created_at: datetime
    updated_at: datetime

    _serialize_created_at = field_serializer("created_at")(utc_iso)
    _serialize_updated_at = field_serializer("updated_at")(utc_iso)


class ChunkInfo(BaseModel):
    id: str
    index: int
    content: str
    token_count: int
    created_at: datetime

    _serialize_created_at = field_serializer("created_at")(utc_iso)


class DocumentDetailResponse(BaseModel):
    id: str
    workspace_id: str
    original_filename: str
    mime_type: str
    file_size: int
    page_count: int | None = None
    chunk_count: int
    status: str
    created_at: datetime
    updated_at: datetime
    chunks: list[ChunkInfo] = []

    _serialize_created_at = field_serializer("created_at")(utc_iso)
    _serialize_updated_at = field_serializer("updated_at")(utc_iso)


class DocumentStatusResponse(BaseModel):
    id: str
    status: str
    chunk_count: int = 0
    error_message: str | None = None


# ─── Bulk Document Operations (admin) ────────────────────────────────────────

MAX_BULK_DOCUMENT_IDS = 200


class BulkDocumentAction(BaseModel):
    """Request body for POST /admin/documents/bulk."""

    action: Literal["delete", "reindex", "tag", "untag"]
    document_ids: list[str] = Field(min_length=1, max_length=MAX_BULK_DOCUMENT_IDS)
    tags: list[str] | None = None

    @model_validator(mode="after")
    def _require_tags_for_tag_actions(self) -> "BulkDocumentAction":
        if self.action in ("tag", "untag"):
            cleaned = [t.strip() for t in (self.tags or []) if t.strip()]
            if not cleaned:
                raise ValueError("tags must be a non-empty list for tag/untag actions")
        return self


class BulkDocumentResult(BaseModel):
    id: str
    status: Literal["ok", "accepted", "failed"]
    error: str | None = None
    warning: str | None = None


class BulkDocumentSummary(BaseModel):
    ok: int = 0
    accepted: int = 0
    failed: int = 0


class BulkDocumentResponse(BaseModel):
    results: list[BulkDocumentResult]
    summary: BulkDocumentSummary
