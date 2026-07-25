"""Persistent refresh-token sessions used for rotation and revocation."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import DeclarativeBase, TimestampMixin, UUIDPkMixin


class RefreshTokenSession(UUIDPkMixin, TimestampMixin, DeclarativeBase):
    """Server-side state for one refresh JWT.

    The JWT's ``jti`` equals this row's ``id``. The raw JWT is deliberately
    never persisted; signature validation plus this record is required before
    a refresh can mint new credentials.
    """

    __tablename__ = "refresh_token_sessions"

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    replaced_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    __table_args__ = (
        Index("idx_refresh_token_sessions_user_active", "user_id", "revoked_at"),
        Index("idx_refresh_token_sessions_expires_at", "expires_at"),
        Index("idx_refresh_token_sessions_replaced_by", "replaced_by_id"),
    )

    def __repr__(self) -> str:
        return (
            "<RefreshTokenSession("
            f"id={self.id}, user_id={self.user_id}, revoked={self.revoked_at is not None})>"
        )
