"""Store embeddings in ChromaDB + update BM25 index."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from rank_bm25 import BM25Okapi
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.chroma_client import get_workspace_collection
from app.database import async_session_factory
from app.ingestion.chunker import ChunkResult
from app.ingestion.embedder import EmbeddingResult
from app.models.chunk import Chunk
from app.retrieval.bm25_utils import _bm25_tokenizer, _get_bm25_path, _load_bm25_index, clear_bm25_cache
from app.utils.logger import logger


def _save_bm25_index(
    workspace_id: str,
    index: BM25Okapi | None,  # noqa: ARG001 (rebuilt from corpus on load)
    corpus: list[str],
    metadatas: list[dict[str, Any]],
) -> None:
    """Save BM25 corpus+metadata as JSON (safe serialization) and clear cache."""
    index_path = _get_bm25_path(workspace_id)
    index_path.parent.mkdir(parents=True, exist_ok=True)
    data = {"corpus": corpus, "metadatas": metadatas}
    with open(index_path, "w") as f:
        json.dump(data, f)
    # Clear the cache so subsequent loads get fresh data
    clear_bm25_cache(workspace_id)


async def store(
    chunks: list[ChunkResult],
    embeddings: list[EmbeddingResult],
    workspace_id: str,
    document_id: str,
    session: AsyncSession | None = None,
) -> int:
    """Store embeddings in ChromaDB + update BM25 index + save chunks to DB.

    Args:
        chunks: List of ChunkResult.
        embeddings: List of EmbeddingResult.
        workspace_id: Workspace UUID.
        document_id: Document UUID.
        session: Optional caller-owned session. When given, the `chunks` rows
            are flushed onto it instead of a private session, so the caller can
            commit them in the *same* transaction as its own writes. Required
            when the caller already holds an open write transaction: on SQLite
            a second session would block on that write lock and deadlock
            ("database is locked"). When omitted, a private session is opened
            and committed, preserving the fire-and-forget ingestion behaviour.

    Returns:
        Number of chunks stored.

    Raises:
        Exception: re-raised from the DB step, after the ChromaDB/BM25 writes
            for these chunks have been rolled back. Those two stores are not
            transactional, so without that compensation a failed DB write would
            leave the text retrievable — the exact invariant break that let a
            still-quarantined chunk be answered from.
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
    if session is not None:
        # Caller-owned transaction: flush only, so the rows land or vanish
        # together with the caller's own writes. No rollback here — the
        # caller's transaction owns that — but the non-transactional
        # ChromaDB/BM25 writes above still need compensating.
        try:
            for chunk in chunks:
                session.add(Chunk(
                    id=chunk.id,
                    document_id=chunk.document_id,
                    index=chunk.index,
                    content=chunk.content,
                    token_count=chunk.token_count,
                ))
            await session.flush()
            logger.info("chunks_flushed_to_caller_session", count=len(chunks), document_id=document_id)
        except Exception as e:
            logger.error("chunks_db_save_failed", error=str(e), document_id=document_id)
            await remove_chunk_vectors(workspace_id, document_id, [c.index for c in chunks])
            raise
        return len(chunks)

    async with async_session_factory() as own_session:
        try:
            for chunk in chunks:
                db_chunk = Chunk(
                    id=chunk.id,
                    document_id=chunk.document_id,
                    index=chunk.index,
                    content=chunk.content,
                    token_count=chunk.token_count,
                )
                own_session.add(db_chunk)
            await own_session.commit()
            logger.info("chunks_saved_to_db", count=len(chunks), document_id=document_id)
        except Exception as e:
            await own_session.rollback()
            logger.error("chunks_db_save_failed", error=str(e), document_id=document_id)
            await remove_chunk_vectors(workspace_id, document_id, [c.index for c in chunks])
            raise

    return len(chunks)


def _rebuild_bm25_excluding(workspace_id: str, excluded_ids: set[str]) -> None:
    """Synchronously rebuild the BM25 index without the given document ids.

    Blocking/CPU-bound (full corpus re-tokenize + re-index); callers should
    run this via ``asyncio.to_thread`` rather than inline on the event loop.
    """
    existing_index, existing_corpus, existing_metadatas = _load_bm25_index(workspace_id)
    if not existing_index or not existing_corpus:
        return

    filtered = [
        (doc, meta)
        for doc, meta in zip(existing_corpus, existing_metadatas)
        if meta.get("document_id") not in excluded_ids
    ]
    if filtered:
        new_corpus, new_metadatas = zip(*filtered)
        new_index = BM25Okapi([_bm25_tokenizer(doc) for doc in new_corpus])
        _save_bm25_index(workspace_id, new_index, list(new_corpus), list(new_metadatas))
    else:
        # All documents removed — clear index and cache. BM25Okapi([]) raises
        # ZeroDivisionError (avgdl = 0/0) and _save_bm25_index only serializes
        # the corpus anyway, so never build one for an empty corpus.
        _save_bm25_index(workspace_id, None, [], [])


def _rebuild_bm25_excluding_chunks(workspace_id: str, excluded: set[tuple[str, int]]) -> None:
    """Rebuild the BM25 index without the given ``(document_id, chunk_index)`` pairs.

    Blocking/CPU-bound; call via ``asyncio.to_thread``.
    """
    existing_index, existing_corpus, existing_metadatas = _load_bm25_index(workspace_id)
    if not existing_index or not existing_corpus:
        return

    filtered = [
        (doc, meta)
        for doc, meta in zip(existing_corpus, existing_metadatas)
        if (str(meta.get("document_id")), meta.get("chunk_index")) not in excluded
    ]
    if len(filtered) == len(existing_corpus):
        return
    if filtered:
        new_corpus, new_metadatas = zip(*filtered)
        new_index = BM25Okapi([_bm25_tokenizer(doc) for doc in new_corpus])
        _save_bm25_index(workspace_id, new_index, list(new_corpus), list(new_metadatas))
    else:
        # See _rebuild_bm25_excluding: BM25Okapi([]) raises ZeroDivisionError.
        _save_bm25_index(workspace_id, None, [], [])


async def remove_chunk_vectors(
    workspace_id: str, document_id: str, chunk_indexes: list[int]
) -> None:
    """Remove specific chunks from ChromaDB + BM25 — the compensating action
    for a vector write whose accompanying DB write did not commit.

    Scoped to the given chunk indexes rather than the whole document, so
    releasing one quarantined chunk cannot wipe the document's other chunks.
    Best-effort and never raises: it runs on an error path, and masking the
    original failure with a cleanup error would lose the real diagnosis.
    """
    if not chunk_indexes:
        return

    ids = [f"{document_id}:{index}" for index in chunk_indexes]
    try:
        collection = get_workspace_collection(workspace_id)
        await asyncio.to_thread(collection.delete, ids=ids)
        logger.info("chroma_chunk_rollback_complete", document_id=document_id, ids=ids)
    except Exception as e:
        logger.error("chroma_chunk_rollback_failed", error=str(e), document_id=document_id, ids=ids)

    try:
        excluded = {(document_id, index) for index in chunk_indexes}
        await asyncio.to_thread(_rebuild_bm25_excluding_chunks, workspace_id, excluded)
        logger.info("bm25_chunk_rollback_complete", document_id=document_id, ids=ids)
    except Exception as e:
        logger.error("bm25_chunk_rollback_failed", error=str(e), document_id=document_id, ids=ids)


async def delete_document(workspace_id: str, document_id: str) -> None:
    """Delete document chunks from ChromaDB + BM25 index."""
    # ChromaDB delete
    try:
        collection = get_workspace_collection(workspace_id)
        collection.delete(where={"document_id": document_id})
        logger.info("chromadb_delete_complete", document_id=document_id)
    except Exception as e:
        logger.error("chromadb_delete_failed", error=str(e), document_id=document_id)

    # BM25: rebuild without this document's chunks (expensive but robust).
    # Run off the event loop — full-corpus tokenize + BM25Okapi rebuild is
    # CPU-bound and would otherwise block every other request.
    try:
        await asyncio.to_thread(_rebuild_bm25_excluding, workspace_id, {document_id})
        logger.info("bm25_delete_complete", document_id=document_id)
    except Exception as e:
        logger.error("bm25_delete_failed", error=str(e), document_id=document_id)


async def purge_document_index(
    session: AsyncSession, workspace_id: str, document_id: str
) -> None:
    """Clear a document's vector index + `chunks` rows so it can be re-ingested.

    `run_ingestion_pipeline`/`store()` only INSERT — they don't upsert by
    document — so re-running ingestion without this first crashes on
    `uq_document_index` for every previously-stored chunk index and leaves
    stale Chroma/BM25 entries beyond the new chunk count.

    The caller owns the transaction: the `chunks` delete is staged on
    ``session`` and must be committed before the re-ingest task runs.
    """
    await delete_document(workspace_id, document_id)
    await session.execute(delete(Chunk).where(Chunk.document_id == document_id))


async def delete_documents(workspace_id: str, document_ids: list[str]) -> dict[str, str | None]:
    """Batch-delete document chunks from ChromaDB + BM25 index for one workspace.

    Unlike calling ``delete_document`` once per id, this issues exactly one
    Chroma ``$in`` delete and one BM25 rebuild for the whole batch, and
    returns a per-id error map instead of swallowing failures into a log
    line only.

    Returns:
        dict mapping each input document_id to None (success) or an error
        message (failure). A failure in either step marks every id in the
        batch as failed with that step's error, since a single Chroma
        collection call / BM25 rebuild cannot fail for only some ids.
    """
    results: dict[str, str | None] = dict.fromkeys(document_ids)
    if not document_ids:
        return results

    try:
        collection = get_workspace_collection(workspace_id)
        # chromadb's Where stub can't narrow a literal "$in" key from a plain
        # dict; the $in operator is valid at runtime (see Chroma's query docs).
        await asyncio.to_thread(
            collection.delete, where={"document_id": {"$in": document_ids}}  # type: ignore[dict-item]
        )
        logger.info("chromadb_batch_delete_complete", workspace_id=workspace_id, count=len(document_ids))
    except Exception as e:
        error = f"chromadb delete failed: {e}"
        logger.error("chromadb_batch_delete_failed", error=str(e), workspace_id=workspace_id)
        for doc_id in document_ids:
            results[doc_id] = error
        return results

    try:
        await asyncio.to_thread(_rebuild_bm25_excluding, workspace_id, set(document_ids))
        logger.info("bm25_batch_delete_complete", workspace_id=workspace_id, count=len(document_ids))
    except Exception as e:
        error = f"bm25 rebuild failed: {e}"
        logger.error("bm25_batch_delete_failed", error=str(e), workspace_id=workspace_id)
        for doc_id in document_ids:
            results[doc_id] = error

    return results


async def delete_workspace(workspace_id: str) -> None:
    """Delete entire workspace index data."""
    from app.chroma_client import delete_workspace_collection

    delete_workspace_collection(workspace_id)

    index_path = _get_bm25_path(workspace_id)
    if index_path.exists():
        index_path.unlink()
    
    # Clear the BM25 cache for this workspace
    clear_bm25_cache(workspace_id)
    logger.info("workspace_index_deleted", workspace_id=workspace_id)
