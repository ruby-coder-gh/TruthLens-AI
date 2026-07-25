"""Shared BM25 index helpers used by ingestion and retrieval.

These helpers centralize the on-disk BM25 index format (a JSON corpus +
metadata list) and the tokenizer, so the indexer and hybrid search stay in
lockstep. The BM25Okapi index itself is rebuilt from the corpus on load.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from rank_bm25 import BM25Okapi

from app.config import settings
from app.utils.logger import logger


def _bm25_tokenizer(text: str) -> list[str]:
    """Normalize word tokens consistently for retrieval and lightweight search."""
    return re.findall(r"[\w]+", text.lower())


def _get_bm25_path(workspace_id: str) -> Path:
    """Get path to BM25 index file for a workspace."""
    return settings.bm25_path / workspace_id / "index.json"


# Cache for BM25 indices (one per workspace)
# This caches the parsed JSON data; BM25Okapi is rebuilt from it
_BM25_CACHE_MAX_SIZE = 32


@lru_cache(maxsize=_BM25_CACHE_MAX_SIZE)
def _load_bm25_index_cached(workspace_id: str) -> tuple[tuple[str, ...], tuple[dict[str, Any], ...]]:
    """Load BM25 corpus and metadata from disk (cached).
    
    Returns immutable tuples for cacheability.
    """
    index_path = _get_bm25_path(workspace_id)
    if index_path.exists():
        try:
            with open(index_path, "r") as f:
                data = json.load(f)
            corpus = data.get("corpus", [])
            metadatas = data.get("metadatas", [])
            return tuple(corpus), tuple(metadatas)
        except Exception as e:
            logger.warning("bm25_load_failed", error=str(e), path=str(index_path))
    return (), ()


def _load_bm25_index(workspace_id: str) -> tuple[BM25Okapi | None, list[str], list[dict[str, Any]]]:
    """Load BM25 index from disk. Rebuilds BM25Okapi from corpus.
    
    Uses LRU cache for the corpus/metadata, but rebuilds the BM25Okapi
    index each time (it's not pickle-serializable for caching).
    """
    corpus_tuple, metadatas_tuple = _load_bm25_index_cached(workspace_id)
    corpus = list(corpus_tuple)
    metadatas = list(metadatas_tuple)
    
    if corpus:
        index = BM25Okapi([_bm25_tokenizer(doc) for doc in corpus])
        return index, corpus, metadatas
    return None, [], []


def clear_bm25_cache(workspace_id: str | None = None) -> None:
    """Clear the BM25 index cache.
    
    Args:
        workspace_id: If provided, clear only this workspace's cache.
                     If None, clear the entire cache.
    """
    if workspace_id is None:
        _load_bm25_index_cached.cache_clear()
        logger.info("bm25_cache_cleared", workspace="all")
    else:
        # lru_cache doesn't support selective clearing, so we clear all
        # This is a limitation; for production, consider a custom cache
        _load_bm25_index_cached.cache_clear()
        logger.info("bm25_cache_cleared", workspace=workspace_id)
