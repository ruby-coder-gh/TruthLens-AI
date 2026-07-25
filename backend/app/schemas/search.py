"""Global cross-workspace search schemas."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class SearchResult(BaseModel):
    id: str
    resource_type: Literal["query", "document"]
    workspace_id: str
    workspace_name: str
    title: str
    snippet: str
    score: float


class SearchResponseMeta(BaseModel):
    page: int
    page_size: int
    total: int
    workspace_count: int
    per_workspace_limit: int
