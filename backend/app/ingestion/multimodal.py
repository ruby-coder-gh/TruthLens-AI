"""Multimodal extraction: charts, tables, images → text descriptions via LLaVA.

Extracts images from documents (PDF pages, embedded images), sends them to
Ollama LLaVA vision model for description, and returns structured text that
can be indexed and searched alongside regular document text.
"""

from __future__ import annotations

import base64
from pathlib import Path
from typing import Any

from app.config import settings
from app.utils.logger import logger


# ─── Image Extraction ─────────────────────────────────────────────────────────

def extract_images_from_pdf(pdf_path: Path) -> list[dict[str, Any]]:
    """Extract page renders and embedded images from a PDF.

    Args:
        pdf_path: Path to PDF file.

    Returns:
        List of dicts: {"image_bytes": bytes, "page_number": int, "type": "page"|"embedded"}
    """
    images: list[dict[str, Any]] = []
    try:
        import fitz
    except ImportError:
        logger.warning("pymupdf_not_available", msg="Install PyMuPDF for PDF image extraction")
        return images

    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        logger.error("pdf_open_failed_for_images", error=str(e), path=str(pdf_path))
        return images

    for page_num in range(len(doc)):
        page = doc[page_num]

        # Check if page has images (charts, tables, photos)
        image_list = page.get_images(full=True)

        if not image_list:
            # No embedded images — still render page if it has content
            # but skip text-only pages to avoid redundant descriptions
            text = page.get_text().strip()
            if len(text) < 100:  # Sparse text page might be chart-heavy
                pix = page.get_pixmap(dpi=150)
                img_bytes = pix.tobytes("png")
                images.append({
                    "image_bytes": img_bytes,
                    "page_number": page_num + 1,
                    "type": "page",
                })
        else:
            # Has embedded images — extract them
            for img_idx, img in enumerate(image_list):
                try:
                    xref = img[0]
                    base_image = doc.extract_image(xref)
                    if base_image:
                        img_bytes = base_image["image"]
                        # Filter out tiny images (likely icons/decorations)
                        if len(img_bytes) > 10_000:  # >10KB
                            images.append({
                                "image_bytes": img_bytes,
                                "page_number": page_num + 1,
                                "type": "embedded",
                                "metadata": {
                                    "width": base_image.get("width", 0),
                                    "height": base_image.get("height", 0),
                                },
                            })
                except Exception as e:
                    logger.warning("image_extract_failed", error=str(e), page=page_num + 1, img_idx=img_idx)

            # Also render the page itself if it has embedded images
            # (ensures we capture layout context around images)
            pix = page.get_pixmap(dpi=100)
            page_img_bytes = pix.tobytes("png")
            images.append({
                "image_bytes": page_img_bytes,
                "page_number": page_num + 1,
                "type": "page",
            })

    doc.close()
    logger.info(
        "pdf_images_extracted",
        path=str(pdf_path),
        total_images=len(images),
        pages=len(doc),
    )
    return images


# ─── LLaVA Vision Inference ───────────────────────────────────────────────────

DESCRIBE_CHART_PROMPT = (
    "Describe this chart, table, or figure in detail. "
    "Include all numeric values, labels, trends, and relationships visible. "
    "Format as structured text that can be searched."
)

DESCRIBE_IMAGE_PROMPT = (
    "Describe this image in detail. What objects, text, people, or scenes are present? "
    "Be specific and factual. Include text content visible in the image."
)


def _encode_image(image_bytes: bytes) -> str:
    """Encode image bytes to base64 for Ollama API."""
    return base64.b64encode(image_bytes).decode("utf-8")


def _describe_with_llava(
    image_bytes: bytes,
    prompt: str = DESCRIBE_CHART_PROMPT,
    model: str | None = None,
) -> str:
    """Send image to LLaVA via Ollama for description.

    Args:
        image_bytes: Raw image bytes (PNG/JPEG).
        prompt: Text prompt describing what to look for.
        model: Ollama vision model name (defaults to settings).

    Returns:
        Text description from the vision model.
    """
    import requests

    model_name = model or settings.OLLAMA_VISION_MODEL
    base_url = settings.OLLAMA_BASE_URL.rstrip("/")

    b64_image = _encode_image(image_bytes)

    payload: dict[str, Any] = {
        "model": model_name,
        "prompt": prompt,
        "images": [b64_image],
        "stream": False,
        "options": {
            "temperature": 0.2,
            "num_predict": 512,
        },
    }

    try:
        resp = requests.post(
            f"{base_url}/api/generate",
            json=payload,
            timeout=60,
        )
        resp.raise_for_status()
        result = resp.json()
        description = result.get("response", "").strip()
        return description
    except Exception as e:
        logger.error("llava_description_failed", error=str(e), model=model_name)
        return ""


# ─── Public API ───────────────────────────────────────────────────────────────

def describe_document_images(
    pdf_path: Path,
    max_images: int = 10,
) -> list[dict[str, Any]]:
    """Extract and describe images from a PDF document.

    Args:
        pdf_path: Path to PDF file.
        max_images: Maximum number of images to process (0 = skip all).

    Returns:
        List of dicts: {
            "page_number": int,
            "description": str,
            "type": "page" | "embedded",
        }
    """
    if max_images <= 0:
        return []

    images = extract_images_from_pdf(pdf_path)

    if not images:
        return []

    # Limit to max_images (most important ones)
    images = images[:max_images]

    descriptions: list[dict[str, Any]] = []
    for img in images:
        prompt = DESCRIBE_CHART_PROMPT if img.get("type") == "embedded" else DESCRIBE_CHART_PROMPT
        description = _describe_with_llava(img["image_bytes"], prompt=prompt)

        if description:
            descriptions.append({
                "page_number": img["page_number"],
                "description": description,
                "type": img.get("type", "page"),
            })
            logger.info(
                "image_described",
                page=img["page_number"],
                desc_len=len(description),
            )

    logger.info(
        "document_images_described",
        path=str(pdf_path),
        total_images=len(images),
        described=len(descriptions),
    )
    return descriptions


def image_to_text(image_bytes: bytes, prompt: str | None = None) -> str:
    """Convert a single image to text description.

    Args:
        image_bytes: Raw image bytes.
        prompt: Optional custom prompt.

    Returns:
        Text description.
    """
    return _describe_with_llava(
        image_bytes,
        prompt=prompt or DESCRIBE_IMAGE_PROMPT,
    )


def is_multimodal_available() -> bool:
    """Check if LLaVA vision model is available in Ollama."""
    try:
        import requests
        resp = requests.get(
            f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/tags",
            timeout=5,
        )
        resp.raise_for_status()
        models = resp.json().get("models", [])
        vision_model = settings.OLLAMA_VISION_MODEL
        return any(m["name"].startswith(vision_model) for m in models)
    except Exception:
        return False
