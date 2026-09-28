"""Document loader — supports PDF/DOCX/TXT/MD/CSV."""

from __future__ import annotations

import csv
import re
import unicodedata
from pathlib import Path
from typing import Any

import markdown
from docx import Document as DocxDocument

from app.utils.logger import logger

try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None  # type: ignore[assignment]

_LINE_END_HYPHEN = re.compile(r"(?<=[a-z])-\n(?=[a-z])")
_LINE_END_COMPOUND = re.compile(r"(?<=\w)-\s*\n\s*(?=[A-Z0-9])")


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
        # PyMuPDF's text layout substitutes ligature glyphs (e.g. "fi" -> the
        # single U+FB01 codepoint) whenever the page's font supports them, so
        # a name like "Whitfield" comes back as "Whitﬁeld". NFKC's
        # compatibility decomposition reverses exactly that substitution,
        # keeping BM25 tokenization and citation excerpts matching the plain
        # ASCII the document actually says.
        # One paragraph per text block, blocks split by blank lines: plain
        # `get_text()` hard-breaks every rendered line, which glued headings
        # and table cells onto the next prose sentence.
        paragraphs = [_block_paragraph(block[4]) for block in page.get_text("blocks") if block[6] == 0]
        text = "\n\n".join(p for p in paragraphs if p)
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


def _block_paragraph(block_text: str) -> str:
    """A PDF text block's lines as one paragraph: NFKC, line-end hyphens rejoined, whitespace collapsed."""
    text = unicodedata.normalize("NFKC", block_text)
    # ponytail: "fabri-\ncation" -> "fabrication" also turns a compound split
    # at its hyphen ("gas-\nbacked") into "gasbacked"; needs a dictionary to tell apart.
    text = _LINE_END_HYPHEN.sub("", text)
    # "Fourth-\nQuarter" is a real compound: keep the hyphen, drop the break.
    text = _LINE_END_COMPOUND.sub("-", text)
    return " ".join(text.split())


def _load_docx(path: Path) -> list[dict[str, Any]]:
    doc = DocxDocument(str(path))
    pages: list[dict[str, Any]] = []
    full_text: list[str] = []

    for para in doc.paragraphs:
        if para.text.strip():
            full_text.append(para.text.strip())

    # DOCX doesn't have page numbers natively; treat as single page. Blank
    # line between paragraphs, as for PDF blocks.
    text = "\n\n".join(full_text)
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
    # Simple HTML-to-text extraction; blank line between blocks (headings,
    # paragraphs, list items), as for PDF/DOCX.
    text = re.sub(r"<[^>]+>", "", html.replace(">\n<", ">\n\n<"))
    text = text.strip()

    if not text:
        return []

    return [{
        "text": text,
        "page_number": None,
        "metadata": {"source": path.name},
    }]


def _load_csv(path: Path) -> list[dict[str, Any]]:
    # C7: one page per data row (chunker below turns each page into its own
    # chunk), header repeated as "Column: value; …" text on every row so a
    # single row stays retrievable on its own instead of being buried inside
    # a single whole-file chunk.
    pages: list[dict[str, Any]] = []
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames or []
        for i, row in enumerate(reader):
            fields = "; ".join(f"{h}: {(row.get(h) or '').strip()}" for h in headers)
            if not fields.strip():
                continue
            pages.append({
                "text": fields,
                "page_number": None,
                "metadata": {"source": path.name, "row_index": i},
            })

    logger.info("csv_loaded", rows=len(pages), path=str(path))
    return pages
