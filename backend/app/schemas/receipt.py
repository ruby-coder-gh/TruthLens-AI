"""Truth Receipt response schemas (lane L3)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, field_serializer

from app.schemas._datetime import utc_iso


class ReceiptCreateResponse(BaseModel):
    token: str
    url_path: str
    seal: str
    created_at: datetime

    _serialize_created_at = field_serializer("created_at")(utc_iso)


class ReceiptPublicResponse(BaseModel):
    payload: dict[str, Any]
    canonical: str
    seal: str
    seal_valid: bool
    signature_valid: bool
    issued_at: datetime
    revoked: bool

    _serialize_issued_at = field_serializer("issued_at")(utc_iso)


class ReceiptSummary(BaseModel):
    token: str
    url_path: str
    seal: str
    created_at: datetime
    revoked_at: datetime | None
    view_count: int

    _serialize_dates = field_serializer("created_at", "revoked_at")(utc_iso)
