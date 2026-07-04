"""FastAPI dependencies: get_db, get_current_user, check_workspace_access."""

from __future__ import annotations

from typing import AsyncGenerator

from uuid import UUID

from fastapi import Depends, Header, HTTPException, WebSocket
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth import decode_token
from app.core.exceptions import ForbiddenException, NotFoundException, UnauthorizedException
from app.database import async_session_factory
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember


def _validate_uuid(uuid_str: str) -> None:
    """Raise 422 if uuid_str is not a valid UUID."""
    try:
        UUID(uuid_str)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Invalid UUID format: {uuid_str}")


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Yield DB session with commit/rollback handling."""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def get_current_user(
    authorization: str = Header(None),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Extract and validate current user from JWT Bearer token."""
    if not authorization:
        raise UnauthorizedException(message="Missing authorization header")

    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise UnauthorizedException(message="Invalid authorization format")

    token = parts[1]
    payload = decode_token(token)

    if payload.get("type") != "access":
        raise UnauthorizedException(message="Invalid token type")

    user_id = payload.get("sub")
    if not user_id:
        raise UnauthorizedException(message="Invalid token payload")

    result = await db.execute(select(User).where(User.id == user_id, User.is_active == True))
    user = result.scalar_one_or_none()
    if not user:
        raise UnauthorizedException(message="User not found or inactive")

    return user


async def get_current_user_ws(
    websocket: WebSocket,
    db: AsyncSession = Depends(get_db),
) -> User:
    """Extract current user from WebSocket query param token."""
    token = websocket.query_params.get("token")
    if not token:
        raise UnauthorizedException(message="Missing token")

    payload = decode_token(token)
    if payload.get("type") != "access":
        raise UnauthorizedException(message="Invalid token type")

    user_id = payload.get("sub")
    if not user_id:
        raise UnauthorizedException(message="Invalid token payload")

    result = await db.execute(select(User).where(User.id == user_id, User.is_active == True))
    user = result.scalar_one_or_none()
    if not user:
        raise UnauthorizedException(message="User not found or inactive")

    return user


async def get_current_admin(
    current_user: User = Depends(get_current_user),
) -> User:
    """Ensure current user has admin role."""
    if current_user.role != "admin":
        raise ForbiddenException(message="Admin access required")
    return current_user


async def check_workspace_access(
    workspace_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Workspace:
    """Check user has access to workspace (owner or member). Returns workspace."""
    _validate_uuid(workspace_id)
    result = await db.execute(
        select(Workspace).where(Workspace.id == workspace_id)
    )
    workspace = result.scalar_one_or_none()
    if not workspace:
        raise NotFoundException("Workspace", workspace_id)

    # Owner always has access
    if workspace.owner_id == user.id:
        return workspace

    # Check membership
    result = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user.id,
        )
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise ForbiddenException(message="You don't have access to this workspace")

    return workspace


async def check_workspace_owner(
    workspace_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Workspace:
    """Ensure current user is the workspace owner."""
    _validate_uuid(workspace_id)
    result = await db.execute(
        select(Workspace).where(Workspace.id == workspace_id)
    )
    workspace = result.scalar_one_or_none()
    if not workspace:
        raise NotFoundException("Workspace", workspace_id)
    if workspace.owner_id != user.id:
        raise ForbiddenException(message="Only workspace owner can perform this action")
    return workspace
