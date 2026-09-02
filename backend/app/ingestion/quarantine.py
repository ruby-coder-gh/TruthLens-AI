"""Ingest-time prompt-injection quarantine scan (F7a).

`detect_injection()` (app/generation/safety.py) was designed for short,
adversarial *user queries* — several of its patterns (jailbreak keywords,
delimiter confusion, code-fence starts, generic code-call syntax) fire
constantly on ordinary document prose ("Dan Rather anchored...", an
Appendix heading, a code sample, "please call print(total)"). Running that
full, unfiltered pattern set over every ingested chunk would silently
quarantine (and thus delete from the retrievable corpus) a large fraction
of legitimate documents.

This module runs a *filtered* subset of `safety.INJECTION_PATTERNS` at
ingestion time: only patterns at or above `settings.QUARANTINE_MIN_SEVERITY`
whose name is not in `INGEST_EXCLUDED_PATTERNS` below. Quarantined chunk
text never proceeds to embed/store, so it never enters Chroma/BM25 — no
retrieval-filter changes are required elsewhere.
"""

from __future__ import annotations

from typing import Any

from app.config import settings
from app.generation.safety import INJECTION_PATTERNS
from app.ingestion.chunker import ChunkResult

EXCERPT_MAX_CHARS = 500

_SEVERITY_ORDER: dict[str, int] = {"low": 0, "medium": 1, "high": 2}

# Patterns that are valuable signal on short adversarial *queries* but
# routinely false-positive on ordinary document prose, so they are excluded
# from the ingest-time scan regardless of configured severity floor:
#   - jailbreak_keyword: `\bDAN\b` matches names like "Dan Rather"
#   - delimiter_confusion: a leading "---"/"***" is a normal Markdown/heading rule
#   - code_block_start: a leading ``` is a normal fenced code sample
#   - code_injection: `print(...)`/`exec(...)` etc. appear in ordinary
#     technical/how-to documents ("call print(total) to display...")
#   - forget_everything: "forget everything you heard at the meeting" is
#     ordinary meeting-notes language, not an instruction to the model
#   - you_are_not: "You are not required to file this form..." is common
#     regulatory/legal boilerplate
INGEST_EXCLUDED_PATTERNS: frozenset[str] = frozenset(
    {
        "jailbreak_keyword",
        "delimiter_confusion",
        "code_block_start",
        "code_injection",
        "forget_everything",
        "you_are_not",
    }
)


def _build_ingest_patterns(min_severity: str) -> list[dict[str, Any]]:
    """Return the query-side pattern list filtered for ingest-time use."""
    floor = _SEVERITY_ORDER.get(min_severity, _SEVERITY_ORDER["high"])
    return [
        entry
        for entry in INJECTION_PATTERNS
        if entry["name"] not in INGEST_EXCLUDED_PATTERNS
        and _SEVERITY_ORDER.get(entry["severity"], 0) >= floor
    ]


def _detect_ingest_injection(text: str, patterns: list[dict[str, Any]]) -> dict[str, Any]:
    """Same shape as `safety.detect_injection`, but against a pattern subset."""
    if not text or not text.strip():
        return {"detected": False, "pattern": None, "severity": None}

    for entry in patterns:
        if entry["pattern"].search(text):
            return {
                "detected": True,
                "pattern": entry["name"],
                "severity": entry["severity"],
            }
    return {"detected": False, "pattern": None, "severity": None}


def scan_chunks(chunks: list[ChunkResult]) -> tuple[list[ChunkResult], list[dict[str, Any]]]:
    """Split *chunks* into clean and quarantined based on injection detection.

    Reads `settings.QUARANTINE_ENABLED` / `settings.QUARANTINE_MIN_SEVERITY`
    on every call (not cached at import time) so tests can monkeypatch them.
    When disabled, every chunk is returned clean.

    Args:
        chunks: Chunks produced by `app.ingestion.chunker.chunk`.

    Returns:
        Tuple of (clean_chunks, quarantined) where quarantined is a list of
        dicts with keys: index, pattern, severity, excerpt (<=500 chars),
        content (full chunk text, kept for later release/re-embed).
    """
    if not settings.QUARANTINE_ENABLED:
        return list(chunks), []

    patterns = _build_ingest_patterns(settings.QUARANTINE_MIN_SEVERITY)

    clean: list[ChunkResult] = []
    quarantined: list[dict[str, Any]] = []

    for chunk_result in chunks:
        verdict = _detect_ingest_injection(chunk_result.content, patterns)
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
