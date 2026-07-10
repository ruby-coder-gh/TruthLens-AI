"""Document schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, field_serializer

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
