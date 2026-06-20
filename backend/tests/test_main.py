"""Tests for FastAPI app factory."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.config import settings


class TestHealthEndpoint:
    @pytest.mark.asyncio
    async def test_health_returns_200(self, client: AsyncClient):
        response = await client.get("/health")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_health_response_body(self, client: AsyncClient):
        response = await client.get("/health")
        data = response.json()
        assert data["status"] == "ok"
        assert data["version"] == settings.APP_VERSION

    @pytest.mark.asyncio
    async def test_health_content_type(self, client: AsyncClient):
        response = await client.get("/health")
        assert response.headers["content-type"] == "application/json"


class TestSecurityHeaders:
    @pytest.mark.asyncio
    async def test_x_content_type_options(self, client: AsyncClient):
        response = await client.get("/health")
        assert response.headers.get("X-Content-Type-Options") == "nosniff"

    @pytest.mark.asyncio
    async def test_x_frame_options(self, client: AsyncClient):
        response = await client.get("/health")
        assert response.headers.get("X-Frame-Options") == "DENY"

    @pytest.mark.asyncio
    async def test_strict_transport_security(self, client: AsyncClient):
        response = await client.get("/health")
        hsts = response.headers.get("Strict-Transport-Security", "")
        assert "max-age=31536000" in hsts
        assert "includeSubDomains" in hsts

    @pytest.mark.asyncio
    async def test_cache_control_on_auth_route(self, client: AsyncClient):
        response = await client.post("/api/auth/login", json={"email": "x@y.com", "password": "x"})
        cache = response.headers.get("Cache-Control", "")
        assert "no-store" in cache


class TestRequestID:
    @pytest.mark.asyncio
    async def test_request_id_header_present(self, client: AsyncClient):
        response = await client.get("/health")
        assert "X-Request-ID" in response.headers

    @pytest.mark.asyncio
    async def test_request_id_echoes_client_value(self, client: AsyncClient):
        response = await client.get("/health", headers={"X-Request-ID": "my-request-123"})
        assert response.headers["X-Request-ID"] == "my-request-123"


class TestCORS:
    @pytest.mark.asyncio
    async def test_cors_allowed_origin(self, client: AsyncClient):
        origins = settings.cors_origins_list
        if origins:
            origin = origins[0]
            response = await client.options(
                "/health",
                headers={
                    "Origin": origin,
                    "Access-Control-Request-Method": "GET",
                },
            )
            assert response.headers.get("Access-Control-Allow-Origin") == origin


class TestRouting:
    @pytest.mark.asyncio
    async def test_unknown_route_returns_404(self, client: AsyncClient):
        response = await client.get("/nonexistent")
        assert response.status_code == 404
