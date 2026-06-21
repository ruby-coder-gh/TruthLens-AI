"""Collection + CollectionAccess models."""
from __future__ import annotations
from sqlalchemy import ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import DeclarativeBase, TimestampMixin, UUIDPkMixin

class Collection(UUIDPkMixin, TimestampMixin, DeclarativeBase):
    __tablename__ = "collections"
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1024), default="")
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    # Relationships
    workspace = relationship("Workspace", back_populates="collections", lazy="selectin")
    creator = relationship("User", lazy="selectin")
    access_entries = relationship("CollectionAccess", back_populates="collection", lazy="selectin", cascade="all, delete-orphan")
    documents = relationship("Document", back_populates="collection", lazy="selectin")
    __table_args__ = (Index("idx_collections_workspace", "workspace_id"),)

class CollectionAccess(UUIDPkMixin, DeclarativeBase):
    __tablename__ = "collection_access"
    collection_id: Mapped[str] = mapped_column(ForeignKey("collections.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # Relationships
    collection = relationship("Collection", back_populates="access_entries", lazy="selectin")
    user = relationship("User", lazy="selectin")
    __table_args__ = (
        UniqueConstraint("collection_id", "user_id", name="uq_collection_user"),
        Index("idx_ca_collection", "collection_id"),
        Index("idx_ca_user", "user_id"),
    )
