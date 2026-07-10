"""Tests for auth API routes."""

from __future__ import annotations

import json

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_register(client: AsyncClient):
    """Test user registration."""
    response = await client.post("/api/auth/register", json={
        "email": "newuser@example.com",
        "username": "newuser",
        "password": "SecureP@ss1",
    })
    assert response.status_code == 201
    set_cookies = response.headers.get_list("set-cookie")
    assert any("access_token=" in cookie for cookie in set_cookies)
    assert any("refresh_token=" in cookie for cookie in set_cookies)
    data = response.json()
    auth_data = data.get("data", data)
    assert "user" in auth_data


@pytest.mark.asyncio
async def test_register_duplicate_email(client: AsyncClient):
    """Test registering with duplicate email."""
    await client.post("/api/auth/register", json={
        "email": "dupe@example.com",
        "username": "user1",
        "password": "SecureP@ss1",
    })
    response = await client.post("/api/auth/register", json={
        "email": "dupe@example.com",
        "username": "user2",
        "password": "SecureP@ss1",
    })
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_login(client: AsyncClient):
    """Test login."""
    # First register
    await client.post("/api/auth/register", json={
        "email": "login@example.com",
        "username": "loginuser",
        "password": "SecureP@ss1",
    })
    # Then login
    response = await client.post("/api/auth/login", json={
        "email": "login@example.com",
        "password": "SecureP@ss1",
    })
    assert response.status_code == 200
    set_cookies = response.headers.get_list("set-cookie")
    assert any("access_token=" in cookie for cookie in set_cookies)
    assert any("refresh_token=" in cookie for cookie in set_cookies)
    data = response.json()
    # Can be either wrapped or direct
    auth_data = data.get("data", data)
    assert "user" in auth_data


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient):
    """Test login with wrong password."""
    await client.post("/api/auth/register", json={
        "email": "wrong@example.com",
        "username": "wronguser",
        "password": "SecureP@ss1",
    })
    response = await client.post("/api/auth/login", json={
        "email": "wrong@example.com",
        "password": "WrongPass1",
    })
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_me_endpoint(client: AsyncClient):
    """Test /auth/me endpoint."""
    # Register (cookies should be set on client)
    reg = await client.post("/api/auth/register", json={
        "email": "me@example.com",
        "username": "meuser",
        "password": "SecureP@ss1",
    })
    assert reg.status_code == 201

    response = await client.get("/api/auth/me")
    assert response.status_code == 200
    user_data = response.json()
    assert user_data["email"] == "me@example.com"


@pytest.mark.asyncio
async def test_me_unauthorized(client: AsyncClient):
    """Test accessing /auth/me without token."""
    response = await client.get("/api/auth/me")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_register_weak_password(client: AsyncClient):
    """Test registering with weak password."""
    response = await client.post("/api/auth/register", json={
        "email": "weak@example.com",
        "username": "weakuser",
        "password": "short",
    })
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_refresh_token(client: AsyncClient):
    """Test token refresh."""
    reg = await client.post("/api/auth/register", json={
        "email": "refresh@example.com",
        "username": "refreshuser",
        "password": "SecureP@ss1",
    })
    response = await client.post("/api/auth/refresh", json={})
    assert response.status_code == 200
    set_cookies = response.headers.get_list("set-cookie")
    assert any("access_token=" in cookie for cookie in set_cookies)


@pytest.mark.asyncio
async def test_forgot_password_no_token_leakage(client: AsyncClient):
    """Forgot password response must not leak reset token."""
    await client.post("/api/auth/register", json={
        "email": "forgot@example.com",
        "username": "forgotuser",
        "password": "SecureP@ss1",
    })

    response = await client.post("/api/auth/forgot-password", json={"email": "forgot@example.com"})
    assert response.status_code == 200
    body = response.json()
    assert "message" in body

    serialized = json.dumps(body).lower()
    assert "reset_token" not in serialized
    assert '"token":' not in serialized
    assert "access_token" not in serialized
    assert "refresh_token" not in serialized
