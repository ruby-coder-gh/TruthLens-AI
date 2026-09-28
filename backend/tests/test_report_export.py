"""Unit tests for backend markdown export helpers (`app/report_export.py`)."""

from __future__ import annotations

from app.report_export import render_investigation_markdown


def test_render_investigation_markdown_normalizes_source_markers():
    """BUG-9 (backend): `[source:N]` markers in the LLM-generated report must
    become plain `[N]` in the exported markdown, with the source list already
    provided by the Evidence register section below."""
    md = render_investigation_markdown(
        investigation_id="inv-1",
        workspace_name="Northwind Renewables",
        query="What was 2025 revenue?",
        final_report="Revenue was €412M [source:1]. It disagrees with €398M [source:2].",
        trust_score=0.86,
        review_status="pending",
        review_note=None,
        sources=[
            {"document_name": "Annual Report 2025", "excerpt": "Revenue: €412M", "page_number": 1},
            {"document_name": "Press Release", "excerpt": "Revenue: €398M", "page_number": None},
        ],
    )

    assert "[source:1]" not in md
    assert "[source:2]" not in md
    assert "[1]" in md
    assert "[2]" in md
    # The source list (Evidence register) is still present.
    assert "Annual Report 2025" in md
    assert "Press Release" in md
