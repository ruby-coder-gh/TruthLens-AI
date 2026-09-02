"""EvalRun model for tracking RAGAS evaluation runs."""
from __future__ import annotations
from datetime import datetime
from sqlalchemy import DateTime, Float, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import DeclarativeBase, UUIDPkMixin

class EvalRun(UUIDPkMixin, DeclarativeBase):
    __tablename__ = "eval_runs"
    run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    faithfulness: Mapped[float | None] = mapped_column(Float, nullable=True)
    context_precision: Mapped[float | None] = mapped_column(Float, nullable=True)
    context_recall: Mapped[float | None] = mapped_column(Float, nullable=True)
    answer_relevance: Mapped[float | None] = mapped_column(Float, nullable=True)
    answer_correctness: Mapped[float | None] = mapped_column(Float, nullable=True)
    refusal_accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    golden_set_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # ─── Eval-gated prompt promotion (F1) ───
    # `passed` is the server default so rows written before migration 010 keep
    # reading as a completed, successful run for the analytics dashboard.
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="passed", server_default="passed")
    # Deliberately NOT a ForeignKey: `prompt_versions.eval_run_id` already
    # points the other way, and SQLite cannot ALTER a table to add the deferred
    # constraint a two-way cycle needs (SQLAlchemy warns and refuses to sort
    # tables for DROP). The prompt row owns the authoritative link.
    prompt_version_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    model_used: Mapped[str | None] = mapped_column(String(64), nullable=True)
    subset: Mapped[str | None] = mapped_column(String(8), nullable=True)
    verdict: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("idx_eval_runs_prompt_version", "prompt_version_id"),
        Index("idx_eval_runs_status", "status"),
    )
