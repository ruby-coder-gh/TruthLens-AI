"""Persistent investigation case records and review workflow."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import DeclarativeBase, TimestampMixin, UUIDPkMixin


class Investigation(UUIDPkMixin, TimestampMixin, DeclarativeBase):
    """An immutable investigation result with a lightweight review lifecycle.

    The generated report, its source snapshots, and reasoning trace are stored
    together so an analyst can review the same evidence that produced the case.
    """

    __tablename__ = "investigations"

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    query_text: Mapped[str] = mapped_column(Text, nullable=False)
    final_report: Mapped[str] = mapped_column(Text, nullable=False, default="")
    sub_questions: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    reasoning_trace: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    trust_components: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    trust_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Case review lifecycle: draft -> in_review -> approved / needs_changes.
    review_status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft", index=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("idx_investigations_workspace_created", "workspace_id", "created_at"),
        Index("idx_investigations_review_status", "review_status"),
    )

    def __repr__(self) -> str:
        return f"<Investigation(id={self.id}, status={self.review_status})>"
