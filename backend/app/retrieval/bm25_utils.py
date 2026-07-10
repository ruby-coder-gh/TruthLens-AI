"""Shared BM25 index helpers used by ingestion and retrieval.

These helpers centralize the on-disk BM25 index format (a JSON corpus +
metadata list) and the tokenizer, so the indexer and hybrid search stay in
lockstep. The BM25Okapi index itself is rebuilt from the corpus on load.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from rank_bm25 import BM25Okapi

from app.config import settings
from app.utils.logger import logger


def _bm25_tokenizer(text: str) -> list[str]:
    """Simple tokenizer for BM25."""
    return text.lower().split()


def _get_bm25_path(workspace_id: str) -> Path:
    """Get path to BM25 index file for a workspace."""
    return settings.bm25_path / workspace_id / "index.json"


def _load_bm25_index(workspace_id: str) -> tuple[BM25Okapi | None, list[str], list[dict[str, Any]]]:
    """Load BM25 index from disk. Rebuilds BM25Okapi from corpus."""
    index_path = _get_bm25_path(workspace_id)
    if index_path.exists():
        try:
            with open(index_path, "r") as f:
                data = json.load(f)
            corpus = data.get("corpus", [])
            metadatas = data.get("metadatas", [])
            if corpus:
                index = BM25Okapi([_bm25_tokenizer(doc) for doc in corpus])
                return index, corpus, metadatas
        except Exception as e:
            logger.warning("bm25_load_failed", error=str(e), path=str(index_path))
    return None, [], []
