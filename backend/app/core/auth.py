"""JWT encode/decode + password hashing (passlib bcrypt)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

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


def create_refresh_token(user_id: str) -> str:
    """Create long-lived JWT refresh token."""
    expire = datetime.now(timezone.utc) + timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS)
    payload = {
        "sub": user_id,
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "iss": settings.JWT_ISSUER,
        "type": "refresh",
    }
    return jwt.encode(payload, settings.APP_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """Decode and validate a JWT (signature, exp, issuer). Returns the payload.

    Session model — STATELESS by design: no server-side token store, denylist,
    jti, or token_version. A token is valid until its ``exp`` (access =
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES, refresh = JWT_REFRESH_TOKEN_EXPIRE_DAYS).
    Accepted trade-off (kept simple given the short 30-min access TTL):
      - Logout clears the HttpOnly cookies client-side but does NOT revoke an
        already-issued token — a captured token stays valid until it expires.
      - Password reset/change does not invalidate live sessions.
      - Account deactivation IS enforced on the next request (get_current_user
        re-checks User.is_active against the DB).
    For true revocation, embed a ``token_version`` in the payload and compare it
    to a ``User.token_version`` column, bumping it on logout/password-change.
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
