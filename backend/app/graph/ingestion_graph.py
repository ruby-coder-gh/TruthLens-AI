"""Orchestrated ingestion pipeline using LangGraph."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from app.config import settings
from app.ingestion.chunker import ChunkResult, chunk
from app.ingestion.embedder import EmbeddingResult, embed
from app.ingestion.indexer import store
from app.ingestion.loader import load
from app.utils.logger import logger


class IngestionState:
    """State for ingestion graph."""

    def __init__(
        self,
        document_id: str,
        workspace_id: str,
        file_path: Path,
        mime_type: str,
        original_filename: str = "",
    ) -> None:
        self.document_id = document_id
        self.workspace_id = workspace_id
        self.file_path = file_path
        self.mime_type = mime_type
        self.original_filename = original_filename
        self.pages: list[dict[str, Any]] = []
        self.chunks: list[ChunkResult] = []
        self.embeddings: list[EmbeddingResult] = []
        self.chunk_count: int = 0
        self.error: str | None = None


async def run_ingestion_pipeline(
    document_id: str,
    workspace_id: str,
    file_path: Path,
    mime_type: str,
    original_filename: str = "",
) -> dict[str, Any]:
    """Run the full ingestion pipeline: load → chunk → embed → store.

    Args:
        document_id: Document UUID.
        workspace_id: Workspace UUID.
        file_path: Path to uploaded file.
        mime_type: MIME type of the file.
        original_filename: Original filename.

    Returns:
        Dict with status ("success" | "failed"), chunk_count, error.
    """
    state = IngestionState(
        document_id=document_id,
        workspace_id=workspace_id,
        file_path=file_path,
        mime_type=mime_type,
        original_filename=original_filename,
    )

    logger.info(
        "ingestion_pipeline_start",
        document_id=document_id,
        workspace_id=workspace_id,
        mime_type=mime_type,
    )

    try:
        # 1. Load
        logger.info("ingestion_phase", phase="load", document_id=document_id)
        state.pages = await load(state.file_path, state.mime_type)
        if not state.pages:
            raise ValueError(f"No content extracted from {state.original_filename}")

        # 2. Chunk
        logger.info("ingestion_phase", phase="chunk", document_id=document_id, pages=len(state.pages))
        state.chunks = await chunk(
            state.pages,
            document_id=state.document_id,
        )
        if not state.chunks:
            raise ValueError(f"No chunks generated from {state.original_filename}")

        # 3. Embed
        logger.info("ingestion_phase", phase="embed", document_id=document_id, chunks=len(state.chunks))
        state.embeddings = await embed(state.chunks, document_name=state.original_filename)

        # 4. Store
        logger.info("ingestion_phase", phase="store", document_id=document_id)
        state.chunk_count = await store(
            chunks=state.chunks,
            embeddings=state.embeddings,
            workspace_id=state.workspace_id,
            document_id=state.document_id,
        )

        logger.info(
            "ingestion_pipeline_complete",
            document_id=document_id,
            chunk_count=state.chunk_count,
        )
        return {
            "status": "success",
            "chunk_count": state.chunk_count,
            "error": None,
        }

    except Exception as e:
        logger.error(
            "ingestion_pipeline_failed",
            document_id=document_id,
            error=str(e),
            exc_info=True,
        )
        return {
            "status": "failed",
            "chunk_count": 0,
            "error": str(e),
        }
