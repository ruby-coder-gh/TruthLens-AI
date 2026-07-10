"""Workspace schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, field_serializer, field_validator, model_validator

from app.schemas._datetime import utc_iso


class WorkspaceCreate(BaseModel):
    name: str
    description: str | None = ""

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        if len(v) < 1 or len(v) > 256:
            raise ValueError("Name must be between 1 and 256 characters")
        return v.strip()


class WorkspaceUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class WorkspaceSummary(BaseModel):
    id: str
    name: str
    description: str | None
    owner_id: str
    member_count: int = 0
    document_count: int = 0
    created_at: datetime

    _serialize_created_at = field_serializer("created_at")(utc_iso)


class WorkspaceResponse(BaseModel):
    id: str
    name: str
    description: str | None
    owner_id: str
    member_count: int = 0
    document_count: int = 0
    created_at: datetime
    updated_at: datetime

    _serialize_created_at = field_serializer("created_at")(utc_iso)
    _serialize_updated_at = field_serializer("updated_at")(utc_iso)


class MemberAdd(BaseModel):
    user_id: str | None = None
    email: str | None = None
    role: str = "viewer"

    @model_validator(mode='after')
    def validate_one_of(self):
        if not self.user_id and not self.email:
            raise ValueError('Either user_id or email must be provided')
        return self

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in ("owner", "editor", "viewer"):
            raise ValueError("Role must be one of: owner, editor, viewer")
        return v


class MemberUpdate(BaseModel):
    role: str

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in ("owner", "editor", "viewer"):
            raise ValueError("Role must be one of: owner, editor, viewer")
        return v


class MemberResponse(BaseModel):
    id: str
    workspace_id: str
    user_id: str
    role: str
    username: str | None = None
    email: str | None = None
    joined_at: datetime

    _serialize_joined_at = field_serializer("joined_at")(utc_iso)


class ActivityEntry(BaseModel):
    id: str
    type: str  # query | document_upload | member_joined | workspace_created
    description: str
    user_name: str | None = None
    timestamp: datetime
    metadata: dict[str, Any] | None = None

    _serialize_timestamp = field_serializer("timestamp")(utc_iso)
