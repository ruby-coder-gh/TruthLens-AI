# Comparison Models and Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the comparison feature's data models and computation graph for multi-document comparisons in the TruthLens AI backend.

**Architecture:** 
- Define SQLAlchemy models for Comparison and ComparisonResult representing a comparison session and per-document results.
- Implement a LangGraph-based computation graph that orchestrates parallel document processing, synthesis, and trust scoring for comparisons.
- The graph will be used by the comparison API endpoint to process comparison requests asynchronously.

**Tech Stack:** Python, SQLAlchemy, Pydantic, LangGraph, FastAPI

## Global Constraints

- Follow existing codebase patterns for models, schemas, graphs, and APIs.
- Use UUID primary keys and timestamps as per existing models.
- Ensure all database relationships are properly configured with cascades and indices.
- Write unit tests for each component.
- Keep functions and classes small and focused.

---

### Task 1: Create Comparison Models

**Files:**
- Create: `backend/app/models/comparison.py`
- Modify: `backend/app/models/__init__.py` (to export new models)
- Create: `tests/app/models/test_comparison.py`
- Create: `backend/migrations/versions/2026-07-04-006_create_comparisons.sql` (or use Alembic format)

**Interfaces:**
- Consumes: None (foundational model)
- Produces: `Comparison` and `ComparisonResult` classes for use by graph and API.

#### Step 1: Write the failing test for Comparison model

```python
def test_comparison_model_creation():
    from app.models.comparison import Comparison, ComparisonResult
    from uuid import uuid4
    from datetime import datetime
    
    # Test basic instantiation
    comp = Comparison(
        id=str(uuid4()),
        workspace_id=str(uuid4()),
        user_id=str(uuid4()),
        question="What is the main claim?",
        document_ids=["doc1", "doc2"],
        synthesis_text="Agreement on claim.",
        agreement_score=0.8,
        trust_score=0.9
    )
    assert comp.question == "What is the main claim?"
    assert comp.document_ids == ["doc1", "doc2"]
    
    # Test ComparisonResult
    result = ComparisonResult(
        id=str(uuid4()),
        comparison_id=comp.id,
        document_id="doc1",
        answer_text="The claim is true.",
        trust_score=0.95,
        stance="supports"
    )
    assert result.stance == "supports"
```

#### Step 2: Run test to verify it fails

Run: `pytest tests/app/models/test_comparison.py::test_comparison_model_creation -v`
Expected: FAIL with ImportError or AttributeError

#### Step 3: Write minimal implementation

```python
"""Comparison models for multi-document comparison."""

from __future__ import annotations

from sqlalchemy import ForeignKey, Index, Float, Text, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import JSONB

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
    document_ids: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
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
```

#### Step 4: Run test to verify it passes

Run: `pytest tests/app/models/test_comparison.py::test_comparison_model_creation -v`
Expected: PASS

#### Step 5: Create migration script

```sql
-- Create comparisons table
CREATE TABLE comparisons (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    question TEXT NOT NULL,
    document_ids JSONB NOT NULL DEFAULT '[]',
    synthesis_text TEXT,
    agreement_score DOUBLE PRECISION,
    trust_score DOUBLE PRECISION,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_comparisons_workspace ON comparisons(workspace_id);
CREATE INDEX idx_comparisons_user ON comparisons(user_id);
CREATE INDEX idx_comparisons_created ON comparisons(created_at);

-- Create comparison_results table
CREATE TABLE comparison_results (
    id UUID PRIMARY KEY,
    comparison_id UUID NOT NULL REFERENCES comparisons(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    answer_text TEXT NOT NULL,
    sources TEXT NOT NULL DEFAULT '[]',
    trust_score DOUBLE PRECISION,
    stance VARCHAR(20) NOT NULL DEFAULT 'silent',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_comparison_results_comparison ON comparison_results(comparison_id);
CREATE INDEX idx_comparison_results_document ON comparison_results(document_id);
```

#### Step 6: Update __init__.py to export models

```python
# backend/app/models/__init__.py
from .comparison import Comparison, ComparisonResult  # noqa
```

#### Step 7: Commit

```bash
git add backend/app/models/comparison.py tests/app/models/test_comparison.py backend/migrations/versions/2026-07-04-006_create_comparisons.sql backend/app/models/__init__.py
git commit -m "feat: add Comparison and ComparisonResult models"
```

### Task 2: Create Comparison Graph

**Files:**
- Create: `backend/app/graph/comparison_graph.py`
- Modify: `backend/app/graph/__init__.py` (to export the graph builder)
- Create: `tests/app/graph/test_comparison_graph.py`

**Interfaces:**
- Consumes: Comparison models (from Task 1), document retrieval and generation functions from other modules.
- Produces: A compiled LangGraph state graph that can be run to produce comparison results.

#### Step 1: Write the failing test for graph structure

```python
def test_comparison_graph_build():
    from app.graph.comparison_graph import build_comparison_graph
    
    graph = build_comparison_graph()
    assert graph is not None
    # Check that nodes exist
    assert "rewrite" in graph.nodes
    assert "parallel_docs" in graph.nodes
    assert "synthesize" in graph.nodes
    assert "trust_score" in graph.nodes
```

#### Step 2: Run test to verify it fails

Run: `pytest tests/app/graph/test_comparison_graph.py::test_comparison_graph_build -v`
Expected: FAIL with ImportError

#### Step 3: Write minimal implementation

```python
"""Multi-document comparison graph using LangGraph.

Flow:
  1. Rewrite query
  2. Parallel document processing
  3. Synthesize results
  4. Compute trust score
"""

from __future__ import annotations

from typing import Any
from langgraph.graph import END, StateGraph
from typing_extensions import TypedDict

from app.config import settings


# ─── Graph State ──────────────────────────────────────────────────────────────

class ComparisonState(TypedDict):
    """State passed between LangGraph nodes."""
    query: str
    rewritten_query: str | None
    workspace_id: str
    user_id: str | None
    query_id: str
    document_ids: list[str]
    top_k: int
    filters: dict | None
    doc_results: list[dict[str, Any]]
    synthesis_text: str | None
    agreement_score: float | None
    per_doc_stances: dict[str, str]
    trust_score: float | None
    trust_components: dict | None
    model_used: str
    latency_ms: int
    error: str | None
    reasoning_trace: list[dict[str, Any]]


# ─── Graph Nodes (stubs) ──────────────────────────────────────────────────────

def _rewrite_node(state: ComparisonState) -> dict:
    return {"rewritten_query": state["query"]}

def _parallel_docs_node(state: ComparisonState) -> dict:
    return {"doc_results": []}

def _synthesize_node(state: ComparisonState) -> dict:
    return {"synthesis_text": "", "agreement_score": 0.0, "per_doc_stances": {}}

def _trust_score_node(state: ComparisonState) -> dict:
    return {"trust_score": 0.0, "trust_components": {}}


# ─── Graph Builder ────────────────────────────────────────────────────────────

def build_comparison_graph() -> StateGraph:
    """Build the multi-document comparison graph."""
    workflow = StateGraph(ComparisonState)

    workflow.add_node("rewrite", _rewrite_node)
    workflow.add_node("parallel_docs", _parallel_docs_node)
    workflow.add_node("synthesize", _synthesize_node)
    workflow.add_node("trust_score", _trust_score_node)

    workflow.set_entry_point("rewrite")
    workflow.add_edge("rewrite", "parallel_docs")
    workflow.add_edge("parallel_docs", "synthesize")
    workflow.add_edge("synthesize", "trust_score")
    workflow.add_edge("trust_score", END)

    return workflow.compile()
```

#### Step 4: Run test to verify it passes

Run: `pytest tests/app/graph/test_comparison_graph.py::test_comparison_graph_build -v`
Expected: PASS

#### Step 5: Update __init__.py to export graph builder

```python
# backend/app/graph/__init__.py
from .comparison_graph import build_comparison_graph  # noqa
```

#### Step 6: Commit

```bash
git add backend/app/graph/comparison_graph.py tests/app/graph/test_comparison_graph.py backend/app/graph/__init__.py
git commit -m "feat: add comparison graph structure"
```

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-04-comparison-feature.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**