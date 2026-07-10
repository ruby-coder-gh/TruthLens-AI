"""Store embeddings in ChromaDB + update BM25 index."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from rank_bm25 import BM25Okapi

from app.chroma_client import get_workspace_collection
from app.database import async_session_factory
from app.ingestion.chunker import ChunkResult
from app.ingestion.embedder import EmbeddingResult
from app.models.chunk import Chunk
from app.retrieval.bm25_utils import _bm25_tokenizer, _get_bm25_path, _load_bm25_index
from app.utils.logger import logger


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
            # chromadb's stub expects its Metadata mapping type; plain dicts work
            # at runtime.
            metadatas=metadatas[i:end],  # type: ignore[arg-type]
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

        await asyncio.to_thread(_save_bm25_index, workspace_id, new_index, new_corpus, new_metadatas)
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
