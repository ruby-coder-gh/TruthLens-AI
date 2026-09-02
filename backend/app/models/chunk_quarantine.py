"""ChunkQuarantine model — ingest-time prompt-injection quarantine records (F7a)."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import DeclarativeBase, UUIDPkMixin


class ChunkQuarantine(UUIDPkMixin, DeclarativeBase):
    __tablename__ = "chunk_quarantines"

    # No `index=True` here — the explicit `Index(...)` entries in
    # __table_args__ below are the only indexes on these columns (matches
    # the migration exactly; `index=True` would additionally register an
    # implicit `ix_*` index under `create_all()`, diverging from the
    # hand-authored `idx_*` migration).
    document_id: Mapped[str] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
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

    # Relationships. `lazy="raise"` is deliberate: list endpoints must never
    # lazy-load `document` (which would cascade into `Document.chunks`
    # selectin-loading every full chunk body for that document) — they join
    # `Document.original_filename` explicitly instead. Any accidental access
    # of `.document` raises loudly rather than silently over-fetching.
    document = relationship("Document", back_populates="quarantines", lazy="raise")

    __table_args__ = (
        Index("idx_chunk_quarantines_document", "document_id"),
        Index("idx_chunk_quarantines_workspace", "workspace_id"),
        Index("idx_chunk_quarantines_status", "status"),
        Index("idx_chunk_quarantines_workspace_status", "workspace_id", "status"),
    )

    def __repr__(self) -> str:
        return f"<ChunkQuarantine(id={self.id}, document_id={self.document_id}, status={self.status})>"
