"""Shared Markdown rendering and tabular export helpers."""

from __future__ import annotations

import csv
from io import StringIO
from typing import Any, Iterable, Sequence


# Characters that make a spreadsheet treat a cell as a formula. Excel,
# LibreOffice and Google Sheets all evaluate these on load, and quoting does not
# help — the consumer strips the CSV quotes before parsing the cell.
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _neutralize_cell(value: Any) -> Any:
    """Defuse a formula-leading *string* cell by prefixing a single quote.

    OWASP CSV-injection guidance. Only `str` values are touched: a number
    rendered from an `int`/`float` (a negative cost or latency, say) is produced
    by this application, not by a user, and prefixing it would corrupt the
    column for every legitimate consumer.
    """
    if isinstance(value, str) and value.startswith(_FORMULA_PREFIXES):
        return f"'{value}"
    return value


def rows_to_csv(headers: Sequence[str], rows: Iterable[Sequence[Any]]) -> str:
    """Render tabular rows to a CSV string via the stdlib `csv` module.

    Uses `csv.writer`'s standard quoting rules, so values containing commas,
    double-quotes, or newlines are escaped correctly (quoted, with embedded
    quotes doubled) and round-trip cleanly through `csv.reader`.

    Formula-leading string cells are neutralised here rather than at each call
    site, so every export inherits it: several columns (workspace names,
    usernames, audit `details`) carry text a low-privileged user chose, and the
    reader is an admin.
    """
    buffer = StringIO()
    writer = csv.writer(buffer)
    writer.writerow(headers)
    writer.writerows([_neutralize_cell(cell) for cell in row] for row in rows)
    return buffer.getvalue()


def render_evidence_markdown(sources: Iterable[dict[str, Any]]) -> str:
    """Render persisted source snapshots consistently across export formats."""
    items: list[str] = []
    for index, source in enumerate(sources, start=1):
        metadata = source.get("metadata") if isinstance(source.get("metadata"), dict) else {}
        document_name = source.get("document_name") or metadata.get("document_name") or "Untitled"
        excerpt = source.get("excerpt") or source.get("content") or source.get("text") or ""
        page_number = source.get("page_number") or metadata.get("page_number")
        page_suffix = f" (p. {page_number})" if page_number is not None else ""
        items.append(f"{index}. **{document_name}**{page_suffix}\n   > {excerpt}")
    return "\n\n".join(items) if items else "_No sources cited._"


def render_investigation_markdown(
    *,
    investigation_id: str,
    workspace_name: str,
    query: str,
    final_report: str,
    trust_score: float | None,
    review_status: str,
    review_note: str | None,
    sources: Iterable[dict[str, Any]],
) -> str:
    """Render the human-readable part of an investigation audit bundle."""
    trust = f"{round(trust_score * 100)}%" if trust_score is not None else "_Not scored._"
    review = review_note or "_No reviewer note._"
    return (
        "# TruthLens Investigation Audit Bundle\n\n"
        "## Case metadata\n"
        f"- **Case ID:** {investigation_id}\n"
        f"- **Workspace:** {workspace_name}\n"
        f"- **Review status:** {review_status}\n"
        f"- **Trust score:** {trust}\n\n"
        "## Question\n"
        f"{query}\n\n"
        "## Executive report\n"
        f"{final_report or '_No report generated._'}\n\n"
        "## Human review\n"
        f"{review}\n\n"
        "## Evidence register\n"
        f"{render_evidence_markdown(sources)}\n"
    )
