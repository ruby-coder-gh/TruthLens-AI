"""Tests for document loader."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.ingestion.loader import load


@pytest.mark.asyncio
async def test_load_txt(sample_txt_path: Path):
    """Test loading a text file."""
    pages = await load(sample_txt_path, "text/plain")
    assert len(pages) > 0
    assert "sample text" in pages[0]["text"]
    assert pages[0]["page_number"] is None


@pytest.mark.asyncio
async def test_load_nonexistent():
    """Test loading non-existent file raises error."""
    with pytest.raises(FileNotFoundError):
        await load(Path("nonexistent.txt"), "text/plain")


@pytest.mark.asyncio
async def test_load_unsupported_type():
    """Test loading unsupported mime type."""
    path = Path("test_data/test.xyz")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("test")
    with pytest.raises(ValueError, match="Unsupported mime type"):
        await load(path, "application/octet-stream")
    path.unlink()


@pytest.mark.asyncio
async def test_load_empty_txt():
    """Test loading empty text file."""
    path = Path("test_data/empty.txt")
    path.write_text("")
    pages = await load(path, "text/plain")
    assert len(pages) == 0
    path.unlink()


@pytest.mark.asyncio
async def test_load_csv():
    """Test loading a CSV file."""
    path = Path("test_data/test.csv")
    path.write_text("name,age\nAlice,30\nBob,25\n")
    pages = await load(path, "text/csv")
    assert len(pages) > 0
    assert "Alice" in pages[0]["text"]
    path.unlink()


@pytest.mark.asyncio
async def test_load_pdf_reverses_ligature_glyphs():
    """PyMuPDF's `Story` HTML layout (used to build the demo corpus PDFs) can
    substitute a single ligature glyph for an "fi"/"fl" letter pair (e.g.
    "Whitfield" -> "Whitﬁeld", U+FB01). Loading must return the plain ASCII
    the document actually says, or BM25 tokenization and citation excerpts
    silently stop matching a name typed normally."""
    import fitz

    path = Path("test_data/ligature.pdf")
    path.parent.mkdir(parents=True, exist_ok=True)
    story = fitz.Story(html="<p>Dana Whitfield is the Chief Executive Officer.</p>")
    mediabox = fitz.paper_rect("a4")
    where = mediabox + (36, 36, -36, -36)
    writer = fitz.DocumentWriter(str(path))
    more = True
    while more:
        device = writer.begin_page(mediabox)
        more, _ = story.place(where)
        story.draw(device)
        writer.end_page()
    writer.close()

    pages = await load(path, "application/pdf")

    assert len(pages) > 0
    assert "Whitfield" in pages[0]["text"]
    assert "ﬁ" not in pages[0]["text"]
    path.unlink()
