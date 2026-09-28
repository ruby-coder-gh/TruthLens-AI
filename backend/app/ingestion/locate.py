"""Locate a chunk's text inside its source PDF, for the source viewer.

Pure, synchronous PyMuPDF work — callers must run `locate_in_pdf` via
`asyncio.to_thread` (PDF search is CPU-bound and blocks the event loop).
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
_WINDOW_SIZE = 10
_EDGE_WORDS = 6
_MAX_RECTS = 200
# A per-page PyMuPDF search is not cheap; scanning every page on every
# request-time call doesn't scale past a certain document size. Bound the
# fallback to a small window around the hint, and only fall through to a
# whole-document scan for PDFs small enough that it stays cheap.
_HINT_WINDOW = 2
_MAX_PAGES_FOR_FULL_SCAN = 60


def _split_into_fragments(content: str) -> list[str]:
    """Sentences; long sentences broken into ~10-word windows."""
    sentences = [s.strip() for s in _SENTENCE_SPLIT_RE.split(content.strip()) if s.strip()]
    if not sentences:
        return [content.strip()] if content.strip() else []

    fragments: list[str] = []
    for sentence in sentences:
        words = sentence.split()
        if len(words) <= _WINDOW_SIZE:
            fragments.append(sentence)
        else:
            for i in range(0, len(words), _WINDOW_SIZE):
                window = " ".join(words[i : i + _WINDOW_SIZE])
                if window:
                    fragments.append(window)
    return fragments


def _first_last_words(content: str, n: int = _EDGE_WORDS) -> list[str]:
    words = content.split()
    if not words:
        return []
    first = " ".join(words[:n])
    last = " ".join(words[-n:])
    return [f for f in dict.fromkeys([first, last]) if f]


def _rects_overlap(a: list[float], b: list[float]) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _merge_overlapping(rects: list[list[float]]) -> list[list[float]]:
    # ponytail: single-pass merge (O(n^2), n capped at _MAX_RECTS) — a
    # newly-merged rect isn't re-checked against earlier ones. Fine at this
    # scale (one chunk's fragments); switch to a sweep-line merge if a
    # pathological chunk ever produces enough hits to make this slow.
    merged: list[list[float]] = []
    for r in rects:
        merged_index = next((i for i, m in enumerate(merged) if _rects_overlap(r, m)), None)
        if merged_index is None:
            merged.append(list(r))
        else:
            m = merged[merged_index]
            merged[merged_index] = [
                min(m[0], r[0]),
                min(m[1], r[1]),
                max(m[2], r[2]),
                max(m[3], r[3]),
            ]
    return merged[:_MAX_RECTS]


def _search_page(page: Any, content: str) -> list[list[float]]:
    """Find `content`'s fragments on `page`; returns merged, capped rects."""
    fragments = _split_into_fragments(content)
    rects: list[list[float]] = []
    for fragment in fragments:
        for hit in page.search_for(fragment):
            rects.append([hit.x0, hit.y0, hit.x1, hit.y1])

    if not rects:
        for fragment in _first_last_words(content):
            for hit in page.search_for(fragment):
                rects.append([hit.x0, hit.y0, hit.x1, hit.y1])

    return _merge_overlapping(rects)


def locate_in_pdf(file_path: Path, page_number_hint: int | None, content: str) -> dict[str, Any]:
    """Find where `content` sits in the PDF at `file_path`.

    `page_number_hint` is 1-based (as stored in Chroma metadata) and may be
    None if the metadata lookup failed. Search order: the hinted page, then
    the next page (content can spill across a page break), then the rest of
    the hinted page's +/-2 window, then — only for PDFs of at most
    `_MAX_PAGES_FOR_FULL_SCAN` pages — every other page in order. Past that
    size, the whole-document scan is skipped (too expensive per call). If no
    fragment matches anywhere it falls back to the hinted page (or page 1)
    with empty rects — the viewer can still show the right page even without
    a highlight ("text mode").

    Returns: {page_number, page_count, page_width, page_height, rects}.
    """
    import fitz

    doc = fitz.open(file_path)
    try:
        page_count = doc.page_count
        if page_count == 0:
            return {
                "page_number": None,
                "page_count": 0,
                "page_width": None,
                "page_height": None,
                "rects": [],
            }

        candidates: list[int] = []
        if page_number_hint is not None and 1 <= page_number_hint <= page_count:
            hint_index = page_number_hint - 1
            candidates.append(hint_index)
            if hint_index + 1 < page_count:
                candidates.append(hint_index + 1)
            for offset in range(-1, -_HINT_WINDOW - 1, -1):
                neighbor = hint_index + offset
                if 0 <= neighbor < page_count and neighbor not in candidates:
                    candidates.append(neighbor)
            for offset in range(2, _HINT_WINDOW + 1):
                neighbor = hint_index + offset
                if 0 <= neighbor < page_count and neighbor not in candidates:
                    candidates.append(neighbor)

        if page_count <= _MAX_PAGES_FOR_FULL_SCAN:
            for i in range(page_count):
                if i not in candidates:
                    candidates.append(i)

        for page_index in candidates:
            page = doc[page_index]
            rects = _search_page(page, content)
            if rects:
                return {
                    "page_number": page_index + 1,
                    "page_count": page_count,
                    "page_width": page.rect.width,
                    "page_height": page.rect.height,
                    "rects": rects,
                }

        fallback_index = (page_number_hint - 1) if page_number_hint and 1 <= page_number_hint <= page_count else 0
        fallback_page = doc[fallback_index]
        return {
            "page_number": fallback_index + 1,
            "page_count": page_count,
            "page_width": fallback_page.rect.width,
            "page_height": fallback_page.rect.height,
            "rects": [],
        }
    finally:
        doc.close()
