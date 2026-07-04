"""Comparison models for multi-document comparison."""

from __future__ import annotations

from sqlalchemy import ForeignKey, Index, Float, Text, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import JSON

from app.models.base import DeclarativeBase, TimestampMixin, UUIDPkMixin


class Comparison(UUIDPkMixin, TimestampMixin, DeclarativeBase):
    """A multi-document comparison session."""

    __tablename__ = "comparisons"

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    question: Mapped[str] = mapped_column(Text, nullable=False)
    document_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    synthesis_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    agreement_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    trust_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Relationships
    workspace = relationship("Workspace", back_populates="comparisons", lazy="selectin")
    user = relationship("User", back_populates="comparisons", lazy="selectin")
    results = relationship(
        "ComparisonResult", back_populates="comparison", lazy="selectin", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("idx_comparisons_workspace", "workspace_id"),
        Index("idx_comparisons_user", "user_id"),
        Index("idx_comparisons_created", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<Comparison(id={self.id}, question={self.question[:50]})>"


class ComparisonResult(UUIDPkMixin, TimestampMixin, DeclarativeBase):
    """Per-document result within a comparison."""

    __tablename__ = "comparison_results"

    comparison_id: Mapped[str] = mapped_column(
        ForeignKey("comparisons.id", ondelete="CASCADE"), nullable=False, index=True
    )
    document_id: Mapped[str] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    answer_text: Mapped[str] = mapped_column(Text, nullable=False)
    sources: Mapped[str] = mapped_column(Text, nullable=True, default="[]")  # JSON string
    trust_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    stance: Mapped[str] = mapped_column(String(20), nullable=False, default="silent")

    # Relationships
    comparison = relationship("Comparison", back_populates="results", lazy="selectin")
    document = relationship("Document", back_populates="comparison_results", lazy="selectin")

    __table_args__ = (
        Index("idx_comparison_results_comparison", "comparison_id"),
        Index("idx_comparison_results_document", "document_id"),
    )

    def __repr__(self) -> str:
        return f"<ComparisonResult(id={self.id}, stance={self.stance})>"