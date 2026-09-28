"""Unit tests for app.ingestion.locate — PyMuPDF passage search."""

from __future__ import annotations

from pathlib import Path

from app.ingestion.locate import (
    _merge_overlapping,
    _split_into_fragments,
    locate_in_pdf,
)


def _write_two_page_pdf(path: Path) -> tuple[str, str]:
    import fitz

    page1_text = "The quick brown fox jumps over the lazy dog. It ran across the field quickly."
    page2_text = "Renewable energy adoption is accelerating worldwide in most major economies."

    doc = fitz.open()
    doc.new_page().insert_text((72, 100), page1_text, fontsize=11)
    doc.new_page().insert_text((72, 100), page2_text, fontsize=11)
    doc.save(path)
    doc.close()
    return page1_text, page2_text


def test_split_into_fragments_short_sentence_kept_whole():
    fragments = _split_into_fragments("Hello world. This is short.")
    assert fragments == ["Hello world.", "This is short."]


def test_split_into_fragments_long_sentence_windowed():
    long_sentence = " ".join(f"word{i}" for i in range(25)) + "."
    fragments = _split_into_fragments(long_sentence)
    # 25 words > 10-word window -> split into ceil(25/10) = 3 windows
    assert len(fragments) == 3
    assert all(len(f.split()) <= 10 for f in fragments)


def test_split_into_fragments_empty_content():
    assert _split_into_fragments("") == []
    assert _split_into_fragments("   ") == []


def test_merge_overlapping_merges_intersecting_rects():
    rects = [[0, 0, 10, 10], [5, 5, 15, 15], [100, 100, 110, 110]]
    merged = _merge_overlapping(rects)
    assert len(merged) == 2
    big = next(r for r in merged if r[2] > 50)
    assert big == [100, 100, 110, 110]
    small = next(r for r in merged if r[2] <= 50)
    assert small == [0, 0, 15, 15]


def test_merge_overlapping_caps_at_200():
    rects = [[i, i, i + 1, i + 1] for i in range(0, 2000, 2)]  # 1000 disjoint rects
    merged = _merge_overlapping(rects)
    assert len(merged) == 200


def test_locate_in_pdf_finds_correct_page_and_in_bounds_rects(tmp_path):
    pdf_path = tmp_path / "two_page.pdf"
    page1_text, page2_text = _write_two_page_pdf(pdf_path)

    result = locate_in_pdf(pdf_path, page_number_hint=2, content=page2_text)

    assert result["page_number"] == 2
    assert result["page_count"] == 2
    assert result["page_width"] > 0
    assert result["page_height"] > 0
    assert len(result["rects"]) > 0
    for x0, y0, x1, y1 in result["rects"]:
        assert 0 <= x0 < x1 <= result["page_width"]
        assert 0 <= y0 < y1 <= result["page_height"]


def test_locate_in_pdf_wrong_hint_falls_back_to_full_search(tmp_path):
    pdf_path = tmp_path / "two_page.pdf"
    page1_text, page2_text = _write_two_page_pdf(pdf_path)

    # Content is really on page 2; hint says page 1 (stale/bad metadata).
    result = locate_in_pdf(pdf_path, page_number_hint=1, content=page2_text)

    assert result["page_number"] == 2
    assert len(result["rects"]) > 0


def test_locate_in_pdf_no_hint_searches_from_page_one(tmp_path):
    pdf_path = tmp_path / "two_page.pdf"
    page1_text, page2_text = _write_two_page_pdf(pdf_path)

    result = locate_in_pdf(pdf_path, page_number_hint=None, content=page1_text)

    assert result["page_number"] == 1
    assert len(result["rects"]) > 0


def test_locate_in_pdf_content_not_present_falls_back_without_crashing(tmp_path):
    pdf_path = tmp_path / "two_page.pdf"
    _write_two_page_pdf(pdf_path)

    result = locate_in_pdf(pdf_path, page_number_hint=2, content="Text that appears nowhere in this document.")

    assert result["page_number"] == 2  # falls back to the hinted page
    assert result["rects"] == []
    assert result["page_count"] == 2
