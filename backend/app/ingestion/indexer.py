"""Store embeddings in ChromaDB + update BM25 index."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from rank_bm25 import BM25Okapi
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.chroma_client import get_workspace_collection
from app.config import settings
from app.database import async_session_factory
from app.ingestion.chunker import ChunkResult
from app.ingestion.embedder import EmbeddingResult
from app.models.chunk import Chunk
from app.models.document import Document
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


def _save_bm25_index(
    workspace_id: str,
    index: BM25Okapi,  # noqa: ARG001 (rebuilt from corpus on load)
    corpus: list[str],
    metadatas: list[dict[str, Any]],
) -> None:
    """Save BM25 corpus+metadata as JSON (safe serialization)."""
    index_path = _get_bm25_path(workspace_id)
    index_path.parent.mkdir(parents=True, exist_ok=True)
    data = {"corpus": corpus, "metadatas": metadatas}
    with open(index_path, "w") as f:
        json.dump(data, f)


async def store(
    chunks: list[ChunkResult],
    embeddings: list[EmbeddingResult],
    workspace_id: str,
    document_id: str,
) -> int:
    """Store embeddings in ChromaDB + update BM25 index + save chunks to DB.

    Args:
        chunks: List of ChunkResult.
        embeddings: List of EmbeddingResult.
        workspace_id: Workspace UUID.
        document_id: Document UUID.

    Returns:
        Number of chunks stored.
    """
    if not chunks or not embeddings:
        return 0

    # 1. Store in ChromaDB
    collection = get_workspace_collection(workspace_id)

    ids = [f"{document_id}:{c.index}" for c in chunks]
    embeddings_list = [e.embedding.tolist() for e in embeddings]
    metadatas = [e.metadata for e in embeddings]
    documents = [c.content for c in chunks]

    # Upsert in batches of 100
    batch_size = 100
    for i in range(0, len(ids), batch_size):
        end = i + batch_size
        collection.upsert(
            ids=ids[i:end],
            embeddings=embeddings_list[i:end],
            metadatas=metadatas[i:end],
            documents=documents[i:end],
        )

    logger.info("chromadb_upsert_complete", count=len(ids), workspace_id=workspace_id)

    # 2. Update BM25 index
    try:
        existing_index, existing_corpus, existing_metadatas = _load_bm25_index(workspace_id)

        new_corpus = existing_corpus + documents
        new_metadatas = existing_metadatas + metadatas

        new_index = BM25Okapi(
            [_bm25_tokenizer(doc) for doc in new_corpus],
        )

        _save_bm25_index(workspace_id, new_index, new_corpus, new_metadatas)
        logger.info("bm25_update_complete", workspace_id=workspace_id, total_docs=len(new_corpus))
    except Exception as e:
        logger.error("bm25_update_failed", error=str(e), workspace_id=workspace_id)

    # 3. Store chunks in SQLite
    async with async_session_factory() as session:
        try:
            for chunk in chunks:
                db_chunk = Chunk(
                    id=chunk.id,
                    document_id=chunk.document_id,
                    index=chunk.index,
                    content=chunk.content,
                    token_count=chunk.token_count,
                )
                session.add(db_chunk)
            await session.commit()
            logger.info("chunks_saved_to_db", count=len(chunks), document_id=document_id)
        except Exception as e:
            await session.rollback()
            logger.error("chunks_db_save_failed", error=str(e), document_id=document_id)
            raise

    return len(chunks)


async def delete_document(workspace_id: str, document_id: str) -> None:
    """Delete document chunks from ChromaDB + BM25 index."""
    # ChromaDB delete
    try:
        collection = get_workspace_collection(workspace_id)
        collection.delete(where={"document_id": document_id})
        logger.info("chromadb_delete_complete", document_id=document_id)
    except Exception as e:
        logger.error("chromadb_delete_failed", error=str(e), document_id=document_id)

    # BM25: rebuild without this document's chunks (expensive but robust)
    try:
        existing_index, existing_corpus, existing_metadatas = _load_bm25_index(workspace_id)
        if existing_index and existing_corpus:
            filtered = [
                (doc, meta)
                for doc, meta in zip(existing_corpus, existing_metadatas)
                if meta.get("document_id") != document_id
            ]
            if filtered:
                new_corpus, new_metadatas = zip(*filtered) if filtered else ([], [])
                new_index = BM25Okapi([_bm25_tokenizer(doc) for doc in new_corpus])
                _save_bm25_index(workspace_id, new_index, list(new_corpus), list(new_metadatas))
            else:
                # All documents removed — clear index
                _save_bm25_index(workspace_id, BM25Okapi([]), [], [])
            logger.info("bm25_delete_complete", document_id=document_id)
    except Exception as e:
        logger.error("bm25_delete_failed", error=str(e), document_id=document_id)


async def delete_workspace(workspace_id: str) -> None:
    """Delete entire workspace index data."""
    from app.chroma_client import delete_workspace_collection

    delete_workspace_collection(workspace_id)

    index_path = _get_bm25_path(workspace_id)
    if index_path.exists():
        index_path.unlink()
    logger.info("workspace_index_deleted", workspace_id=workspace_id)
