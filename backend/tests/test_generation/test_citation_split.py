"""Merged citations from small models are split into one marker per source."""

import pytest

from app.generation.generator import _CitationStreamFilter, split_combined_citations


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("€412M [source:1:2].", "€412M [source:1][source:2]."),
        ("x [source:1, 2] y", "x [source:1][source:2] y"),
        ("x [source: 3; source:4]", "x [source:3][source:4]"),
        ("x [source:1] and [source:2]", "x [source:1] and [source:2]"),
        ("a [link] b", "a [link] b"),
    ],
)
def test_split_combined_citations(raw, expected):
    assert split_combined_citations(raw) == expected


def test_stream_filter_handles_a_marker_split_across_chunks():
    f = _CitationStreamFilter()
    chunks = ["Revenue was €412M [sou", "rce:1", ":2", "] in 2025 [", "source:3]."]
    out = "".join(f.feed(c) for c in chunks) + f.flush()
    assert out == "Revenue was €412M [source:1][source:2] in 2025 [source:3]."


def test_stream_filter_flushes_an_unclosed_bracket():
    f = _CitationStreamFilter()
    assert f.feed("ends with [") == "ends with "
    assert f.flush() == "["
