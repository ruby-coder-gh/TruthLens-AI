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
