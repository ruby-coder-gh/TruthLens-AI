"""Workspace routes: /api/workspaces/*"""

from __future__ import annotations

import json

from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import APIRouter, Depends

from app.core.deps import check_workspace_access, check_workspace_owner, get_current_user, get_db
from app.core.exceptions import ConflictException, ForbiddenException, NotFoundException
from app.models.audit_log import AuditLog
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.schemas.common import ListResponse, MessageResponse
from app.schemas.workspace import (
    MemberAdd,
    MemberResponse,
    MemberUpdate,
    WorkspaceCreate,
    WorkspaceResponse,
    WorkspaceSummary,
    WorkspaceUpdate,
)
from app.utils.logger import logger

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

    summaries = []
    for ws in all_workspaces:
        # Count members
        m_count = await db.execute(
            select(func.count(WorkspaceMember.id)).where(WorkspaceMember.workspace_id == ws.id)
        )
        member_count = m_count.scalar() or 0

        # Count documents
        d_count = await db.execute(
            select(func.count()).select_from(type(ws).__table__).where(Workspace.id == ws.id)
        )
        from app.models.document import Document
        doc_count = await db.execute(
            select(func.count(Document.id)).where(Document.workspace_id == ws.id)
        )
        document_count = doc_count.scalar() or 0

        summaries.append(WorkspaceSummary(
            id=ws.id,
            name=ws.name,
            description=ws.description,
            owner_id=ws.owner_id,
            member_count=member_count,
            document_count=document_count,
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
    # Check user exists
    result = await db.execute(select(User).where(User.id == body.user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise NotFoundException("User", body.user_id)

    # Check not already member
    result = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.user_id == body.user_id,
        )
    )
    if result.scalar_one_or_none():
        raise ConflictException("User is already a member")

    member = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=body.user_id,
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
        details=json.dumps({"added_user_id": body.user_id, "role": body.role}),
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
        select(WorkspaceMember)
        .where(WorkspaceMember.workspace_id == workspace.id)
        .order_by(WorkspaceMember.joined_at)
    )
    members = result.scalars().all()

    member_responses = []
    for m in members:
        user_result = await db.execute(select(User).where(User.id == m.user_id))
        user = user_result.scalar_one_or_none()
        member_responses.append(MemberResponse(
            id=m.id,
            workspace_id=m.workspace_id,
            user_id=m.user_id,
            role=m.role,
            username=user.username if user else None,
            email=user.email if user else None,
            joined_at=m.joined_at,
        ))

    return ListResponse(data=member_responses)
