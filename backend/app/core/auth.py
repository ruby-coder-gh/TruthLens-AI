"""JWT encode/decode + password hashing (passlib bcrypt)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import uuid

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    """Hash password using bcrypt."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password against hash."""
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(user_id: str, role: str) -> str:
    """Create short-lived JWT access token."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": user_id,
        "role": role,
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "iss": settings.JWT_ISSUER,
        "type": "access",
    }
    return jwt.encode(payload, settings.APP_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(
    user_id: str,
    session_id: str | None = None,
    *,
    expires_at: datetime | None = None,
) -> str:
    """Create a long-lived refresh JWT bound to a server-side session ID.

    Application request flows must create the session record before calling
    this helper. A generated ID keeps direct unit-test use backward compatible
    while still ensuring such a token cannot pass refresh-session validation.
    """
    expire = expires_at or (
        datetime.now(timezone.utc) + timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS)
    )
    payload = {
        "sub": user_id,
        "jti": session_id or str(uuid.uuid4()),
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "iss": settings.JWT_ISSUER,
        "type": "refresh",
    }
    return jwt.encode(payload, settings.APP_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """Decode and validate a JWT (signature, expiry, and issuer).

    Access tokens remain short-lived and stateless. Refresh tokens carry a
    random ``jti`` that must match an active ``RefreshTokenSession`` database
    row before it can be exchanged. This enables per-session rotation,
    logout/password/account revocation, and replay detection.
    """
    try:
        payload = jwt.decode(
            token,
            settings.APP_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
            issuer=settings.JWT_ISSUER,
        )
        return payload
    except JWTError as e:
        from app.core.exceptions import TokenExpiredException, UnauthorizedException

        if "expired" in str(e).lower():
            raise TokenExpiredException()
        raise UnauthorizedException(message="Invalid token")
