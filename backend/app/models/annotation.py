"""Collaborative annotations on query answers and cited sources."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import DeclarativeBase, TimestampMixin, UUIDPkMixin


class Annotation(UUIDPkMixin, TimestampMixin, DeclarativeBase):
    """A durable comment on a query answer or one of its cited source chunks.

    ``source_id`` is a snapshot reference rather than a foreign key because
    evidence snapshots can outlive a re-ingested or removed Chunk. The route
    validates it against the query's persisted cited sources before saving.
    """

    __tablename__ = "annotations"

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    query_id: Mapped[str | None] = mapped_column(
        ForeignKey("queries.id", ondelete="SET NULL"), nullable=True, index=True
    )
    source_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    deleted_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    query = relationship("Query", back_populates="annotations", lazy="selectin")
    author = relationship("User", back_populates="annotations_authored", lazy="selectin", foreign_keys=[user_id])
    deleter = relationship("User", back_populates="annotations_deleted", lazy="selectin", foreign_keys=[deleted_by])
    workspace = relationship("Workspace", back_populates="annotations", lazy="selectin")

    __table_args__ = (
        Index("idx_annotations_workspace_query", "workspace_id", "query_id", "created_at"),
        Index("idx_annotations_query_source", "query_id", "source_id"),
    )

    def __repr__(self) -> str:
        return f"<Annotation(id={self.id}, query={self.query_id}, source={self.source_id})>"
