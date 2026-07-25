"""Workspace + WorkspaceMember models."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import DeclarativeBase, TimestampMixin, UUIDPkMixin


class Workspace(UUIDPkMixin, TimestampMixin, DeclarativeBase):
    __tablename__ = "workspaces"

    name: Mapped[str] = mapped_column(String(256), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1024), default="")
    owner_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    document_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    review_queue_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")

    # Relationships
    owner = relationship("User", back_populates="workspaces_owned", lazy="selectin")
    members = relationship("WorkspaceMember", back_populates="workspace", lazy="selectin", cascade="all, delete-orphan")
    documents = relationship("Document", back_populates="workspace", lazy="selectin", cascade="all, delete-orphan")
    queries = relationship("Query", back_populates="workspace", lazy="selectin", cascade="all, delete-orphan")
    collections = relationship("Collection", back_populates="workspace", lazy="selectin", cascade="all, delete-orphan")
    comparisons = relationship("Comparison", back_populates="workspace", lazy="selectin", cascade="all, delete-orphan")
    query_pins = relationship("QueryPin", back_populates="workspace", lazy="selectin", cascade="all, delete-orphan")
    annotations = relationship("Annotation", back_populates="workspace", lazy="selectin", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<Workspace(id={self.id}, name={self.name})>"


class WorkspaceMember(UUIDPkMixin, DeclarativeBase):
    __tablename__ = "workspace_members"

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="viewer")
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    workspace = relationship("Workspace", back_populates="members", lazy="selectin")
    user = relationship("User", back_populates="workspace_memberships", lazy="selectin")

    __table_args__ = (
        UniqueConstraint("workspace_id", "user_id", name="uq_workspace_user"),
        Index("idx_wm_workspace", "workspace_id"),
        Index("idx_wm_user", "user_id"),
    )

    def __repr__(self) -> str:
        return f"<WorkspaceMember(ws={self.workspace_id}, user={self.user_id}, role={self.role})>"
