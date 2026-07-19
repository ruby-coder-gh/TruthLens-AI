"""Schemas for private query pins."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, field_serializer

from app.schemas._datetime import utc_iso


class QueryPinResponse(BaseModel):
    id: str
    workspace_id: str
    query_id: str
    user_id: str
    created_at: datetime

    _serialize_created_at = field_serializer("created_at")(utc_iso)
