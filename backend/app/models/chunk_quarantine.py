"""ChunkQuarantine model — ingest-time prompt-injection quarantine records (F7a)."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import DeclarativeBase, UUIDPkMixin


class ChunkQuarantine(UUIDPkMixin, DeclarativeBase):
    __tablename__ = "chunk_quarantines"

    document_id: Mapped[str] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    pattern: Mapped[str | None] = mapped_column(String(64), nullable=True)
    severity: Mapped[str | None] = mapped_column(String(16), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="quarantined")
    reviewed_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    document = relationship("Document", lazy="selectin")

    __table_args__ = (
        Index("idx_chunk_quarantines_document", "document_id"),
        Index("idx_chunk_quarantines_workspace", "workspace_id"),
        Index("idx_chunk_quarantines_status", "status"),
        Index("idx_chunk_quarantines_workspace_status", "workspace_id", "status"),
    )

    def __repr__(self) -> str:
        return f"<ChunkQuarantine(id={self.id}, document_id={self.document_id}, status={self.status})>"
