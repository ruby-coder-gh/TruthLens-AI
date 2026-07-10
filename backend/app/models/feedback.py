"""Feedback model."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import DeclarativeBase, UUIDPkMixin


class Feedback(UUIDPkMixin, DeclarativeBase):
    __tablename__ = "feedback"

    query_id: Mapped[str] = mapped_column(
        ForeignKey("queries.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    query = relationship("Query", back_populates="feedback", lazy="selectin")
    user = relationship("User", back_populates="feedback_given", lazy="selectin")

    __table_args__ = (
        Index("idx_feedback_query", "query_id"),
    )

    def __repr__(self) -> str:
        return f"<Feedback(id={self.id}, query={self.query_id}, rating={self.rating})>"
