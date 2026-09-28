"""`app.radar.append_missing_disagreement_figures` — BUG-24 cheap post-check.

A live conflict answer picked a side despite the disagreement prompt
instruction ("...the correct revenue figure is EUR 412 million"). If the
answer cites both sides of an open Radar pair but only states one side's
number, append the other side with its own [source:N] citation.
"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contradiction import Contradiction
from app.models.document import Document
from app.models.workspace import Workspace
from app.radar import append_missing_disagreement_figures


@pytest.fixture
async def two_docs(test_db: AsyncSession):
    workspace = Workspace(name="Postcheck WS", owner_id="u1")
    test_db.add(workspace)
    await test_db.commit()
    doc_a = Document(
        workspace_id=workspace.id, filename="srv-a.pdf", original_filename="annual-report.pdf",
        mime_type="application/pdf", file_size=1, status="ready",
    )
    doc_b = Document(
        workspace_id=workspace.id, filename="srv-b.pdf", original_filename="press-release.pdf",
        mime_type="application/pdf", file_size=1, status="ready",
    )
    test_db.add_all([doc_a, doc_b])
    await test_db.commit()
    return workspace, doc_a, doc_b


def _contexts(doc_a, doc_b):
    return [
        {"chunk_id": "chunk-a", "document_id": doc_a.id, "document_name": "annual-report.pdf"},
        {"chunk_id": "chunk-b", "document_id": doc_b.id, "document_name": "press-release.pdf"},
    ]


@pytest.mark.asyncio
async def test_appends_the_missing_sides_figure_with_its_own_citation(test_db, two_docs):
    workspace, doc_a, doc_b = two_docs
    test_db.add(Contradiction(
        workspace_id=workspace.id, pair_key="k1",
        doc_a_id=doc_a.id, chunk_a_id="chunk-a", sentence_a="Revenue was €412 million.",
        doc_b_id=doc_b.id, chunk_b_id="chunk-b", sentence_b="Revenue was €398 million.",
        score=0.9, similarity=0.8, status="open",
    ))
    await test_db.commit()

    answer = "Revenue in 2025 was €412 million [source:1][source:2]."
    result = await append_missing_disagreement_figures(
        test_db, workspace.id, answer, _contexts(doc_a, doc_b)
    )

    assert result == answer + " Revenue was €398 million. [source:2]"


@pytest.mark.asyncio
async def test_no_change_when_the_answer_already_states_both_figures(test_db, two_docs):
    workspace, doc_a, doc_b = two_docs
    test_db.add(Contradiction(
        workspace_id=workspace.id, pair_key="k1",
        doc_a_id=doc_a.id, chunk_a_id="chunk-a", sentence_a="Revenue was €412 million.",
        doc_b_id=doc_b.id, chunk_b_id="chunk-b", sentence_b="Revenue was €398 million.",
        score=0.9, similarity=0.8, status="open",
    ))
    await test_db.commit()

    answer = "Sources disagree: €412 million [source:1] vs €398 million [source:2]."
    result = await append_missing_disagreement_figures(
        test_db, workspace.id, answer, _contexts(doc_a, doc_b)
    )

    assert result == answer


@pytest.mark.asyncio
async def test_no_change_when_only_one_side_is_cited(test_db, two_docs):
    workspace, doc_a, doc_b = two_docs
    test_db.add(Contradiction(
        workspace_id=workspace.id, pair_key="k1",
        doc_a_id=doc_a.id, chunk_a_id="chunk-a", sentence_a="Revenue was €412 million.",
        doc_b_id=doc_b.id, chunk_b_id="chunk-b", sentence_b="Revenue was €398 million.",
        score=0.9, similarity=0.8, status="open",
    ))
    await test_db.commit()

    answer = "Revenue in 2025 was €412 million [source:1]."
    result = await append_missing_disagreement_figures(
        test_db, workspace.id, answer, _contexts(doc_a, doc_b)
    )

    assert result == answer


@pytest.mark.asyncio
async def test_no_change_when_no_open_contradiction_between_cited_pair(test_db, two_docs):
    workspace, doc_a, doc_b = two_docs
    answer = "Revenue in 2025 was €412 million [source:1][source:2]."
    result = await append_missing_disagreement_figures(
        test_db, workspace.id, answer, _contexts(doc_a, doc_b)
    )
    assert result == answer


@pytest.mark.asyncio
async def test_dismissed_contradiction_is_ignored(test_db, two_docs):
    workspace, doc_a, doc_b = two_docs
    test_db.add(Contradiction(
        workspace_id=workspace.id, pair_key="k1",
        doc_a_id=doc_a.id, chunk_a_id="chunk-a", sentence_a="Revenue was €412 million.",
        doc_b_id=doc_b.id, chunk_b_id="chunk-b", sentence_b="Revenue was €398 million.",
        score=0.9, similarity=0.8, status="dismissed",
    ))
    await test_db.commit()

    answer = "Revenue in 2025 was €412 million [source:1][source:2]."
    result = await append_missing_disagreement_figures(
        test_db, workspace.id, answer, _contexts(doc_a, doc_b)
    )
    assert result == answer
