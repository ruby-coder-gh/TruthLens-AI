"""Semantic chunking with configurable size and overlap."""

from __future__ import annotations

import uuid
from typing import Any

from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.config import settings


class ChunkResult:
    """Result of chunking operation."""

    def __init__(
        self,
        id: str,
        document_id: str,
        index: int,
        content: str,
        token_count: int,
        page_number: int | None = None,
        metadata: dict | None = None,
    ) -> None:
        self.id = id
        self.document_id = document_id
        self.index = index
        self.content = content
        self.token_count = token_count
        self.page_number = page_number
        self.metadata = metadata or {}


def _count_tokens(text: str) -> int:
    """Approximate token count (4 chars per token)."""
    return len(text) // 4


async def chunk(
    pages: list[dict[str, Any]],
    document_id: str,
    chunk_size: int | None = None,
    chunk_overlap: int | None = None,
) -> list[ChunkResult]:
    """Split document pages into overlapping chunks.

    Args:
        pages: List of dicts with "text", "page_number", "metadata" keys.
        document_id: UUID of the document.
        chunk_size: Target chunk size in tokens.
        chunk_overlap: Overlap between chunks in tokens.

    Returns:
        List of ChunkResult objects.
    """
    size = chunk_size or settings.CHUNK_SIZE
    overlap = chunk_overlap or settings.CHUNK_OVERLAP

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=size * 4,  # Convert tokens to chars (4 chars/token)
        chunk_overlap=overlap * 4,
        separators=settings.CHUNK_SEPARATORS,
        length_function=len,
    )

    all_chunks: list[ChunkResult] = []
    global_index = 0

    for page in pages:
        text = page.get("text", "")
        page_number = page.get("page_number")
        metadata = page.get("metadata", {})

        if not text.strip():
            continue

        split_texts = splitter.split_text(text)

        for st in split_texts:
            st = st.strip()
            if not st:
                continue

            chunk_result = ChunkResult(
                id=str(uuid.uuid4()),
                document_id=document_id,
                index=global_index,
                content=st,
                token_count=_count_tokens(st),
                page_number=page_number,
                metadata={**metadata, "chunk_index": global_index},
            )
            all_chunks.append(chunk_result)
            global_index += 1

    return all_chunks
