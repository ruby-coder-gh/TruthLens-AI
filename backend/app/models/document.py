"""Document model."""

from __future__ import annotations

from sqlalchemy import ForeignKey, Index, Integer, String, Text
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

    # Relationships
    workspace = relationship("Workspace", back_populates="documents", lazy="selectin")
    uploader = relationship("User", back_populates="documents_uploaded", lazy="selectin")
    chunks = relationship("Chunk", back_populates="document", lazy="selectin", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_docs_workspace", "workspace_id"),
        Index("idx_docs_status", "status"),
    )

    def __repr__(self) -> str:
        return f"<Document(id={self.id}, filename={self.original_filename}, status={self.status})>"
