"""Tests for multimodal (LLaVA) module."""

from __future__ import annotations

import base64

import pytest


class TestImageEncoding:
    """Test image encoding utilities."""

    def test_encode_image(self):
        from app.ingestion.multimodal import _encode_image
        result = _encode_image(b"fake-image-bytes")
        assert isinstance(result, str)
        assert len(result) > 0
        # Verify it's valid base64
        decoded = base64.b64decode(result)
        assert decoded == b"fake-image-bytes"

    def test_encode_empty_bytes(self):
        from app.ingestion.multimodal import _encode_image
        result = _encode_image(b"")
        assert isinstance(result, str)

    def test_encode_large_image(self):
        from app.ingestion.multimodal import _encode_image
        large = b"x" * 100000
        result = _encode_image(large)
        decoded = base64.b64decode(result)
        assert decoded == large


class TestDescribeWithLLaVA:
    """Test LLaVA description function (mocked)."""

    def test_describe_with_llava_empty_on_error(self):
        """Should return empty string when Ollama unavailable."""
        from app.ingestion.multimodal import _describe_with_llava
        result = _describe_with_llava(b"fake-image", prompt="test", model="nonexistent-model")
        assert result == ""

    def test_describe_with_llava_returns_string(self):
        """Should return string even on error."""
        from app.ingestion.multimodal import _describe_with_llava
        result = _describe_with_llava(b"", prompt="", model="")
        assert isinstance(result, str)


class TestIsMultimodalAvailable:
    """Test availability check."""

    def test_is_multimodal_available_returns_bool(self):
        from app.ingestion.multimodal import is_multimodal_available
        result = is_multimodal_available()
        assert isinstance(result, bool)


class TestDescribeDocumentImages:
    """Test document image description pipeline."""

    def test_describe_document_images_non_pdf(self):
        """Should return empty list for non-existent PDF."""
        from app.ingestion.multimodal import describe_document_images
        from pathlib import Path
        result = describe_document_images(Path("/nonexistent/test.pdf"), max_images=5)
        assert result == []

    def test_describe_document_images_zero_max(self):
        """Should return empty when max_images is 0."""
        from app.ingestion.multimodal import describe_document_images
        from pathlib import Path
        result = describe_document_images(Path("test.pdf"), max_images=0)
        assert result == []


class TestImageToText:
    """Test image_to_text utility."""

    def test_image_to_text_empty_on_error(self):
        from app.ingestion.multimodal import image_to_text
        result = image_to_text(b"", prompt="Describe this")
        assert isinstance(result, str)

    def test_image_to_text_custom_prompt(self):
        from app.ingestion.multimodal import image_to_text
        result = image_to_text(b"fake", prompt="Custom prompt test")
        assert isinstance(result, str)


class TestExtractImagesFromPDF:
    """Test PDF image extraction."""

    def test_extract_from_nonexistent_pdf(self):
        """Should handle missing file gracefully."""
        from app.ingestion.multimodal import extract_images_from_pdf
        from pathlib import Path
        result = extract_images_from_pdf(Path("/nonexistent/test.pdf"))
        assert result == []

    def test_extract_from_text_file(self):
        """Should handle non-PDF files gracefully."""
        from app.ingestion.multimodal import extract_images_from_pdf
        from pathlib import Path
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(b"not a real pdf")
            tmp_path = f.name
        try:
            result = extract_images_from_pdf(Path(tmp_path))
            assert isinstance(result, list)
        finally:
            import os
            os.unlink(tmp_path)
