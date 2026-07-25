"""Auth routes: /api/auth/*"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from jose import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse

from app.config import settings
from app.core.auth import create_access_token, decode_token, hash_password, verify_password
from app.core.refresh_tokens import (
    RefreshTokenReuseDetected,
    RefreshTokenSessionError,
    issue_refresh_token,
    revoke_all_refresh_tokens,
    revoke_refresh_token,
    rotate_refresh_token,
)
from app.core.deps import get_current_user, get_db
from app.core.exceptions import (
    ConflictException,
    InvalidInputException,
    UnauthorizedException,
)
from app.core.security import rate_limiter
from app.models.audit_log import AuditLog
from app.models.user import User
from app.schemas.auth import (
    AuthResponse,
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    RegisterRequest,
    ResetPasswordRequest,
    UserInfo,
)
from app.schemas.user import UserResponse, UserUpdate
from app.schemas.common import MessageResponse

router = APIRouter(prefix="/auth", tags=["auth"])

ACCESS_COOKIE_NAME = "access_token"
REFRESH_COOKIE_NAME = "refresh_token"


def _cookie_secure() -> bool:
    return settings.APP_ENV == "production"


def _set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    response.set_cookie(
        key=ACCESS_COOKIE_NAME,
        value=access_token,
        httponly=True,
        secure=_cookie_secure(),
        samesite="lax",
        max_age=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=refresh_token,
        httponly=True,
        secure=_cookie_secure(),
        samesite="lax",
        max_age=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        path="/api/auth",
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(
        key=ACCESS_COOKIE_NAME,
        path="/",
        httponly=True,
        secure=_cookie_secure(),
        samesite="lax",
    )
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        path="/api/auth",
        httponly=True,
        secure=_cookie_secure(),
        samesite="lax",
    )
    # Remove refresh cookies issued before the path was widened for logout.
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        path="/api/auth/refresh",
        httponly=True,
        secure=_cookie_secure(),
        samesite="lax",
    )


def _refresh_token_unauthorized(message: str = "Invalid refresh token") -> JSONResponse:
    """Return the standard 401 envelope and remove unusable auth cookies."""
    error_response = JSONResponse(
        status_code=401,
        content={
            "error": {
                "code": "UNAUTHORIZED",
                "message": message,
                "details": {},
            }
        },
    )
    _clear_auth_cookies(error_response)
    return error_response


@router.post("/register", response_model=AuthResponse, status_code=201)
async def register(
    body: RegisterRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Register a new user."""
    # Check email + username uniqueness (single error to prevent enumeration)
    email_exists = await db.execute(select(User).where(User.email == body.email))
    user_exists = await db.execute(select(User).where(User.username == body.username))
    if email_exists.scalar_one_or_none() or user_exists.scalar_one_or_none():
        raise ConflictException("Email or username already registered")

    # Create user
    user = User(
        email=body.email,
        username=body.username,
        password_hash=hash_password(body.password),
        role="user",
        is_active=True,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)

    # Generate tokens
    access_token = create_access_token(user.id, user.role)
    refresh_token = await issue_refresh_token(db, user_id=user.id)
    _set_auth_cookies(response, access_token, refresh_token)

    # Audit log
    db.add(AuditLog(
        user_id=user.id,
        action="user.register",
        resource_type="user",
        resource_id=user.id,
        details=json.dumps({"email": user.email}),
    ))

    return AuthResponse(
        user=UserInfo(
            id=user.id,
            email=user.email,
            username=user.username,
            role=user.role,
            created_at=user.created_at,
        ),
        expires_in=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/login", response_model=AuthResponse)
async def login(
    body: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Login with email and password."""
    # Rate limiting
    rate_limiter.check(f"login:{body.email}")

    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user:
        raise UnauthorizedException("Invalid email or password")

    # Check account lockout
    if user.locked_until and user.locked_until > datetime.now(timezone.utc):
        remaining = int((user.locked_until - datetime.now(timezone.utc)).total_seconds())
        raise UnauthorizedException(f"Account locked. Try again in {remaining} seconds")

    if not verify_password(body.password, user.password_hash):
        # Increment failed attempts
        user.failed_attempts += 1
        if user.failed_attempts >= 5:
            user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=15)
        await db.flush()
        raise UnauthorizedException("Invalid email or password")

    if not user.is_active:
        raise UnauthorizedException("Account is disabled")

    # Reset failed attempts on successful login
    user.failed_attempts = 0
    user.locked_until = None
    user.last_login_at = datetime.now(timezone.utc)

    # Generate tokens
    access_token = create_access_token(user.id, user.role)
    refresh_token = await issue_refresh_token(db, user_id=user.id)
    _set_auth_cookies(response, access_token, refresh_token)

    # Audit log
    db.add(AuditLog(
        user_id=user.id,
        action="user.login",
        resource_type="user",
        resource_id=user.id,
    ))

    return AuthResponse(
        user=UserInfo(
            id=user.id,
            email=user.email,
            username=user.username,
            role=user.role,
            created_at=user.created_at,
        ),
        expires_in=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/refresh", response_model=AuthResponse)
async def refresh(
    request: Request,
    response: Response,
    body: RefreshRequest | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Rotate a valid refresh session into fresh access and refresh tokens."""
    refresh_token = (
        body.refresh_token
        if body and body.refresh_token
        else request.cookies.get(REFRESH_COOKIE_NAME)
    )
    if not refresh_token:
        return _refresh_token_unauthorized("Missing refresh token")

    try:
        payload = decode_token(refresh_token)
    except Exception:
        return _refresh_token_unauthorized()

    user_id = payload.get("sub")
    token_id = payload.get("jti")
    if (
        payload.get("type") != "refresh"
        or not isinstance(user_id, str)
        or not isinstance(token_id, str)
    ):
        return _refresh_token_unauthorized()

    result = await db.execute(
        select(User).where(User.id == user_id, User.is_active.is_(True))
    )
    user = result.scalar_one_or_none()
    if not user:
        return _refresh_token_unauthorized()

    try:
        new_refresh_token = await rotate_refresh_token(
            db,
            user_id=user.id,
            token_id=token_id,
        )
    except RefreshTokenReuseDetected:
        # This branch returns a response-level 401, so commit revocation before
        # returning; otherwise a later rollback could undo the reuse response.
        await revoke_all_refresh_tokens(
            db,
            user_id=user.id,
            reason="refresh_token_reuse_detected",
        )
        db.add(
            AuditLog(
                user_id=user.id,
                action="auth.refresh_reuse_detected",
                resource_type="user",
                resource_id=user.id,
            )
        )
        await db.commit()
        return _refresh_token_unauthorized(
            "Refresh token is no longer valid; please sign in again"
        )
    except RefreshTokenSessionError:
        return _refresh_token_unauthorized()

    access_token = create_access_token(user.id, user.role)
    _set_auth_cookies(response, access_token, new_refresh_token)
    db.add(
        AuditLog(
            user_id=user.id,
            action="auth.refresh_rotate",
            resource_type="user",
            resource_id=user.id,
        )
    )

    return AuthResponse(
        user=UserInfo(
            id=user.id,
            email=user.email,
            username=user.username,
            role=user.role,
            created_at=user.created_at,
        ),
        expires_in=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """Get current user profile."""
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        username=current_user.username,
        role=current_user.role,
        is_active=current_user.is_active,
        created_at=current_user.created_at,
        updated_at=current_user.updated_at,
    )


@router.put("/me", response_model=UserResponse)
async def update_me(
    body: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update current user profile."""
    if body.email is not None:
        result = await db.execute(select(User).where(User.email == body.email, User.id != current_user.id))
        if result.scalar_one_or_none():
            raise ConflictException("Email already in use")
        current_user.email = body.email

    if body.username is not None:
        result = await db.execute(select(User).where(User.username == body.username, User.id != current_user.id))
        if result.scalar_one_or_none():
            raise ConflictException("Username already taken")
        current_user.username = body.username

    if body.password is not None:
        if len(body.password) < 8:
            raise InvalidInputException("Password must be at least 8 characters")
        current_user.password_hash = hash_password(body.password)
        await revoke_all_refresh_tokens(
            db,
            user_id=current_user.id,
            reason="password_changed",
        )

    await db.flush()
    await db.refresh(current_user)

    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        username=current_user.username,
        role=current_user.role,
        is_active=current_user.is_active,
        created_at=current_user.created_at,
        updated_at=current_user.updated_at,
    )


@router.post("/forgot-password", response_model=MessageResponse)
async def forgot_password(
    body: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    """Generate password reset token. Always returns success (no email enumeration)."""
    # Check if user exists (but don't reveal)
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user:
        # Generate reset token for out-of-band delivery (email/SMS), never return in API response.
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
        _ = jwt.encode(
            {
                "sub": user.id,
                "type": "reset",
                "exp": expire,
                "iat": datetime.now(timezone.utc),
                "iss": settings.JWT_ISSUER,
            },
            settings.APP_SECRET_KEY,
            algorithm=settings.JWT_ALGORITHM,
        )

    # Always return generic success to prevent enumeration/token disclosure
    return MessageResponse(message="If email exists, password reset instructions have been sent")


@router.post("/reset-password", response_model=MessageResponse)
async def reset_password(
    body: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    """Reset password using reset token."""
    try:
        payload = decode_token(body.token)
    except Exception:
        raise UnauthorizedException("Invalid or expired reset token")

    if payload.get("type") != "reset":
        raise UnauthorizedException("Invalid token type")

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == user_id, User.is_active.is_(True)))
    user = result.scalar_one_or_none()
    if not user:
        raise UnauthorizedException("User not found")

    if len(body.password) < 8:
        raise InvalidInputException("Password must be at least 8 characters")

    user.password_hash = hash_password(body.password)
    await revoke_all_refresh_tokens(
        db,
        user_id=user.id,
        reason="password_reset",
    )

    db.add(AuditLog(
        user_id=user.id,
        action="user.password_reset",
        resource_type="user",
        resource_id=user.id,
    ))

    return MessageResponse(message="Password reset successful")


@router.post("/change-password", response_model=MessageResponse)
async def change_password(
    body: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Change password for authenticated user."""
    if not verify_password(body.current_password, current_user.password_hash):
        raise UnauthorizedException("Current password is incorrect")

    if len(body.new_password) < 8:
        raise InvalidInputException("Password must be at least 8 characters")

    current_user.password_hash = hash_password(body.new_password)
    await revoke_all_refresh_tokens(
        db,
        user_id=current_user.id,
        reason="password_changed",
    )

    db.add(AuditLog(
        user_id=current_user.id,
        action="user.password_change",
        resource_type="user",
        resource_id=current_user.id,
    ))

    return MessageResponse(message="Password changed successfully")


@router.post("/logout", response_model=MessageResponse)
async def logout(
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    body: LogoutRequest | None = None,
):
    """Revoke the presented refresh session and clear auth cookies."""
    refresh_token = (
        body.refresh_token
        if body and body.refresh_token
        else request.cookies.get(REFRESH_COOKIE_NAME)
    )
    revoked = False
    if refresh_token:
        try:
            payload = decode_token(refresh_token)
            token_id = payload.get("jti")
            if (
                payload.get("type") == "refresh"
                and payload.get("sub") == current_user.id
                and isinstance(token_id, str)
            ):
                revoked = await revoke_refresh_token(
                    db,
                    user_id=current_user.id,
                    token_id=token_id,
                    reason="logout",
                )
        except Exception:
            # Logout is idempotent and must still clear potentially stale cookies.
            pass

    _clear_auth_cookies(response)
    db.add(
        AuditLog(
            user_id=current_user.id,
            action="user.logout",
            resource_type="user",
            resource_id=current_user.id,
            details=json.dumps(
                {
                    "refresh_token_present": bool(refresh_token),
                    "refresh_token_revoked": revoked,
                }
            ),
        )
    )

    return MessageResponse(message="Logged out successfully")


@router.delete("/me", status_code=204)
async def delete_me(
    response: Response,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Deactivate the account and invalidate every refresh session."""
    current_user.is_active = False
    await revoke_all_refresh_tokens(
        db,
        user_id=current_user.id,
        reason="account_deleted",
    )
    _clear_auth_cookies(response)
    db.add(AuditLog(
        user_id=current_user.id,
        action="user.delete",
        resource_type="user",
        resource_id=current_user.id,
    ))
