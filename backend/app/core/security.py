"""Security utilities: rate limiter, CORS config, PII redactor."""

from __future__ import annotations

import re
import time
from collections import defaultdict
from typing import Any

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings
from app.core.exceptions import RateLimitedException


class InMemoryRateLimiter:
    """Simple in-memory sliding window rate limiter."""

    def __init__(self) -> None:
        self._windows: dict[str, list[float]] = defaultdict(list)

    def check(self, key: str, max_requests: int | None = None, window_seconds: int | None = None) -> None:
        max_req = max_requests or settings.RATE_LIMIT_REQUESTS
        window = window_seconds or settings.RATE_LIMIT_WINDOW
        now = time.time()
        window_start = now - window

        # Clean old entries
        self._windows[key] = [t for t in self._windows[key] if t > window_start]

        if len(self._windows[key]) >= max_req:
            raise RateLimitedException()

        self._windows[key].append(now)

    def get_remaining(self, key: str, max_requests: int | None = None) -> int:
        max_req = max_requests or settings.RATE_LIMIT_REQUESTS
        window = settings.RATE_LIMIT_WINDOW
        now = time.time()
        self._windows[key] = [t for t in self._windows[key] if t > now - window]
        return max(0, max_req - len(self._windows[key]))


rate_limiter = InMemoryRateLimiter()


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Add X-Request-ID header to responses."""

    async def dispatch(self, request: Request, call_next: Any) -> Response:
        import uuid

        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses."""

    async def dispatch(self, request: Request, call_next: Any) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Cache-Control"] = "no-cache"
        if request.url.path.startswith("/api/auth"):
            response.headers["Cache-Control"] = "no-store"
        return response


# PII patterns for redaction
PII_PATTERNS: list[tuple[str, str, str]] = [
    (r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b", "EMAIL", "[EMAIL REDACTED]"),
    (r"\b\d{3}[-.]?\d{3}[-.]?\d{4}\b", "PHONE", "[PHONE REDACTED]"),
    (r"\b\d{3}-\d{2}-\d{4}\b", "SSN", "[SSN REDACTED]"),
    (r"\b(?:\d[ -]*?){13,16}\b", "CREDIT_CARD", "[CREDIT_CARD REDACTED]"),
    (r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", "IP", "[IP REDACTED]"),
]


def redact_pii(text: str, enabled: bool = True) -> str:
    """Redact PII entities from text."""
    if not enabled or not settings.PII_REDACTION_ENABLED:
        return text

    result = text
    for pattern, entity_name, replacement in PII_PATTERNS:
        if entity_name in settings.pii_entities_list:
            result = re.sub(pattern, replacement, result)
    return result
