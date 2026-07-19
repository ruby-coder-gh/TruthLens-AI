"""Schemas for collaborative answer/source annotations."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_serializer

from app.schemas._datetime import utc_iso


class AnnotationCreate(BaseModel):
    body: str = Field(min_length=1, max_length=10_000)
    source_id: str | None = Field(default=None, max_length=128)


class AnnotationUpdate(BaseModel):
    body: str = Field(min_length=1, max_length=10_000)


class AnnotationResponse(BaseModel):
    id: str
    workspace_id: str
    query_id: str | None = None
    source_id: str | None = None
    user_id: str | None = None
    author_name: str | None = None
    body: str | None = None
    is_deleted: bool = False
    can_edit: bool = False
    created_at: datetime
    updated_at: datetime

    _serialize_created_at = field_serializer("created_at")(utc_iso)
    _serialize_updated_at = field_serializer("updated_at")(utc_iso)


class AnnotationCountResponse(BaseModel):
    count: int
