"""Document loader — supports PDF/DOCX/TXT/MD/CSV."""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

import markdown
from docx import Document as DocxDocument

from app.utils.logger import logger

try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None  # type: ignore[assignment]


async def load(path: Path, mime_type: str) -> list[dict[str, Any]]:
    """Load document from disk -> list of page/dict text segments with metadata.

    Returns list of dicts: {"text": str, "page_number": int | None, "metadata": dict}
    """
    logger.info("loading_document", path=str(path), mime_type=mime_type)

    if not path.exists():
        raise FileNotFoundError(f"File not found: {path}")

    if mime_type == "application/pdf":
        return _load_pdf(path)
    elif mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return _load_docx(path)
    elif mime_type == "text/plain":
        return _load_text(path)
    elif mime_type == "text/markdown":
        return _load_markdown(path)
    elif mime_type == "text/csv":
        return _load_csv(path)
    else:
        raise ValueError(f"Unsupported mime type: {mime_type}")


def _load_pdf(path: Path) -> list[dict[str, Any]]:
    if fitz is None:
        raise ImportError("PyMuPDF (fitz) is required for PDF loading. Install with: pip install PyMuPDF")

    doc = fitz.open(path)
    pages: list[dict[str, Any]] = []
    for page_num in range(len(doc)):
        page = doc[page_num]
        text = page.get_text().strip()
        if text:
            pages.append({
                "text": text,
                "page_number": page_num + 1,
                "metadata": {
                    "source": path.name,
                    "page": page_num + 1,
                },
            })
    doc.close()
    logger.info("pdf_loaded", pages=len(pages), path=str(path))
    return pages


def _load_docx(path: Path) -> list[dict[str, Any]]:
    doc = DocxDocument(str(path))
    pages: list[dict[str, Any]] = []
    full_text: list[str] = []

    for para in doc.paragraphs:
        if para.text.strip():
            full_text.append(para.text.strip())

    # DOCX doesn't have page numbers natively; treat as single page
    text = "\n".join(full_text)
    if text:
        pages.append({
            "text": text,
            "page_number": None,
            "metadata": {"source": path.name},
        })

    logger.info("docx_loaded", paragraphs=len(full_text), path=str(path))
    return pages


def _load_text(path: Path) -> list[dict[str, Any]]:
    text = path.read_text(encoding="utf-8", errors="replace").strip()
    if not text:
        return []

    return [{
        "text": text,
        "page_number": None,
        "metadata": {"source": path.name},
    }]


def _load_markdown(path: Path) -> list[dict[str, Any]]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    # Strip markdown formatting to plain text
    html = markdown.markdown(raw)
    # Simple HTML-to-text extraction
    import re
    text = re.sub(r"<[^>]+>", "", html)
    text = text.strip()

    if not text:
        return []

    return [{
        "text": text,
        "page_number": None,
        "metadata": {"source": path.name},
    }]


def _load_csv(path: Path) -> list[dict[str, Any]]:
    pages: list[dict[str, Any]] = []
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        reader = csv.reader(f)
        rows: list[str] = []
        for row in reader:
            rows.append(", ".join(row))

    if rows:
        pages.append({
            "text": "\n".join(rows),
            "page_number": None,
            "metadata": {"source": path.name, "row_count": len(rows)},
        })

    logger.info("csv_loaded", rows=len(rows), path=str(path))
    return pages
