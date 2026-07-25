"""Server-side refresh-token session management."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth import create_refresh_token
from app.models.refresh_token_session import RefreshTokenSession


class RefreshTokenSessionError(Exception):
    """The refresh JWT has no usable server-side session."""


class RefreshTokenReuseDetected(RefreshTokenSessionError):
    """A refresh JWT that was already consumed was presented again."""


def _utc(value: datetime) -> datetime:
    """Treat SQLite's timezone-naive datetime values as UTC."""
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


async def _issue_refresh_token(
    db: AsyncSession,
    *,
    user_id: str,
    expires_at: datetime | None = None,
) -> tuple[str, RefreshTokenSession]:
    """Create a session row and the JWT that references it."""
    expires_at = expires_at or (
        datetime.now(timezone.utc) + timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS)
    )
    session = RefreshTokenSession(user_id=user_id, expires_at=expires_at)
    db.add(session)
    await db.flush()
    return (
        create_refresh_token(
            user_id,
            session_id=session.id,
            expires_at=expires_at,
        ),
        session,
    )


async def issue_refresh_token(db: AsyncSession, *, user_id: str) -> str:
    """Issue a refresh JWT whose `jti` is backed by a live session row."""
    token, _ = await _issue_refresh_token(db, user_id=user_id)
    return token


async def rotate_refresh_token(
    db: AsyncSession,
    *,
    user_id: str,
    token_id: str,
) -> str:
    """Consume one refresh session and return its single-use replacement.

    ``FOR UPDATE`` makes the check-and-consume transition atomic on databases
    that support row locking (such as production PostgreSQL deployments).
    """
    result = await db.execute(
        select(RefreshTokenSession)
        .where(
            RefreshTokenSession.id == token_id,
            RefreshTokenSession.user_id == user_id,
        )
        .with_for_update()
    )
    session = result.scalar_one_or_none()
    if not session:
        raise RefreshTokenSessionError()

    if session.revoked_at is not None:
        raise RefreshTokenReuseDetected()

    if _utc(session.expires_at) <= datetime.now(timezone.utc):
        raise RefreshTokenSessionError()

    replacement_token, replacement_session = await _issue_refresh_token(
        db,
        user_id=user_id,
    )
    session.revoked_at = datetime.now(timezone.utc)
    session.revoked_reason = "rotated"
    session.replaced_by_id = replacement_session.id
    await db.flush()
    return replacement_token


async def revoke_refresh_token(
    db: AsyncSession,
    *,
    user_id: str,
    token_id: str,
    reason: str,
) -> bool:
    """Revoke one active session owned by ``user_id`` without exposing state."""
    result = await db.execute(
        update(RefreshTokenSession)
        .where(
            RefreshTokenSession.id == token_id,
            RefreshTokenSession.user_id == user_id,
            RefreshTokenSession.revoked_at.is_(None),
        )
        .values(revoked_at=datetime.now(timezone.utc), revoked_reason=reason)
    )
    return bool(result.rowcount)


async def revoke_all_refresh_tokens(
    db: AsyncSession,
    *,
    user_id: str,
    reason: str,
) -> int:
    """Revoke every currently active refresh session for one user."""
    result = await db.execute(
        update(RefreshTokenSession)
        .where(
            RefreshTokenSession.user_id == user_id,
            RefreshTokenSession.revoked_at.is_(None),
        )
        .values(revoked_at=datetime.now(timezone.utc), revoked_reason=reason)
    )
    return int(result.rowcount or 0)
