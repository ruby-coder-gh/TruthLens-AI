"""Query model."""

from __future__ import annotations

from sqlalchemy import Boolean, Float, ForeignKey, Index, Integer, String, Text
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

    # Relationships
    workspace = relationship("Workspace", back_populates="queries", lazy="selectin")
    user = relationship("User", back_populates="queries", lazy="selectin")
    feedback = relationship("Feedback", back_populates="query", lazy="selectin", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_queries_workspace", "workspace_id"),
        Index("idx_queries_user", "user_id"),
        Index("idx_queries_created", "created_at"),
        Index("idx_queries_trust_score", "trust_score"),
        Index("idx_queries_cache_lookup", "workspace_id", "normalized_query", "document_version", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<Query(id={self.id}, query={self.query_text[:50]})>"
