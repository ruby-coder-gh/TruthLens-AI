"""PromptVersion model: immutable, content-addressed system prompts.

Every generated answer records the ``content_hash`` of the prompt that produced
it (``queries.prompt_version``). Admins stage a new version, run the golden-set
eval against it, and only promote it to ``active`` when the run clears the
``EVAL_MIN_*`` thresholds.

Lifecycle: ``draft`` → ``staged`` (eval passed) → ``active`` (promoted) →
``retired`` (superseded or rolled back). "Exactly one active row per name" is
enforced in the service layer — SQLite has no partial unique indexes.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import DeclarativeBase, TimestampMixin, UUIDPkMixin

PROMPT_STATUSES = ("draft", "staged", "active", "retired")


class PromptVersion(UUIDPkMixin, TimestampMixin, DeclarativeBase):
    __tablename__ = "prompt_versions"

    name: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    model_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    promoted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    eval_run_id: Mapped[str | None] = mapped_column(
        ForeignKey("eval_runs.id", ondelete="SET NULL"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("name", "version", name="uq_prompt_versions_name_version"),
        Index("idx_prompt_versions_name_status", "name", "status"),
    )

    def __repr__(self) -> str:
        return f"<PromptVersion(name={self.name}, v={self.version}, status={self.status})>"
