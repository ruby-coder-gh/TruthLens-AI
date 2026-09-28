"""QueryClaims model — persisted per-claim NLI verdicts for a query (Truth Lens)."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import DeclarativeBase, UUIDPkMixin


class QueryClaims(UUIDPkMixin, DeclarativeBase):
    """One row per Query holding the JSON-encoded list of per-claim verdicts.

    `claims` is a JSON-encoded list of claim objects — see the Truth Lens
    claim contract (`text, start, end, verdict, entailment, contradiction,
    source_index, chunk_id, document_id, document_name, page_number,
    evidence`). Written by lane L1 (guardrail.py / api/queries.py) once the
    per-claim NLI pass runs; read back for cache-replay and receipt sealing.
    """

    __tablename__ = "query_claims"

    query_id: Mapped[str] = mapped_column(
        ForeignKey("queries.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    claims: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    query = relationship("Query", back_populates="query_claims", lazy="selectin")

    def __repr__(self) -> str:
        return f"<QueryClaims(query_id={self.query_id})>"
