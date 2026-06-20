"""FastAPI application factory with lifespan, middleware, CORS."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.router import api_router
from app.config import settings
from app.core.exceptions import (
    AppException,
    app_exception_handler,
    http_exception_handler,
    unhandled_exception_handler,
    validation_exception_handler,
)
from app.core.security import RequestIDMiddleware, SecurityHeadersMiddleware
from app.database import engine
from app.models.base import DeclarativeBase
from app.utils.logger import logger, setup_logging


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan: startup/shutdown."""
    setup_logging()
    logger.info(
        "app_starting",
        name=settings.APP_NAME,
        version=settings.APP_VERSION,
        env=settings.APP_ENV,
    )

    # Ensure data directories exist
    Path(settings.DATA_DIR).mkdir(parents=True, exist_ok=True)
    settings.upload_path.mkdir(parents=True, exist_ok=True)
    settings.bm25_path.mkdir(parents=True, exist_ok=True)
    settings.chroma_path.mkdir(parents=True, exist_ok=True)

    # Validate secret key
    weak_keys = [
        "change-me-in-production-openssl-rand-hex-32",
        "dev-secret-key-openssl-rand-hex-32-12345678",
        "dev-secret-key",
    ]
    if settings.APP_SECRET_KEY in weak_keys or len(settings.APP_SECRET_KEY) < 32:
        import sys
        logger.critical("CRITICAL: Replace default APP_SECRET_KEY with openssl rand -hex 32")
        if settings.APP_ENV == "production":
            sys.exit(1)

    # Create database tables
    async with engine.begin() as conn:
        await conn.run_sync(DeclarativeBase.metadata.create_all)
    logger.info("database_tables_ready")

    yield

    # Shutdown
    logger.info("app_shutting_down")
    await engine.dispose()


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        lifespan=lifespan,
        docs_url="/docs" if settings.APP_ENV == "development" else None,
        redoc_url="/redoc" if settings.APP_ENV == "development" else None,
    )

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    )

    # Security headers
    app.add_middleware(SecurityHeadersMiddleware)  # type: ignore[arg-type]

    # Request ID middleware
    app.add_middleware(RequestIDMiddleware)  # type: ignore[arg-type]

    # Exception handlers
    app.add_exception_handler(AppException, app_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)

    # Include API router
    app.include_router(api_router)

    # Health check
    @app.get("/health")
    async def health():
        return {"status": "ok", "version": settings.APP_VERSION}

    return app


app = create_app()
