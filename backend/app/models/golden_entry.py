"""Reviewer-promoted golden dataset entry.

The builtin golden set lives as a hard-coded Python list in
``backend/evaluation/golden_dataset.py``. Rows in this table are entries a
human reviewer promoted out of the review queue, so a corrected answer becomes
permanent regression protection. ``app.evaluation.golden_store`` merges the two
sources; ``evaluation/evaluate.py``'s CLI keeps the builtin-only path so CI
stays deterministic.
"""

from __future__ import annotations

from sqlalchemy import JSON, Boolean, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import DeclarativeBase, TimestampMixin, UUIDPkMixin


class GoldenEntry(UUIDPkMixin, TimestampMixin, DeclarativeBase):
    __tablename__ = "golden_entries"

    question: Mapped[str] = mapped_column(Text, nullable=False)
    reference_answer: Mapped[str] = mapped_column(Text, nullable=False)
    # Distinct document names the promoted answer cited, mirroring
    # GoldenEntry.source_documents in the builtin dataset.
    source_documents: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    expected_grounding: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    category: Mapped[str] = mapped_column(String(32), nullable=False, default="answerable")
    difficulty: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Unique so one reviewed answer yields at most one golden entry (409 on
    # re-promotion). SET NULL rather than CASCADE: deleting the originating
    # query must not silently shrink the golden set.
    source_query_id: Mapped[str | None] = mapped_column(
        ForeignKey("queries.id", ondelete="SET NULL"), nullable=True, unique=True
    )
    workspace_id: Mapped[str | None] = mapped_column(
        ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    __table_args__ = (
        Index("idx_golden_entries_category", "category"),
        Index("idx_golden_entries_created", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<GoldenEntry(id={self.id}, category={self.category}, question={self.question[:40]})>"
