"""Admin user management routes: /api/users/*"""

from __future__ import annotations

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import APIRouter, Depends

from app.core.deps import get_current_admin, get_db
from app.core.exceptions import NotFoundException
from app.models.user import User
from app.schemas.common import PaginatedResponse
from app.schemas.user import UserResponse

router = APIRouter(prefix="/users", tags=["users"], dependencies=[Depends(get_current_admin)])


@router.get("", response_model=PaginatedResponse[UserResponse])
async def list_users(
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """List all users (admin only)."""
    offset = (page - 1) * page_size
    result = await db.execute(select(User).offset(offset).limit(page_size))
    users = result.scalars().all()

    count_result = await db.execute(select(func.count(User.id)))
    total = count_result.scalar()

    return PaginatedResponse(
        data=[
            UserResponse(
                id=u.id,
                email=u.email,
                username=u.username,
                role=u.role,
                is_active=u.is_active,
                created_at=u.created_at,
                updated_at=u.updated_at,
            )
            for u in users
        ],
        meta={"page": page, "page_size": page_size, "total": total},
    )


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(user_id: str, db: AsyncSession = Depends(get_db)):
    """Get user by ID (admin only)."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise NotFoundException("User", user_id)

    return UserResponse(
        id=user.id,
        email=user.email,
        username=user.username,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )
