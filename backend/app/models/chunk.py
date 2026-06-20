"""Chunk model."""

from __future__ import annotations

from sqlalchemy import ForeignKey, Index, Integer, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import DeclarativeBase, TimestampMixin, UUIDPkMixin


class Chunk(UUIDPkMixin, TimestampMixin, DeclarativeBase):
    __tablename__ = "chunks"

    document_id: Mapped[str] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Relationships
    document = relationship("Document", back_populates="chunks", lazy="selectin")

    __table_args__ = (
        UniqueConstraint("document_id", "index", name="uq_document_index"),
        Index("idx_chunks_document", "document_id"),
    )

    def __repr__(self) -> str:
        return f"<Chunk(id={self.id}, doc={self.document_id}, index={self.index})>"
