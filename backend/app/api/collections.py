"""Collection routes: /api/workspaces/{id}/collections/*"""

from __future__ import annotations

import json

from sqlalchemy import or_, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import APIRouter, Depends

from app.core.deps import check_workspace_access, get_current_user, get_db
from app.core.exceptions import ConflictException, ForbiddenException, NotFoundException
from app.models.collection import Collection, CollectionAccess
from app.models.document import Document
from app.models.user import User
from app.models.workspace import Workspace
from app.models.audit_log import AuditLog
from app.schemas.collection import (
    CollectionCreate,
    CollectionUpdate,
    CollectionResponse,
    CollectionAccessGrant,
    CollectionAccessResponse,
)
from app.schemas.common import ListResponse, MessageResponse

router = APIRouter(tags=["collections"])


@router.post("/workspaces/{workspace_id}/collections", response_model=CollectionResponse, status_code=201)
async def create_collection(
    workspace_id: str,
    body: CollectionCreate,
    workspace: Workspace = Depends(check_workspace_access),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create collection in workspace (workspace member)."""
    collection = Collection(
        workspace_id=workspace_id,
        name=body.name,
        description=body.description or "",
        created_by=current_user.id,
    )
    db.add(collection)
    await db.flush()
    await db.refresh(collection)

    db.add(AuditLog(
        user_id=current_user.id,
        action="collection.create",
        resource_type="collection",
        resource_id=collection.id,
        details=json.dumps({"name": collection.name, "workspace_id": workspace_id}),
    ))

    return CollectionResponse(
        id=collection.id,
        workspace_id=collection.workspace_id,
        name=collection.name,
        description=collection.description,
        created_by=collection.created_by,
        document_count=0,
        created_at=collection.created_at,
        updated_at=collection.updated_at,
    )


@router.get("/workspaces/{workspace_id}/collections", response_model=ListResponse[CollectionResponse])
async def list_collections(
    workspace_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List collections user has access to in workspace."""
    # Created by user OR has explicit CollectionAccess entry
    query = select(Collection).where(
        Collection.workspace_id == workspace_id,
        or_(
            Collection.created_by == current_user.id,
            select(CollectionAccess.id)
            .where(
                CollectionAccess.collection_id == Collection.id,
                CollectionAccess.user_id == current_user.id,
            )
            .exists(),
        ),
    )
    result = await db.execute(query.order_by(Collection.created_at.desc()))
    collections = result.scalars().all()

    responses = []
    for c in collections:
        doc_count = await db.execute(
            select(func.count(Document.id)).where(Document.collection_id == c.id)
        )
        responses.append(CollectionResponse(
            id=c.id,
            workspace_id=c.workspace_id,
            name=c.name,
            description=c.description,
            created_by=c.created_by,
            document_count=doc_count.scalar() or 0,
            created_at=c.created_at,
            updated_at=c.updated_at,
        ))

    return ListResponse(data=responses)


@router.get("/workspaces/{workspace_id}/collections/{collection_id}", response_model=CollectionResponse)
async def get_collection(
    workspace_id: str,
    collection_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get collection detail."""
    result = await db.execute(
        select(Collection).where(Collection.id == collection_id, Collection.workspace_id == workspace_id)
    )
    collection = result.scalar_one_or_none()
    if not collection:
        raise NotFoundException("Collection", collection_id)

    # Check access: creator or has access entry
    if collection.created_by != current_user.id:
        access_result = await db.execute(
            select(CollectionAccess).where(
                CollectionAccess.collection_id == collection_id,
                CollectionAccess.user_id == current_user.id,
            )
        )
        if not access_result.scalar_one_or_none():
            raise ForbiddenException("You don't have access to this collection")

    doc_count = await db.execute(
        select(func.count(Document.id)).where(Document.collection_id == collection_id)
    )

    return CollectionResponse(
        id=collection.id,
        workspace_id=collection.workspace_id,
        name=collection.name,
        description=collection.description,
        created_by=collection.created_by,
        document_count=doc_count.scalar() or 0,
        created_at=collection.created_at,
        updated_at=collection.updated_at,
    )


@router.put("/workspaces/{workspace_id}/collections/{collection_id}", response_model=CollectionResponse)
async def update_collection(
    workspace_id: str,
    collection_id: str,
    body: CollectionUpdate,
    workspace: Workspace = Depends(check_workspace_access),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update collection (workspace owner or collection creator)."""
    result = await db.execute(
        select(Collection).where(Collection.id == collection_id, Collection.workspace_id == workspace_id)
    )
    collection = result.scalar_one_or_none()
    if not collection:
        raise NotFoundException("Collection", collection_id)

    # Only workspace owner or collection creator can update
    if workspace.owner_id != current_user.id and collection.created_by != current_user.id:
        raise ForbiddenException("Only workspace owner or collection creator can update")

    if body.name is not None:
        collection.name = body.name
    if body.description is not None:
        collection.description = body.description

    await db.flush()
    await db.refresh(collection)

    doc_count = await db.execute(
        select(func.count(Document.id)).where(Document.collection_id == collection_id)
    )

    return CollectionResponse(
        id=collection.id,
        workspace_id=collection.workspace_id,
        name=collection.name,
        description=collection.description,
        created_by=collection.created_by,
        document_count=doc_count.scalar() or 0,
        created_at=collection.created_at,
        updated_at=collection.updated_at,
    )


@router.delete("/workspaces/{workspace_id}/collections/{collection_id}", status_code=204)
async def delete_collection(
    workspace_id: str,
    collection_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete collection (workspace owner or collection creator)."""
    result = await db.execute(
        select(Collection).where(Collection.id == collection_id, Collection.workspace_id == workspace_id)
    )
    collection = result.scalar_one_or_none()
    if not collection:
        raise NotFoundException("Collection", collection_id)

    if workspace.owner_id != current_user.id and collection.created_by != current_user.id:
        raise ForbiddenException("Only workspace owner or collection creator can delete")

    db.add(AuditLog(
        user_id=current_user.id,
        action="collection.delete",
        resource_type="collection",
        resource_id=collection_id,
        details=json.dumps({"name": collection.name}),
    ))
    await db.delete(collection)


@router.post("/workspaces/{workspace_id}/collections/{collection_id}/access", response_model=CollectionAccessResponse, status_code=201)
async def grant_collection_access(
    workspace_id: str,
    collection_id: str,
    body: CollectionAccessGrant,
    workspace: Workspace = Depends(check_workspace_access),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Grant user access to collection (workspace owner or collection creator)."""
    result = await db.execute(
        select(Collection).where(Collection.id == collection_id, Collection.workspace_id == workspace_id)
    )
    collection = result.scalar_one_or_none()
    if not collection:
        raise NotFoundException("Collection", collection_id)

    if workspace.owner_id != current_user.id and collection.created_by != current_user.id:
        raise ForbiddenException("Only workspace owner or collection creator can grant access")

    # Check target user exists
    user_result = await db.execute(select(User).where(User.id == body.user_id))
    if not user_result.scalar_one_or_none():
        raise NotFoundException("User", body.user_id)

    # Check not already granted
    existing = await db.execute(
        select(CollectionAccess).where(
            CollectionAccess.collection_id == collection_id,
            CollectionAccess.user_id == body.user_id,
        )
    )
    if existing.scalar_one_or_none():
        raise ConflictException("User already has access to this collection")

    access = CollectionAccess(
        collection_id=collection_id,
        user_id=body.user_id,
    )
    db.add(access)
    await db.flush()
    await db.refresh(access)

    return CollectionAccessResponse(
        id=access.id,
        collection_id=access.collection_id,
        user_id=access.user_id,
    )


@router.delete("/workspaces/{workspace_id}/collections/{collection_id}/access/{user_id}", status_code=204)
async def revoke_collection_access(
    workspace_id: str,
    collection_id: str,
    user_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Revoke user access to collection (workspace owner or collection creator)."""
    result = await db.execute(
        select(Collection).where(Collection.id == collection_id, Collection.workspace_id == workspace_id)
    )
    collection = result.scalar_one_or_none()
    if not collection:
        raise NotFoundException("Collection", collection_id)

    if workspace.owner_id != current_user.id and collection.created_by != current_user.id:
        raise ForbiddenException("Only workspace owner or collection creator can revoke access")

    access_result = await db.execute(
        select(CollectionAccess).where(
            CollectionAccess.collection_id == collection_id,
            CollectionAccess.user_id == user_id,
        )
    )
    access = access_result.scalar_one_or_none()
    if not access:
        raise NotFoundException("Access entry", user_id)

    await db.delete(access)


@router.get("/workspaces/{workspace_id}/collections/{collection_id}/access", response_model=ListResponse[CollectionAccessResponse])
async def list_collection_access(
    workspace_id: str,
    collection_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List access entries for collection (workspace owner or collection creator)."""
    result = await db.execute(
        select(Collection).where(Collection.id == collection_id, Collection.workspace_id == workspace_id)
    )
    collection = result.scalar_one_or_none()
    if not collection:
        raise NotFoundException("Collection", collection_id)

    if workspace.owner_id != current_user.id and collection.created_by != current_user.id:
        raise ForbiddenException("Only workspace owner or collection creator can view access")

    access_result = await db.execute(
        select(CollectionAccess).where(CollectionAccess.collection_id == collection_id)
    )
    entries = access_result.scalars().all()

    return ListResponse(data=[
        CollectionAccessResponse(
            id=e.id,
            collection_id=e.collection_id,
            user_id=e.user_id,
        )
        for e in entries
    ])
