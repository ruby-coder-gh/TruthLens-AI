"""PII detection and masking using Presidio (with fallback patterns)."""

from __future__ import annotations

import re
from typing import Any

from app.config import settings


class PIIRedactor:
    """Redact personally identifiable information from text.

    Uses regex patterns primarily (Presidio integration optional).
    """

    PATTERNS: list[tuple[str, str, str]] = [
        (r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b", "EMAIL", "[EMAIL]"),
        (r"\b\d{3}[-.]?\d{3}[-.]?\d{4}\b", "PHONE", "[PHONE]"),
        (r"\b\d{3}-\d{2}-\d{4}\b", "SSN", "[SSN]"),
        (r"\b(?:\d[ -]*?){13,16}\b", "CREDIT_CARD", "[CARD]"),
        (r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", "IP", "[IP]"),
        (
            r"\b\d{5}(?:[-\s]\d{4})?\b", "ZIP", "[ZIP]",
        ),
    ]

    def __init__(self, enabled: bool | None = None, entities: list[str] | None = None) -> None:
        self.enabled = settings.PII_REDACTION_ENABLED if enabled is None else enabled
        self.active_entities = set(
            entities or settings.pii_entities_list
        )

    def redact(self, text: str) -> str:
        """Redact PII entities from text. Returns redacted string."""
        if not self.enabled or not text:
            return text

        result = text
        for pattern, entity, replacement in self.PATTERNS:
            if entity in self.active_entities:
                result = re.sub(pattern, replacement, result)
        return result

    def contains_pii(self, text: str) -> bool:
        """Check if text contains any PII patterns."""
        if not text:
            return False
        for pattern, entity, _ in self.PATTERNS:
            if entity in self.active_entities and re.search(pattern, text):
                return True
        return False

    def get_detected_entities(self, text: str) -> list[dict[str, Any]]:
        """Return list of detected PII entities with positions."""
        results: list[dict[str, Any]] = []
        for pattern, entity, _ in self.PATTERNS:
            if entity not in self.active_entities:
                continue
            for match in re.finditer(pattern, text):
                results.append({
                    "entity": entity,
                    "start": match.start(),
                    "end": match.end(),
                    "text": match.group(),
                })
        return results


# Singleton
pii_redactor = PIIRedactor()
