"""Embed chunks using sentence-transformers model."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

import numpy as np
from sentence_transformers import SentenceTransformer

from app.config import settings
from app.ingestion.chunker import ChunkResult
from app.utils.logger import logger


class EmbeddingResult:
    """Result of embedding operation."""

    def __init__(
        self,
        chunk_id: str,
        embedding: np.ndarray,
        metadata: dict[str, Any],
    ) -> None:
        self.chunk_id = chunk_id
        self.embedding = embedding
        self.metadata = metadata


@lru_cache(maxsize=1)
def _load_model(model_name: str | None = None) -> SentenceTransformer:
    """Load sentence-transformers model (cached)."""
    name = model_name or settings.EMBED_MODEL_NAME
    logger.info("loading_embedding_model", model=name, device=settings.EMBED_DEVICE)
    return SentenceTransformer(name, device=settings.EMBED_DEVICE)


async def embed(chunks: list[ChunkResult], document_name: str = "") -> list[EmbeddingResult]:
    """Convert text chunks to vector embeddings.

    Args:
        chunks: List of ChunkResult objects.
        document_name: Original filename for metadata.

    Returns:
        List of EmbeddingResult with numpy arrays.
    """
    if not chunks:
        return []

    model = _load_model()
    texts = [c.content for c in chunks]

    logger.info("embedding_chunks", count=len(texts), model=settings.EMBED_MODEL_NAME)

    # sentence-transformers encode is thread-safe
    embeddings = model.encode(
        texts,
        show_progress_bar=False,
        batch_size=32,
        normalize_embeddings=True,
    )

    results: list[EmbeddingResult] = []
    for chunk, emb in zip(chunks, embeddings):
        metadata: dict[str, Any] = {
            "document_id": chunk.document_id,
            "document_name": document_name,
            "chunk_id": chunk.id,
            "chunk_index": chunk.index,
            "token_count": chunk.token_count,
            **chunk.metadata,
        }
        if chunk.page_number is not None:
            metadata["page_number"] = chunk.page_number

        results.append(EmbeddingResult(
            chunk_id=chunk.id,
            embedding=np.array(emb, dtype=np.float32),
            metadata=metadata,
        ))

    logger.info("embedding_complete", count=len(results), dimension=settings.EMBED_DIMENSION)
    return results


def dimension() -> int:
    """Return embedding dimension."""
    return settings.EMBED_DIMENSION


def model_name() -> str:
    """Return embedding model name."""
    return settings.EMBED_MODEL_NAME
