"""ChromaDB singleton client."""

from __future__ import annotations

from functools import lru_cache

import chromadb
from chromadb.config import Settings as ChromaSettings

from app.config import settings
from app.utils.logger import logger


@lru_cache(maxsize=1)
def get_chroma_client() -> chromadb.ClientAPI:
    """Return singleton ChromaDB client (persistent)."""
    return chromadb.PersistentClient(
        path=str(settings.chroma_path),
        settings=ChromaSettings(
            anonymized_telemetry=False,
            allow_reset=False,
        ),
    )


def get_workspace_collection(workspace_id: str) -> chromadb.Collection:
    """Get or create a ChromaDB collection for a workspace."""
    client = get_chroma_client()
    collection_name = f"{settings.CHROMA_COLLECTION_PREFIX}{workspace_id}_chunks"
    return client.get_or_create_collection(
        name=collection_name,
        metadata={"hnsw:space": "cosine"},
    )


def delete_workspace_collection(workspace_id: str) -> None:
    """Delete a workspace's ChromaDB collection."""
    client = get_chroma_client()
    collection_name = f"{settings.CHROMA_COLLECTION_PREFIX}{workspace_id}_chunks"
    try:
        client.delete_collection(collection_name)
    except ValueError as e:
        logger.debug("chroma_collection_delete_noop", collection=collection_name, error=str(e))


def delete_document_from_collection(
    workspace_id: str, document_id: str
) -> None:
    """Delete all chunks for a document from ChromaDB."""
    collection = get_workspace_collection(workspace_id)
    collection.delete(where={"document_id": document_id})
