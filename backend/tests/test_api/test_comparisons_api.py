"""Focused tests for comparison API/runtime regression paths."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.comparisons import MAX_PAGE_SIZE, _run_and_save_comparison
from app.models.comparison import Comparison, ComparisonResult


@pytest.fixture
async def workspace_and_document(
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> tuple[str, str]:
    """Create workspace and one document, return (workspace_id, doc_id)."""
    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "Compare WS", "description": ""},
        headers=auth_headers,
    )
    workspace_id = ws_resp.json()["id"]

    upload = await client.post(
        f"/api/workspaces/{workspace_id}/documents",
        files={"file": ("compare-doc.txt", b"compare content", "text/plain")},
        headers=auth_headers,
    )
    doc_id = upload.json()["id"]
    return workspace_id, doc_id


@pytest.mark.asyncio
async def test_get_comparison_uses_document_original_filename(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
    workspace_and_document: tuple[str, str],
):
    """Comparison detail resolves document_name without Document.name attribute errors."""
    workspace_id, doc_id = workspace_and_document

    comparison = Comparison(
        workspace_id=workspace_id,
        user_id=None,
        question="What changed?",
        document_ids=[doc_id],
    )
    test_db.add(comparison)
    await test_db.commit()
    await test_db.refresh(comparison)

    result = ComparisonResult(
        comparison_id=comparison.id,
        document_id=doc_id,
        answer_text="answer",
        sources="[]",
        trust_score=0.9,
        stance="supports",
    )
    test_db.add(result)
    await test_db.commit()

    resp = await client.get(
        f"/api/workspaces/{workspace_id}/comparisons/{comparison.id}",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["results"][0]["document_name"] == "compare-doc.txt"


@pytest.mark.asyncio
async def test_list_comparisons_page_size_bounded(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
    workspace_and_document: tuple[str, str],
):
    """Out-of-range comparison page_size is clamped."""
    workspace_id, doc_id = workspace_and_document

    comparison = Comparison(
        workspace_id=workspace_id,
        user_id=None,
        question="Question",
        document_ids=[doc_id],
    )
    test_db.add(comparison)
    await test_db.commit()

    resp = await client.get(
        f"/api/workspaces/{workspace_id}/comparisons?page_size=999",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["meta"]["page_size"] == MAX_PAGE_SIZE


@pytest.mark.asyncio
async def test_run_and_save_comparison_logs_failures(monkeypatch):
    """Background comparison failure path logs error instead of NameError."""
    calls = {"logged": 0}

    async def boom(**kwargs):
        raise RuntimeError("boom")

    def fake_error(*args, **kwargs):
        calls["logged"] += 1

    monkeypatch.setattr("app.api.comparisons._run_comparison", boom)
    monkeypatch.setattr("app.api.comparisons.logger.error", fake_error)

    await _run_and_save_comparison(
        comparison_id="cmp-1",
        query="q",
        workspace_id="ws-1",
        document_ids=["d1", "d2"],
        user_id="u1",
    )

    assert calls["logged"] == 1
