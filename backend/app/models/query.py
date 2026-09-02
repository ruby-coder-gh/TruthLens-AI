"""Query model."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import DeclarativeBase, TimestampMixin, UUIDPkMixin


class Query(UUIDPkMixin, TimestampMixin, DeclarativeBase):
    __tablename__ = "queries"

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    query_text: Mapped[str] = mapped_column(Text, nullable=False)
    normalized_query: Mapped[str | None] = mapped_column(Text, nullable=True)
    document_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    cache_hit_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    rewritten_query: Mapped[str | None] = mapped_column(Text, nullable=True)
    response_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    response_sources: Mapped[str | None] = mapped_column(
        Text, nullable=True, default="[]"
    )  # JSON string
    trust_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    guardrail_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    guardrail_passed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    model_used: Mapped[str | None] = mapped_column(String(64), nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    token_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Fresh-answer comparison lineage. The original answer remains immutable.
    compared_to_query_id: Mapped[str | None] = mapped_column(
        ForeignKey("queries.id", ondelete="SET NULL"), nullable=True, index=True
    )
    trust_components: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    # Mirrors the investigation review lifecycle while retaining the query
    # queue's explicit reviewed/dismissed dispositions.
    review_status: Mapped[str] = mapped_column(String(32), nullable=False, default="needs_review", index=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    workspace = relationship("Workspace", back_populates="queries", lazy="selectin")
    user = relationship("User", back_populates="queries", lazy="selectin", foreign_keys=[user_id])
    feedback = relationship("Feedback", back_populates="query", lazy="selectin", cascade="all, delete-orphan")
    pins = relationship("QueryPin", back_populates="query", lazy="selectin", cascade="all, delete-orphan")
    annotations = relationship("Annotation", back_populates="query", lazy="selectin")

    __table_args__ = (
        Index("idx_queries_workspace", "workspace_id"),
        Index("idx_queries_user", "user_id"),
        Index("idx_queries_created", "created_at"),
        Index("idx_queries_trust_score", "trust_score"),
        Index("idx_queries_cache_lookup", "workspace_id", "normalized_query", "document_version", "created_at"),
        Index("idx_queries_review_queue", "workspace_id", "review_status", "trust_score"),
    )

    def __repr__(self) -> str:
        return f"<Query(id={self.id}, query={self.query_text[:50]})>"
