"""Document model."""

from __future__ import annotations

from datetime import datetime
from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import DeclarativeBase, TimestampMixin, UUIDPkMixin


class Document(UUIDPkMixin, TimestampMixin, DeclarativeBase):
    __tablename__ = "documents"

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(512), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(128), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending", index=True
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    collection_id: Mapped[str | None] = mapped_column(ForeignKey("collections.id", ondelete="SET NULL"), nullable=True, index=True)
    indexed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list, server_default="[]")
    quarantined_chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Relationships
    workspace = relationship("Workspace", back_populates="documents", lazy="selectin")
    uploader = relationship("User", back_populates="documents_uploaded", lazy="selectin")
    chunks = relationship("Chunk", back_populates="document", lazy="selectin", cascade="all, delete-orphan")
    # Default lazy loading ("select", i.e. no `lazy=` kwarg) keeps
    # `cascade="all, delete-orphan"` working (confirmed empirically: 0
    # orphan rows after `session.delete(doc)`) without eagerly loading every
    # quarantined chunk's full `content` on every Document fetch (workspace
    # list, list-all, search, single-doc). Only `lazy="noload"` breaks the
    # cascade (a "noload" collection is never populated, so nothing gets
    # cascaded); `selectin` works too but needlessly over-fetches on every
    # read path, which is exactly what this relationship must not do.
    quarantines = relationship(
        "ChunkQuarantine", back_populates="document", cascade="all, delete-orphan"
    )
    collection = relationship("Collection", back_populates="documents", lazy="selectin")
    comparison_results = relationship("ComparisonResult", back_populates="document", lazy="selectin", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_docs_workspace", "workspace_id"),
        Index("idx_docs_status", "status"),
    )

    def __repr__(self) -> str:
        return f"<Document(id={self.id}, filename={self.original_filename}, status={self.status})>"
