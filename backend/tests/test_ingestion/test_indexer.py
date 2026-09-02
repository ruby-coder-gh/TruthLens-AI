"""Tests for indexer."""

from __future__ import annotations

import uuid

import pytest



@pytest.mark.asyncio
async def test_store_empty():
    """Test storing empty lists."""
    from app.ingestion.indexer import store

    result = await store([], [], str(uuid.uuid4()), str(uuid.uuid4()))
    assert result == 0


@pytest.mark.asyncio
async def test_delete_noop():
    """Test delete on non-existent document."""
    from app.ingestion.indexer import delete_document

    # Should not raise
    await delete_document(str(uuid.uuid4()), str(uuid.uuid4()))


@pytest.mark.asyncio
async def test_delete_documents_empty_list_returns_empty_dict():
    """Batched delete with no ids is a no-op and returns an empty result map."""
    from app.ingestion.indexer import delete_documents

    result = await delete_documents(str(uuid.uuid4()), [])
    assert result == {}


@pytest.mark.asyncio
async def test_delete_documents_batch_noop_reports_success_per_id():
    """Batched delete on ids with no existing data reports success (None error) for every id."""
    from app.ingestion.indexer import delete_documents

    workspace_id = str(uuid.uuid4())
    doc_ids = [str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())]

    result = await delete_documents(workspace_id, doc_ids)

    assert set(result.keys()) == set(doc_ids)
    assert all(error is None for error in result.values())


@pytest.mark.asyncio
async def test_delete_documents_batch_uses_single_chroma_call_and_single_bm25_rebuild():
    """Batched delete issues exactly one Chroma $in delete + one BM25 rebuild, not one per id."""
    from unittest.mock import MagicMock, patch

    from app.ingestion.indexer import delete_documents

    workspace_id = str(uuid.uuid4())
    doc_ids = [str(uuid.uuid4()), str(uuid.uuid4())]

    fake_collection = MagicMock()
    with (
        patch("app.ingestion.indexer.get_workspace_collection", return_value=fake_collection) as mock_get_collection,
        patch("app.ingestion.indexer._rebuild_bm25_excluding") as mock_rebuild,
    ):
        result = await delete_documents(workspace_id, doc_ids)

    mock_get_collection.assert_called_once_with(workspace_id)
    fake_collection.delete.assert_called_once_with(where={"document_id": {"$in": doc_ids}})
    mock_rebuild.assert_called_once_with(workspace_id, set(doc_ids))
    assert all(error is None for error in result.values())


@pytest.mark.asyncio
async def test_delete_documents_batch_reports_chroma_failure_for_all_ids():
    """A Chroma delete failure is surfaced per-id instead of being swallowed into a log line."""
    from unittest.mock import MagicMock, patch

    from app.ingestion.indexer import delete_documents

    workspace_id = str(uuid.uuid4())
    doc_ids = [str(uuid.uuid4()), str(uuid.uuid4())]

    fake_collection = MagicMock()
    fake_collection.delete.side_effect = RuntimeError("chroma down")
    with patch("app.ingestion.indexer.get_workspace_collection", return_value=fake_collection):
        result = await delete_documents(workspace_id, doc_ids)

    assert set(result.keys()) == set(doc_ids)
    assert all(error is not None and "chroma down" in error for error in result.values())
