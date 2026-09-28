"""RadarScan model — one Contradiction Radar scan run over a workspace (lane L5)."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import DeclarativeBase, UUIDPkMixin


class RadarScan(UUIDPkMixin, DeclarativeBase):
    """A single contradiction-scan run.

    `status` is one of ``queued|running|done|failed``. `scope` is a
    JSON-encoded list of document ids to restrict the scan to, or NULL for a
    full-workspace scan.
    """

    __tablename__ = "radar_scans"

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")
    scope: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON list of document ids, or NULL
    chunks_scanned: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    pairs_checked: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    found: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    workspace = relationship("Workspace", back_populates="radar_scans", lazy="selectin")
    contradictions = relationship("Contradiction", back_populates="scan", lazy="selectin")

    __table_args__ = (
        Index("idx_radar_scans_workspace", "workspace_id"),
        Index("idx_radar_scans_workspace_status", "workspace_id", "status"),
    )

    def __repr__(self) -> str:
        return f"<RadarScan(id={self.id}, workspace={self.workspace_id}, status={self.status})>"
