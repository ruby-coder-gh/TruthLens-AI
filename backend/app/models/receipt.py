"""Receipt model — a sealed, publicly-viewable snapshot of one query's answer.

Truth Receipt (lanes L3 backend / L4 frontend): `seal` is
sha256(canonical JSON, sort_keys, compact separators) and `signature` is
HMAC-SHA256(key derived from APP_SECRET_KEY, seal). Both are recomputed and
compared against the stored values whenever a receipt is read.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import DeclarativeBase, UUIDPkMixin


class Receipt(UUIDPkMixin, DeclarativeBase):
    __tablename__ = "receipts"

    token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    query_id: Mapped[str] = mapped_column(
        ForeignKey("queries.id", ondelete="CASCADE"), nullable=False, index=True
    )
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    payload: Mapped[str] = mapped_column(Text, nullable=False)  # JSON string
    canonical: Mapped[str] = mapped_column(Text, nullable=False)  # canonical JSON the seal was computed over
    seal: Mapped[str] = mapped_column(String(64), nullable=False)
    signature: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    view_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    # Relationships
    query = relationship("Query", back_populates="receipts", lazy="selectin")
    workspace = relationship("Workspace", back_populates="receipts", lazy="selectin")

    __table_args__ = (
        Index("idx_receipts_query", "query_id"),
        Index("idx_receipts_workspace", "workspace_id"),
    )

    def __repr__(self) -> str:
        return f"<Receipt(id={self.id}, token={self.token[:8]}...)>"
