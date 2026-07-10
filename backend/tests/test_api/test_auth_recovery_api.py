"""HTTP tests for auth recovery + account endpoints.

Covers the paths in app/api/auth.py that the happy-path login/register tests
miss: forgot-password (hit + miss), reset-password (valid/invalid/short),
change-password, logout, PUT /me, and DELETE /me.

All endpoints here are pure DB/JWT — no Ollama/model/network involved.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from jose import jwt

from app.config import settings


REG = {
    "email": "recover@example.com",
    "username": "recoveruser",
    "password": "SecureP@ss1",
}


def _make_reset_token(user_id: str, *, expired: bool = False, wrong_type: bool = False) -> str:
    """Mint a reset token the way forgot_password does (out-of-band delivery)."""
    if expired:
        expire = datetime.now(timezone.utc) - timedelta(minutes=5)
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    return jwt.encode(
        {
            "sub": user_id,
            "type": "access" if wrong_type else "reset",
            "exp": expire,
            "iat": datetime.now(timezone.utc),
            "iss": settings.JWT_ISSUER,
        },
        settings.APP_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


async def _register(client: AsyncClient, **overrides) -> dict:
    body = {**REG, **overrides}
    resp = await client.post("/api/auth/register", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


# ── forgot-password ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_forgot_password_existing_user(client: AsyncClient):
    """Known email returns generic success without leaking a token."""
    await _register(client)
    resp = await client.post("/api/auth/forgot-password", json={"email": REG["email"]})
    assert resp.status_code == 200
    body = resp.json()
    assert "message" in body
    # No reset token must appear anywhere in the response body.
    assert "token" not in str(body).lower()


@pytest.mark.asyncio
async def test_forgot_password_unknown_user(client: AsyncClient):
    """Unknown email returns the same generic success (no enumeration)."""
    resp = await client.post(
        "/api/auth/forgot-password", json={"email": "nobody@example.com"}
    )
    assert resp.status_code == 200
    assert "message" in resp.json()


# ── reset-password ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_reset_password_success(client: AsyncClient):
    """A valid reset token updates the password so the new one logs in."""
    reg = await _register(client)
    token = _make_reset_token(reg["user"]["id"])

    resp = await client.post(
        "/api/auth/reset-password",
        json={"token": token, "password": "BrandNewP@ss9"},
    )
    assert resp.status_code == 200
    assert resp.json()["message"] == "Password reset successful"

    # Old password no longer works, new password does.
    old = await client.post(
        "/api/auth/login", json={"email": REG["email"], "password": REG["password"]}
    )
    assert old.status_code == 401
    new = await client.post(
        "/api/auth/login", json={"email": REG["email"], "password": "BrandNewP@ss9"}
    )
    assert new.status_code == 200


@pytest.mark.asyncio
async def test_reset_password_invalid_token(client: AsyncClient):
    """A garbage token is rejected."""
    resp = await client.post(
        "/api/auth/reset-password",
        json={"token": "not-a-jwt", "password": "BrandNewP@ss9"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_reset_password_wrong_token_type(client: AsyncClient):
    """An access-typed token cannot be used to reset a password."""
    reg = await _register(client)
    token = _make_reset_token(reg["user"]["id"], wrong_type=True)
    resp = await client.post(
        "/api/auth/reset-password",
        json={"token": token, "password": "BrandNewP@ss9"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_reset_password_too_short(client: AsyncClient):
    """A too-short password is rejected even with a valid token."""
    reg = await _register(client)
    token = _make_reset_token(reg["user"]["id"])
    resp = await client.post(
        "/api/auth/reset-password",
        json={"token": token, "password": "short"},
    )
    assert resp.status_code == 400


# ── change-password ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_change_password_success(client: AsyncClient):
    """Authenticated user can change password with correct current password."""
    await _register(client)  # cookies now authenticate `client`
    resp = await client.post(
        "/api/auth/change-password",
        json={"current_password": REG["password"], "new_password": "Changed1Pass"},
    )
    assert resp.status_code == 200
    assert resp.json()["message"] == "Password changed successfully"


@pytest.mark.asyncio
async def test_change_password_wrong_current(client: AsyncClient):
    """Wrong current password is rejected."""
    await _register(client)
    resp = await client.post(
        "/api/auth/change-password",
        json={"current_password": "WrongCurrent1", "new_password": "Changed1Pass"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_change_password_too_short(client: AsyncClient):
    """New password shorter than 8 chars is rejected."""
    await _register(client)
    resp = await client.post(
        "/api/auth/change-password",
        json={"current_password": REG["password"], "new_password": "short"},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_change_password_requires_auth(client: AsyncClient):
    """Unauthenticated change-password returns 401."""
    resp = await client.post(
        "/api/auth/change-password",
        json={"current_password": "x", "new_password": "yyyyyyyy"},
    )
    assert resp.status_code == 401


# ── logout ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_logout_success(client: AsyncClient):
    """Logout succeeds and clears the auth cookies."""
    await _register(client)
    resp = await client.post("/api/auth/logout", json={})
    assert resp.status_code == 200
    assert resp.json()["message"] == "Logged out successfully"


@pytest.mark.asyncio
async def test_logout_requires_auth(client: AsyncClient):
    """Logout without auth returns 401."""
    # Ensure no auth cookies linger from a prior request in this client.
    client.cookies.clear()
    resp = await client.post("/api/auth/logout", json={})
    assert resp.status_code == 401


# ── PUT /me ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_me_username(client: AsyncClient):
    """Authenticated user can update their username."""
    await _register(client)
    resp = await client.put("/api/auth/me", json={"username": "renamed99"})
    assert resp.status_code == 200
    assert resp.json()["username"] == "renamed99"


@pytest.mark.asyncio
async def test_update_me_email(client: AsyncClient):
    """Authenticated user can update their email."""
    await _register(client)
    resp = await client.put("/api/auth/me", json={"email": "moved@example.com"})
    assert resp.status_code == 200
    assert resp.json()["email"] == "moved@example.com"


@pytest.mark.asyncio
async def test_update_me_duplicate_email_conflicts(client: AsyncClient):
    """Updating to an email already in use returns 409."""
    # First account owns the target email.
    await _register(client, email="taken@example.com", username="firstuser")
    client.cookies.clear()
    # Second account (now authenticated) tries to grab it.
    await _register(client, email="second@example.com", username="seconduser")
    resp = await client.put("/api/auth/me", json={"email": "taken@example.com"})
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_update_me_short_password(client: AsyncClient):
    """PUT /me with too-short password is rejected."""
    await _register(client)
    resp = await client.put("/api/auth/me", json={"password": "short"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_update_me_requires_auth(client: AsyncClient):
    """PUT /me without auth returns 401."""
    client.cookies.clear()
    resp = await client.put("/api/auth/me", json={"username": "whatever"})
    assert resp.status_code == 401


# ── DELETE /me ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_me_soft_deactivates(client: AsyncClient):
    """DELETE /me deactivates the account (204) and blocks future login."""
    await _register(client)
    resp = await client.delete("/api/auth/me")
    assert resp.status_code == 204

    # Deactivated account can no longer authenticate.
    login = await client.post(
        "/api/auth/login", json={"email": REG["email"], "password": REG["password"]}
    )
    assert login.status_code == 401


@pytest.mark.asyncio
async def test_delete_me_requires_auth(client: AsyncClient):
    """DELETE /me without auth returns 401."""
    client.cookies.clear()
    resp = await client.delete("/api/auth/me")
    assert resp.status_code == 401


# ── refresh error paths ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_refresh_missing_token(client: AsyncClient):
    """Refresh with no cookie and no body token returns 401."""
    client.cookies.clear()
    resp = await client.post("/api/auth/refresh", json={})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_refresh_invalid_token(client: AsyncClient):
    """Refresh with a garbage body token returns 401."""
    client.cookies.clear()
    resp = await client.post(
        "/api/auth/refresh", json={"refresh_token": "not-a-real-token"}
    )
    assert resp.status_code == 401
