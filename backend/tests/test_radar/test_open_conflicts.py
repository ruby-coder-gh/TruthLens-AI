"""`app.radar.open_conflicts_for_chunks` — K5 (Truth Receipt `conflicts[]`)."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contradiction import Contradiction
from app.models.document import Document
from app.models.workspace import Workspace
from tests.test_radar.conftest import FakeCollection


@pytest.fixture
async def two_docs(test_db: AsyncSession):
    workspace = Workspace(name="Conflicts WS", owner_id="u1")
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


@pytest.mark.asyncio
async def test_returns_open_contradictions_touching_a_cited_chunk(monkeypatch, test_db, two_docs):
    from app.radar import open_conflicts_for_chunks

    workspace, doc_a, doc_b = two_docs
    test_db.add(Contradiction(
        workspace_id=workspace.id, pair_key="k1",
        doc_a_id=doc_a.id, chunk_a_id="chunk-a", sentence_a="Revenue was €412 million.",
        doc_b_id=doc_b.id, chunk_b_id="chunk-b", sentence_b="Revenue was €398 million.",
        score=0.97, similarity=0.88, status="open",
    ))
    await test_db.commit()

    collection = FakeCollection([
        {"id": "1", "document_id": doc_a.id, "chunk_id": "chunk-a", "text": "", "embedding": [1.0], "page_number": 1},
        {"id": "2", "document_id": doc_b.id, "chunk_id": "chunk-b", "text": "", "embedding": [1.0], "page_number": 3},
    ])
    monkeypatch.setattr("app.radar.get_workspace_collection", lambda _wid: collection)

    result = await open_conflicts_for_chunks(test_db, workspace.id, ["chunk-a"])

    assert result == [
        {
            "a": {"document_name": "annual-report.pdf", "page_number": 1, "sentence": "Revenue was €412 million."},
            "b": {"document_name": "press-release.pdf", "page_number": 3, "sentence": "Revenue was €398 million."},
            "score": 0.97,
        }
    ]


@pytest.mark.asyncio
async def test_excludes_dismissed_and_resolved_contradictions(monkeypatch, test_db, two_docs):
    from app.radar import open_conflicts_for_chunks

    workspace, doc_a, doc_b = two_docs
    test_db.add_all([
        Contradiction(
            workspace_id=workspace.id, pair_key="k-dismissed",
            doc_a_id=doc_a.id, chunk_a_id="chunk-a", sentence_a="s1",
            doc_b_id=doc_b.id, chunk_b_id="chunk-b", sentence_b="s2",
            score=0.9, similarity=0.8, status="dismissed",
        ),
        Contradiction(
            workspace_id=workspace.id, pair_key="k-resolved",
            doc_a_id=doc_a.id, chunk_a_id="chunk-a", sentence_a="s1",
            doc_b_id=doc_b.id, chunk_b_id="chunk-c", sentence_b="s3",
            score=0.9, similarity=0.8, status="resolved",
        ),
    ])
    await test_db.commit()
    monkeypatch.setattr("app.radar.get_workspace_collection", lambda _wid: FakeCollection([]))

    result = await open_conflicts_for_chunks(test_db, workspace.id, ["chunk-a"])

    assert result == []


@pytest.mark.asyncio
async def test_excludes_contradictions_not_touching_any_cited_chunk(monkeypatch, test_db, two_docs):
    from app.radar import open_conflicts_for_chunks

    workspace, doc_a, doc_b = two_docs
    test_db.add(Contradiction(
        workspace_id=workspace.id, pair_key="k-unrelated",
        doc_a_id=doc_a.id, chunk_a_id="chunk-x", sentence_a="s1",
        doc_b_id=doc_b.id, chunk_b_id="chunk-y", sentence_b="s2",
        score=0.9, similarity=0.8, status="open",
    ))
    await test_db.commit()
    monkeypatch.setattr("app.radar.get_workspace_collection", lambda _wid: FakeCollection([]))

    result = await open_conflicts_for_chunks(test_db, workspace.id, ["chunk-a"])

    assert result == []


@pytest.mark.asyncio
async def test_empty_chunk_ids_returns_empty_without_a_query(test_db, two_docs):
    from app.radar import open_conflicts_for_chunks

    workspace, _doc_a, _doc_b = two_docs
    assert await open_conflicts_for_chunks(test_db, workspace.id, []) == []


@pytest.mark.asyncio
async def test_page_lookup_failure_is_swallowed_pages_are_none(monkeypatch, test_db, two_docs):
    """A Chroma hiccup must never break receipt sealing -- pages just come back None."""
    from app.radar import open_conflicts_for_chunks

    workspace, doc_a, doc_b = two_docs
    test_db.add(Contradiction(
        workspace_id=workspace.id, pair_key="k1",
        doc_a_id=doc_a.id, chunk_a_id="chunk-a", sentence_a="s1",
        doc_b_id=doc_b.id, chunk_b_id="chunk-b", sentence_b="s2",
        score=0.9, similarity=0.8, status="open",
    ))
    await test_db.commit()

    def _boom(_wid):
        raise RuntimeError("chroma unavailable")

    monkeypatch.setattr("app.radar.get_workspace_collection", _boom)

    result = await open_conflicts_for_chunks(test_db, workspace.id, ["chunk-a"])

    assert result[0]["a"]["page_number"] is None
    assert result[0]["b"]["page_number"] is None
