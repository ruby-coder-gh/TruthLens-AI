"""Collection schemas."""
from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel

class CollectionCreate(BaseModel):
    name: str
    description: str | None = None

class CollectionUpdate(BaseModel):
    name: str | None = None
    description: str | None = None

class CollectionResponse(BaseModel):
    id: str
    workspace_id: str
    name: str
    description: str | None = None
    created_by: str
    document_count: int = 0
    created_at: datetime
    updated_at: datetime | None = None

class CollectionAccessGrant(BaseModel):
    user_id: str

class CollectionAccessResponse(BaseModel):
    id: str
    collection_id: str
    user_id: str
