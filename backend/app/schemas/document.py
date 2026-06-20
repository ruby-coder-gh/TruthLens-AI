"""Document schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


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


class ChunkInfo(BaseModel):
    id: str
    index: int
    content: str
    token_count: int
    created_at: datetime


class DocumentDetailResponse(BaseModel):
    id: str
    workspace_id: str
    original_filename: str
    mime_type: str
    file_size: int
    page_count: int | None = None
    chunk_count: int
    status: str
    chunks: list[ChunkInfo] = []


class DocumentStatusResponse(BaseModel):
    id: str
    status: str
    chunk_count: int = 0
    error_message: str | None = None
