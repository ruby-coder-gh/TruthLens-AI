"""Custom exception classes + FastAPI exception handlers."""

from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.utils.logger import logger


class AppException(Exception):
    """Base application exception."""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 500,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}
        super().__init__(message)


class NotFoundException(AppException):
    def __init__(self, resource: str = "Resource", resource_id: str | None = None) -> None:
        msg = f"{resource} not found"
        if resource_id:
            msg += f": {resource_id}"
        super().__init__("NOT_FOUND", msg, status_code=404)


class UnauthorizedException(AppException):
    def __init__(self, message: str = "Not authenticated") -> None:
        super().__init__("UNAUTHORIZED", message, status_code=401)


class TokenExpiredException(AppException):
    def __init__(self) -> None:
        super().__init__("TOKEN_EXPIRED", "Token has expired", status_code=401)


class ForbiddenException(AppException):
    def __init__(self, message: str = "Insufficient permissions") -> None:
        super().__init__("FORBIDDEN", message, status_code=403)


class ConflictException(AppException):
    def __init__(self, message: str = "Resource already exists") -> None:
        super().__init__("CONFLICT", message, status_code=409)


class RateLimitedException(AppException):
    def __init__(self) -> None:
        super().__init__("RATE_LIMITED", "Too many requests", status_code=429)


class InvalidInputException(AppException):
    def __init__(self, message: str = "Invalid input", details: dict[str, Any] | None = None) -> None:
        super().__init__("INVALID_INPUT", message, status_code=400, details=details)


class UnsupportedTypeException(AppException):
    def __init__(self, message: str = "Unsupported file type") -> None:
        super().__init__("UNSUPPORTED_TYPE", message, status_code=415)


class TooLargeException(AppException):
    def __init__(self, message: str = "File exceeds size limit") -> None:
        super().__init__("TOO_LARGE", message, status_code=413)


class GuardrailFailedException(AppException):
    def __init__(self, message: str = "Response failed hallucination check") -> None:
        super().__init__("GUARDRAIL_FAILED", message, status_code=422)


class IngestionFailedException(AppException):
    def __init__(self, message: str = "Document processing error") -> None:
        super().__init__("INGESTION_FAILED", message, status_code=500)


class LLMUnavailableException(AppException):
    def __init__(self, message: str = "Ollama not reachable") -> None:
        super().__init__("LLM_UNAVAILABLE", message, status_code=503)


async def app_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    # Registered only for AppException; the broad signature matches Starlette's
    # add_exception_handler contract. Narrow before touching AppException fields.
    assert isinstance(exc, AppException)
    logger.warning(
        "app_exception",
        code=exc.code,
        message=exc.message,
        path=str(request.url),
    )
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.code,
                "message": exc.message,
                "details": exc.details,
            }
        },
    )


async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    code_map = {
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        405: "METHOD_NOT_ALLOWED",
        413: "TOO_LARGE",
        429: "RATE_LIMITED",
        500: "INTERNAL_ERROR",
    }
    code = code_map.get(exc.status_code, "HTTP_ERROR")
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": code,
                "message": exc.detail,
                "details": None,
            }
        },
    )


async def validation_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    # Registered only for RequestValidationError; the broad signature matches
    # Starlette's add_exception_handler contract. Narrow before reading errors().
    assert isinstance(exc, RequestValidationError)
    errors = exc.errors()
    detail = {}
    for err in errors:
        loc = ".".join(str(x) for x in err.get("loc", []))
        detail[loc] = err.get("msg", "Validation error")

    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "INVALID_INPUT",
                "message": "Validation failed",
                "details": detail,
            }
        },
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error("unhandled_exception", exc_info=True, path=str(request.url))
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "An unexpected error occurred",
                "details": None,
            }
        },
    )
