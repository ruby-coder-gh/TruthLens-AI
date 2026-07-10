"""Tests for core dependencies: get_current_user, check_workspace_access, etc."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token, create_refresh_token
from app.core.deps import get_current_user, check_workspace_access, check_workspace_owner, get_current_admin
from app.core.exceptions import ForbiddenException, NotFoundException, UnauthorizedException
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember


# ── get_current_user ────────────────────────────────────────────

class TestGetCurrentUser:
    """Test get_current_user dependency."""

    async def _call(self, authorization: str | None, db: AsyncSession) -> User:
        """Helper to invoke get_current_user."""
        return await get_current_user(authorization=authorization, db=db)

    async def test_valid_token(self, test_db: AsyncSession, test_user: User):
        """Valid bearer token returns user."""
        token = create_access_token(test_user.id, test_user.role)
        user = await self._call(f"Bearer {token}", test_db)
        assert user.id == test_user.id
        assert user.email == test_user.email

    async def test_missing_header(self, test_db: AsyncSession):
        """Missing credentials (no header, no cookie) raises 401."""
        with pytest.raises(UnauthorizedException) as exc:
            await self._call(None, test_db)
        # Cookie-auth refactor: credentials may come from header OR cookie, so the
        # message refers to the missing auth token rather than the header alone.
        assert "Missing authentication token" in str(exc.value.message)

    async def test_empty_header(self, test_db: AsyncSession):
        """Empty authorization (and no cookie) raises 401."""
        with pytest.raises(UnauthorizedException) as exc:
            await self._call("", test_db)
        assert "Missing authentication token" in str(exc.value.message)

    async def test_bad_format(self, test_db: AsyncSession):
        """Non-Bearer format raises 401."""
        with pytest.raises(UnauthorizedException) as exc:
            await self._call("Token abc123", test_db)
        assert "Invalid authorization format" in str(exc.value.message)

    async def test_missing_bearer_prefix(self, test_db: AsyncSession):
        """Missing Bearer prefix raises 401."""
        with pytest.raises(UnauthorizedException) as exc:
            await self._call("abc123", test_db)
        assert "Invalid authorization format" in str(exc.value.message)

    async def test_refresh_token_rejected(self, test_db: AsyncSession, test_user: User):
        """Refresh token rejected for access."""
        token = create_refresh_token(test_user.id)
        with pytest.raises(UnauthorizedException) as exc:
            await self._call(f"Bearer {token}", test_db)
        assert "Invalid token type" in str(exc.value.message)

    async def test_inactive_user(self, test_db: AsyncSession, test_user: User):
        """Inactive user raises 401."""
        test_user.is_active = False
        await test_db.flush()
        token = create_access_token(test_user.id, test_user.role)
        with pytest.raises(UnauthorizedException) as exc:
            await self._call(f"Bearer {token}", test_db)
        assert "not found or inactive" in str(exc.value.message)

    async def test_nonexistent_user(self, test_db: AsyncSession):
        """Token for deleted user raises 401."""
        token = create_access_token("nonexistent-id", "user")
        with pytest.raises(UnauthorizedException) as exc:
            await self._call(f"Bearer {token}", test_db)
        assert "not found or inactive" in str(exc.value.message)


# ── get_current_admin ───────────────────────────────────────────

class TestGetCurrentAdmin:
    """Test get_current_admin dependency."""

    async def test_admin_user(self, test_db: AsyncSession, admin_user: User):
        """Admin user passes."""
        result = await get_current_admin(current_user=admin_user)
        assert result.id == admin_user.id

    async def test_non_admin_raises(self, test_db: AsyncSession, test_user: User):
        """Non-admin user raises 403."""
        with pytest.raises(ForbiddenException) as exc:
            await get_current_admin(current_user=test_user)
        assert "Admin access required" in str(exc.value.message)


# ── check_workspace_access ──────────────────────────────────────

class TestCheckWorkspaceAccess:
    """Test check_workspace_access dependency."""

    async def test_owner_access(self, test_db: AsyncSession, test_user: User):
        """Owner has access to own workspace."""
        ws = Workspace(name="Owner WS", owner_id=test_user.id)
        test_db.add(ws)
        await test_db.flush()
        await test_db.refresh(ws)

        result = await check_workspace_access(ws.id, test_user, test_db)
        assert result.id == ws.id

    async def test_member_access(self, test_db: AsyncSession, test_user: User):
        """Member has access to workspace."""
        # Create workspace owned by another user
        owner = User(
            email="wsowner@example.com",
            username="wsowner",
            password_hash="hash",
            role="user",
            is_active=True,
        )
        test_db.add(owner)
        await test_db.flush()
        await test_db.refresh(owner)

        ws = Workspace(name="Member WS", owner_id=owner.id)
        test_db.add(ws)
        await test_db.flush()
        await test_db.refresh(ws)

        # Add test_user as member
        member = WorkspaceMember(
            workspace_id=ws.id,
            user_id=test_user.id,
            role="editor",
        )
        test_db.add(member)
        await test_db.flush()

        result = await check_workspace_access(ws.id, test_user, test_db)
        assert result.id == ws.id

    async def test_non_member_denied(self, test_db: AsyncSession, test_user: User):
        """User without membership cannot access."""
        owner = User(
            email="otherws@example.com",
            username="otherws",
            password_hash="hash",
            role="user",
            is_active=True,
        )
        test_db.add(owner)
        await test_db.flush()
        await test_db.refresh(owner)

        ws = Workspace(name="Restricted WS", owner_id=owner.id)
        test_db.add(ws)
        await test_db.flush()
        await test_db.refresh(ws)

        with pytest.raises(ForbiddenException) as exc:
            await check_workspace_access(ws.id, test_user, test_db)
        assert "don't have access" in str(exc.value.message)

    async def test_workspace_not_found(self, test_db: AsyncSession, test_user: User):
        """Valid-format but non-existent workspace id raises 404."""
        missing_id = "00000000-0000-0000-0000-000000000000"
        with pytest.raises(NotFoundException) as exc:
            await check_workspace_access(missing_id, test_user, test_db)
        assert "not found" in str(exc.value.message)

    async def test_workspace_malformed_id(self, test_db: AsyncSession, test_user: User):
        """Malformed (non-UUID) workspace id raises 422 before any lookup."""
        with pytest.raises(HTTPException) as exc:
            await check_workspace_access("bad-id", test_user, test_db)
        assert exc.value.status_code == 422


# ── check_workspace_owner ───────────────────────────────────────

class TestCheckWorkspaceOwner:
    """Test check_workspace_owner dependency."""

    async def test_owner_passes(self, test_db: AsyncSession, test_user: User):
        """Owner passes check."""
        ws = Workspace(name="Owner Check WS", owner_id=test_user.id)
        test_db.add(ws)
        await test_db.flush()
        await test_db.refresh(ws)

        result = await check_workspace_owner(ws.id, test_user, test_db)
        assert result.id == ws.id

    async def test_non_owner_fails(self, test_db: AsyncSession, test_user: User):
        """Non-owner raises 403."""
        owner = User(
            email="realowner@example.com",
            username="realowner",
            password_hash="hash",
            role="user",
            is_active=True,
        )
        test_db.add(owner)
        await test_db.flush()
        await test_db.refresh(owner)

        ws = Workspace(name="Owner Only WS", owner_id=owner.id)
        test_db.add(ws)
        await test_db.flush()
        await test_db.refresh(ws)

        with pytest.raises(ForbiddenException) as exc:
            await check_workspace_owner(ws.id, test_user, test_db)
        assert "Only workspace owner" in str(exc.value.message)

    async def test_workspace_not_found(self, test_db: AsyncSession, test_user: User):
        """Valid-format but non-existent workspace id raises 404."""
        missing_id = "00000000-0000-0000-0000-000000000000"
        with pytest.raises(NotFoundException) as exc:
            await check_workspace_owner(missing_id, test_user, test_db)
        assert "not found" in str(exc.value.message)

    async def test_workspace_malformed_id(self, test_db: AsyncSession, test_user: User):
        """Malformed (non-UUID) workspace id raises 422 before any lookup."""
        with pytest.raises(HTTPException) as exc:
            await check_workspace_owner("bad-id", test_user, test_db)
        assert exc.value.status_code == 422
