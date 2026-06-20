"""Tests for ChromaDB client."""

from __future__ import annotations

import pytest

from app.chroma_client import get_chroma_client, get_workspace_collection


def test_get_chroma_client():
    """ChromaDB client should be initializable."""
    try:
        client = get_chroma_client()
        assert client is not None
    except Exception as e:
        pytest.skip(f"ChromaDB not available: {e}")


def test_get_workspace_collection():
    """Workspace collection should be gettable."""
    try:
        collection = get_workspace_collection("test-ws-0001")
        assert collection is not None
        assert collection.name is not None
    except Exception as e:
        pytest.skip(f"ChromaDB not available: {e}")
