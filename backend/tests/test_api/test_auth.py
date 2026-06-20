"""Tests for auth API routes."""

from __future__ import annotations

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
    data = response.json()
    assert "access_token" in data.get("data", data)
    assert "refresh_token" in data.get("data", data)


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
    data = response.json()
    # Can be either wrapped or direct
    auth_data = data.get("data", data)
    assert "access_token" in auth_data


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
    # Register and get token
    reg = await client.post("/api/auth/register", json={
        "email": "me@example.com",
        "username": "meuser",
        "password": "SecureP@ss1",
    })
    data = reg.json()
    auth_data = data.get("data", data)
    token = auth_data["access_token"]

    response = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
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
    data = reg.json()
    auth_data = data.get("data", data)
    refresh_token = auth_data["refresh_token"]

    response = await client.post("/api/auth/refresh", json={
        "refresh_token": refresh_token,
    })
    assert response.status_code == 200
    new_data = response.json().get("data", response.json())
    assert "access_token" in new_data
