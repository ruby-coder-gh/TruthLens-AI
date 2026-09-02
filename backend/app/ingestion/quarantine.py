"""Ingest-time prompt-injection quarantine scan (F7a).

Runs the existing query-side `detect_injection()` heuristic over every chunk
at ingestion time (pipeline step 2.5, between chunk and embed). Quarantined
chunk text never proceeds to embed/store, so it never enters Chroma/BM25 —
no retrieval-filter changes are required elsewhere.
"""

from __future__ import annotations

from typing import Any

from app.generation.safety import detect_injection
from app.ingestion.chunker import ChunkResult

EXCERPT_MAX_CHARS = 500


def scan_chunks(chunks: list[ChunkResult]) -> tuple[list[ChunkResult], list[dict[str, Any]]]:
    """Split *chunks* into clean and quarantined based on injection detection.

    Args:
        chunks: Chunks produced by `app.ingestion.chunker.chunk`.

    Returns:
        Tuple of (clean_chunks, quarantined) where quarantined is a list of
        dicts with keys: index, pattern, severity, excerpt (<=500 chars),
        content (full chunk text, kept for later release/re-embed).
    """
    clean: list[ChunkResult] = []
    quarantined: list[dict[str, Any]] = []

    for chunk_result in chunks:
        verdict = detect_injection(chunk_result.content)
        if verdict["detected"]:
            quarantined.append(
                {
                    "index": chunk_result.index,
                    "pattern": verdict["pattern"],
                    "severity": verdict["severity"],
                    "excerpt": chunk_result.content[:EXCERPT_MAX_CHARS],
                    "content": chunk_result.content,
                }
            )
        else:
            clean.append(chunk_result)

    return clean, quarantined
