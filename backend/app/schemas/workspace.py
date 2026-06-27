"""Workspace schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, field_validator


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


class WorkspaceResponse(BaseModel):
    id: str
    name: str
    description: str | None
    owner_id: str
    member_count: int = 0
    document_count: int = 0
    created_at: datetime
    updated_at: datetime


class MemberAdd(BaseModel):
    user_id: str
    role: str = "viewer"

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


class ActivityEntry(BaseModel):
    id: str
    type: str  # query | document_upload | member_joined | workspace_created
    description: str
    user_name: str | None = None
    timestamp: datetime
    metadata: dict[str, Any] | None = None
