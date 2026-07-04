"""Collection schemas."""
from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, model_validator

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
    user_id: str | None = None
    email: str | None = None

    @model_validator(mode='after')
    def validate_one_of(self):
        if not self.user_id and not self.email:
            raise ValueError('Either user_id or email must be provided')
        return self

class CollectionAccessResponse(BaseModel):
    id: str
    collection_id: str
    user_id: str
