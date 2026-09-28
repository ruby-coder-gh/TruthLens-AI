"""Contradiction model — a flagged pair of conflicting sentences (Contradiction Radar, lane L5)."""

from __future__ import annotations

from sqlalchemy import Float, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import DeclarativeBase, TimestampMixin, UUIDPkMixin


class Contradiction(UUIDPkMixin, TimestampMixin, DeclarativeBase):
    """A pair of sentences (from two different documents) whose NLI
    contradiction score cleared the radar threshold.

    `chunk_a_id` / `chunk_b_id` reference `chunks.id` (a UUID string) but are
    plain columns rather than foreign keys: a contradiction is a point-in-time
    finding and should not vanish or need cleanup if a chunk is later
    re-indexed. `doc_a_id` / `doc_b_id` are still declared foreign keys
    (cascade-deleted with their document) since two documents already gate
    scans and dropping either side invalidates the pair. `resolved_by` is left
    without a relationship attribute, matching `ChunkQuarantine.reviewed_by` —
    lane L5 resolves the acting user explicitly rather than through the ORM.
    """

    __tablename__ = "contradictions"

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    scan_id: Mapped[str | None] = mapped_column(
        ForeignKey("radar_scans.id", ondelete="SET NULL"), nullable=True, index=True
    )
    pair_key: Mapped[str] = mapped_column(String(64), nullable=False)
    doc_a_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    chunk_a_id: Mapped[str] = mapped_column(String(36), nullable=False)
    sentence_a: Mapped[str] = mapped_column(Text, nullable=False)
    doc_b_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    chunk_b_id: Mapped[str] = mapped_column(String(36), nullable=False)
    sentence_b: Mapped[str] = mapped_column(Text, nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    similarity: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")
    resolved_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    workspace = relationship("Workspace", back_populates="contradictions", lazy="selectin")
    scan = relationship("RadarScan", back_populates="contradictions", lazy="selectin")

    __table_args__ = (
        UniqueConstraint("workspace_id", "pair_key", name="uq_contradictions_workspace_pair"),
        Index("idx_contradictions_workspace", "workspace_id"),
        Index("idx_contradictions_scan", "scan_id"),
        Index("idx_contradictions_workspace_status", "workspace_id", "status"),
    )

    def __repr__(self) -> str:
        return f"<Contradiction(id={self.id}, workspace={self.workspace_id}, status={self.status})>"
