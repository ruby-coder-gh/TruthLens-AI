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


@pytest.mark.asyncio
async def test_load_pdf_returns_one_clean_paragraph_per_text_block(tmp_path: Path):
    """Plain `page.get_text()` hard-breaks every rendered line, so a heading, a
    table row and the next paragraph's prose ran together into one pseudo-
    sentence ("Sincerely, Dana Whitfield Chief Executive Officer Financial
    Highlights Metric 2025 ...") that the Contradiction Radar sent to NLI."""
    import fitz

    prose = (
        "Revenue in 2025 was €412 million, up from €356 million in 2024, driven by a full year "
        "of output from the Kestrel Ridge onshore expansion and higher merchant power prices."
    )
    html = (
        "<h2>Financial Highlights</h2>"
        f"<p>{prose}</p>"
        "<table><tr><td>Revenue</td><td>€412M</td></tr></table>"
    )
    path = tmp_path / "blocks.pdf"
    story = fitz.Story(html=html)
    writer = fitz.DocumentWriter(str(path))
    more = True
    while more:
        device = writer.begin_page(fitz.paper_rect("a5"))
        more, _ = story.place(fitz.paper_rect("a5") + (36, 36, -36, -36))
        story.draw(device)
        writer.end_page()
    writer.close()

    pages = await load(path, "application/pdf")

    assert pages[0]["page_number"] == 1
    assert pages[0]["text"].split("\n\n") == ["Financial Highlights", prose, "Revenue €412M"]


@pytest.mark.asyncio
async def test_load_pdf_rejoins_words_hyphenated_across_lines(tmp_path: Path):
    import fitz

    path = tmp_path / "hyphen.pdf"
    doc = fitz.open()
    doc.new_page().insert_text((72, 100), "Turbine foundation fabri-\ncation began in the fourth quarter.")
    doc.save(path)
    doc.close()

    pages = await load(path, "application/pdf")

    assert pages[0]["text"] == "Turbine foundation fabrication began in the fourth quarter."
