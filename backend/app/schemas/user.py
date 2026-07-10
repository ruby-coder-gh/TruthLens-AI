"""User schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, EmailStr, field_serializer

from app.schemas._datetime import utc_iso


class UserCreate(BaseModel):
    email: EmailStr
    username: str
    password: str


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    username: str | None = None
    password: str | None = None


class UserResponse(BaseModel):
    id: str
    email: str
    username: str
    role: str
    is_active: bool
    last_login_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    _serialize_last_login_at = field_serializer("last_login_at")(utc_iso)
    _serialize_created_at = field_serializer("created_at")(utc_iso)
    _serialize_updated_at = field_serializer("updated_at")(utc_iso)
