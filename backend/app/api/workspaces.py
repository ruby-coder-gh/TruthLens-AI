"""Workspace routes: /api/workspaces/*"""

from __future__ import annotations

import json

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import APIRouter, Depends

from app.core.deps import check_workspace_access, check_workspace_owner, get_current_user, get_db
from app.core.exceptions import ConflictException, ForbiddenException, InvalidInputException, NotFoundException
from app.models.audit_log import AuditLog
from app.models.document import Document
from app.models.query import Query
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.schemas.common import ListResponse
from app.schemas.workspace import (
    ActivityEntry,
    MemberAdd,
    MemberResponse,
    MemberUpdate,
    WorkspaceCreate,
    WorkspaceResponse,
    WorkspaceSummary,
    WorkspaceUpdate,
)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.post("", response_model=WorkspaceResponse, status_code=201)
async def create_workspace(
    body: WorkspaceCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new workspace (creator becomes owner)."""
    workspace = Workspace(
        name=body.name,
        description=body.description or "",
        owner_id=current_user.id,
    )
    db.add(workspace)
    await db.flush()
    await db.refresh(workspace)

    # Add creator as owner member
    member = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=current_user.id,
        role="owner",
    )
    db.add(member)

    # Audit log
    db.add(AuditLog(
        user_id=current_user.id,
        action="workspace.create",
        resource_type="workspace",
        resource_id=workspace.id,
    ))

    return WorkspaceResponse(
        id=workspace.id,
        name=workspace.name,
        description=workspace.description,
        owner_id=workspace.owner_id,
        member_count=1,
        document_count=0,
        created_at=workspace.created_at,
        updated_at=workspace.updated_at,
    )


@router.get("", response_model=ListResponse[WorkspaceSummary])
async def list_workspaces(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List user's workspaces (owned + member)."""
    # Owned workspaces
    owned = await db.execute(
        select(Workspace).where(Workspace.owner_id == current_user.id)
    )
    owned_workspaces = owned.scalars().all()

    # Member workspaces
    member_ws = await db.execute(
        select(Workspace)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(WorkspaceMember.user_id == current_user.id)
    )
    member_workspaces = member_ws.scalars().all()

    # Deduplicate
    seen = set()
    all_workspaces = []
    for ws in list(owned_workspaces) + list(member_workspaces):
        if ws.id not in seen:
            seen.add(ws.id)
            all_workspaces.append(ws)

    if not all_workspaces:
        return ListResponse(data=[])

    workspace_ids = [ws.id for ws in all_workspaces]

    member_counts_result = await db.execute(
        select(
            WorkspaceMember.workspace_id,
            func.count(WorkspaceMember.id),
        )
        .where(WorkspaceMember.workspace_id.in_(workspace_ids))
        .group_by(WorkspaceMember.workspace_id)
    )
    member_counts = {workspace_id: count for workspace_id, count in member_counts_result.all()}

    document_counts_result = await db.execute(
        select(
            Document.workspace_id,
            func.count(Document.id),
        )
        .where(Document.workspace_id.in_(workspace_ids))
        .group_by(Document.workspace_id)
    )
    document_counts = {workspace_id: count for workspace_id, count in document_counts_result.all()}

    summaries = []
    for ws in all_workspaces:
        summaries.append(WorkspaceSummary(
            id=ws.id,
            name=ws.name,
            description=ws.description,
            owner_id=ws.owner_id,
            member_count=member_counts.get(ws.id, 0),
            document_count=document_counts.get(ws.id, 0),
            created_at=ws.created_at,
        ))

    return ListResponse(data=summaries)


@router.get("/{workspace_id}", response_model=WorkspaceResponse)
async def get_workspace(
    workspace: Workspace = Depends(check_workspace_access),
    db: AsyncSession = Depends(get_db),
):
    """Get workspace details."""
    m_count = await db.execute(
        select(func.count(WorkspaceMember.id)).where(WorkspaceMember.workspace_id == workspace.id)
    )
    member_count = m_count.scalar() or 0

    from app.models.document import Document
    d_count = await db.execute(
        select(func.count(Document.id)).where(Document.workspace_id == workspace.id)
    )
    document_count = d_count.scalar() or 0

    return WorkspaceResponse(
        id=workspace.id,
        name=workspace.name,
        description=workspace.description,
        owner_id=workspace.owner_id,
        member_count=member_count,
        document_count=document_count,
        created_at=workspace.created_at,
        updated_at=workspace.updated_at,
    )


@router.put("/{workspace_id}", response_model=WorkspaceResponse)
async def update_workspace(
    body: WorkspaceUpdate,
    workspace: Workspace = Depends(check_workspace_owner),
    db: AsyncSession = Depends(get_db),
):
    """Update workspace (owner only)."""
    if body.name is not None:
        workspace.name = body.name
    if body.description is not None:
        workspace.description = body.description

    await db.flush()
    await db.refresh(workspace)

    return WorkspaceResponse(
        id=workspace.id,
        name=workspace.name,
        description=workspace.description,
        owner_id=workspace.owner_id,
        member_count=0,
        document_count=0,
        created_at=workspace.created_at,
        updated_at=workspace.updated_at,
    )


@router.delete("/{workspace_id}", status_code=204)
async def delete_workspace(
    workspace: Workspace = Depends(check_workspace_owner),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete workspace (owner only). Cascades documents."""
    # Remove from ChromaDB
    from app.ingestion.indexer import delete_workspace as delete_index
    await delete_index(workspace.id)

    db.add(AuditLog(
        user_id=current_user.id,
        action="workspace.delete",
        resource_type="workspace",
        resource_id=workspace.id,
    ))
    await db.delete(workspace)


@router.post("/{workspace_id}/members", response_model=MemberResponse, status_code=201)
async def add_member(
    body: MemberAdd,
    workspace: Workspace = Depends(check_workspace_owner),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add member to workspace (owner only)."""
    if not body.user_id and not body.email:
        raise InvalidInputException("Either user_id or email must be provided")

    # Resolve user_id from email if needed
    user_id = body.user_id
    if not user_id and body.email:
        result = await db.execute(select(User).where(User.email == body.email))
        user = result.scalar_one_or_none()
        if not user:
            raise NotFoundException("User", body.email)
        user_id = user.id

    # Check user exists
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise NotFoundException("User", user_id)

    # Check not already member
    result = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.user_id == user_id,
        )
    )
    if result.scalar_one_or_none():
        raise ConflictException("User is already a member")

    member = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=user_id,
        role=body.role,
    )
    db.add(member)
    await db.flush()
    await db.refresh(member)

    db.add(AuditLog(
        user_id=current_user.id,
        action="workspace.add_member",
        resource_type="workspace_member",
        resource_id=member.id,
        details=json.dumps({"added_user_id": user_id, "role": body.role}),
    ))

    return MemberResponse(
        id=member.id,
        workspace_id=member.workspace_id,
        user_id=member.user_id,
        role=member.role,
        username=user.username,
        email=user.email,
        joined_at=member.joined_at,
    )


@router.put("/{workspace_id}/members/{user_id}", response_model=MemberResponse)
async def update_member_role(
    user_id: str,
    body: MemberUpdate,
    workspace: Workspace = Depends(check_workspace_owner),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update member role (owner only)."""
    result = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.user_id == user_id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise NotFoundException("Member", user_id)

    if member.role == "owner":
        raise ForbiddenException("Cannot change owner's role")

    member.role = body.role
    await db.flush()
    await db.refresh(member)

    # Get user info
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()

    return MemberResponse(
        id=member.id,
        workspace_id=member.workspace_id,
        user_id=member.user_id,
        role=member.role,
        username=user.username if user else None,
        email=user.email if user else None,
        joined_at=member.joined_at,
    )


@router.delete("/{workspace_id}/members/{user_id}", status_code=204)
async def remove_member(
    user_id: str,
    workspace: Workspace = Depends(check_workspace_owner),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove member from workspace (owner only)."""
    result = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.user_id == user_id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise NotFoundException("Member", user_id)

    if member.role == "owner":
        raise ForbiddenException("Cannot remove workspace owner")

    db.add(AuditLog(
        user_id=current_user.id,
        action="workspace.remove_member",
        resource_type="workspace_member",
        resource_id=member.id,
        details=json.dumps({"removed_user_id": user_id}),
    ))
    await db.delete(member)


@router.get("/{workspace_id}/members", response_model=ListResponse[MemberResponse])
async def list_members(
    workspace: Workspace = Depends(check_workspace_access),
    db: AsyncSession = Depends(get_db),
):
    """List workspace members."""
    result = await db.execute(
        select(WorkspaceMember, User)
        .outerjoin(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == workspace.id)
        .order_by(WorkspaceMember.joined_at)
    )
    rows = result.all()

    member_responses = [
        MemberResponse(
            id=member.id,
            workspace_id=member.workspace_id,
            user_id=member.user_id,
            role=member.role,
            username=user.username if user else None,
            email=user.email if user else None,
            joined_at=member.joined_at,
        )
        for member, user in rows
    ]

    return ListResponse(data=member_responses)


@router.get("/{workspace_id}/activity", response_model=ListResponse[ActivityEntry])
async def get_workspace_activity(
    workspace_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    db: AsyncSession = Depends(get_db),
):
    """Get unified activity feed for a workspace (queries, uploads, member events)."""
    activity: list[ActivityEntry] = []

    # Recent queries (with user info)
    result = await db.execute(
        select(Query, User)
        .outerjoin(User, Query.user_id == User.id)
        .where(Query.workspace_id == workspace_id)
        .order_by(Query.created_at.desc())
        .limit(20)
    )
    for query, user in result:
        activity.append(ActivityEntry(
            id=f"q_{query.id}",
            type="query",
            description=f"Asked: {query.query_text[:150]}",
            user_name=user.username if user else None,
            timestamp=query.created_at,
            metadata={"trust_score": query.trust_score} if query.trust_score else None,
        ))

    # Recent document uploads (with user info)
    result = await db.execute(
        select(Document, User)
        .outerjoin(User, Document.uploaded_by == User.id)
        .where(Document.workspace_id == workspace_id)
        .order_by(Document.created_at.desc())
        .limit(20)
    )
    for doc, user in result:
        activity.append(ActivityEntry(
            id=f"d_{doc.id}",
            type="document_upload",
            description=f"Uploaded: {doc.original_filename or doc.filename}",
            user_name=user.username if user else None,
            timestamp=doc.created_at,
            metadata={"status": doc.status, "size": doc.file_size},
        ))

    # Workspace creation event
    activity.append(ActivityEntry(
        id=f"ws_{workspace.id}",
        type="workspace_created",
        description=f"Created workspace: {workspace.name}",
        user_name=None,
        timestamp=workspace.created_at,
    ))

    # Sort by timestamp descending
    activity.sort(key=lambda a: a.timestamp, reverse=True)

    return ListResponse(data=activity[:50])
