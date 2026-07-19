"""Per-user saved query pins."""

from __future__ import annotations

from sqlalchemy import ForeignKey, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import DeclarativeBase, TimestampMixin, UUIDPkMixin


class QueryPin(UUIDPkMixin, TimestampMixin, DeclarativeBase):
    """A private organizational pin for a query history item.

    Pins are deliberately per-user rather than shared across a workspace: one
    member's personal working set must not alter another member's history view.
    """

    __tablename__ = "query_pins"

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    query_id: Mapped[str] = mapped_column(
        ForeignKey("queries.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    query = relationship("Query", back_populates="pins", lazy="selectin")
    user = relationship("User", back_populates="query_pins", lazy="selectin")
    workspace = relationship("Workspace", back_populates="query_pins", lazy="selectin")

    __table_args__ = (
        UniqueConstraint("user_id", "query_id", name="uq_query_pins_user_query"),
        Index("idx_query_pins_user_workspace", "user_id", "workspace_id"),
    )

    def __repr__(self) -> str:
        return f"<QueryPin(query={self.query_id}, user={self.user_id})>"
