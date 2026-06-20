"""Test configuration and fixtures."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any, AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import NullPool
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.auth import hash_password
from app.core.deps import get_db
from app.main import create_app
from app.models.base import DeclarativeBase
from app.models.user import User

TEST_DB_URL = "sqlite+aiosqlite:///./test_data/test.db"


@pytest_asyncio.fixture
async def test_engine():
    """Create test database engine (module-scoped)."""
    import os
    os.makedirs("test_data", exist_ok=True)

    engine = create_async_engine(
        TEST_DB_URL,
        echo=False,
        poolclass=NullPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(DeclarativeBase.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(DeclarativeBase.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def test_db(test_engine) -> AsyncGenerator[AsyncSession, None]:
    """Create a fresh test database session."""
    session_factory = async_sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with session_factory() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture
async def test_user(test_db: AsyncSession) -> User:
    """Create a test user."""
    user = User(
        email="test@example.com",
        username="testuser",
        password_hash=hash_password("TestPass1"),
        role="user",
        is_active=True,
    )
    test_db.add(user)
    await test_db.commit()
    await test_db.refresh(user)
    return user


@pytest_asyncio.fixture
async def admin_user(test_db: AsyncSession) -> User:
    """Create a test admin user."""
    user = User(
        email="admin@example.com",
        username="adminuser",
        password_hash=hash_password("AdminPass1"),
        role="admin",
        is_active=True,
    )
    test_db.add(user)
    await test_db.commit()
    await test_db.refresh(user)
    return user


@pytest_asyncio.fixture
async def client(test_engine) -> AsyncGenerator[AsyncClient, None]:
    """Create test client with overridden DB."""
    app = create_app()

    session_factory = async_sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )

    async def _get_db_override():
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = _get_db_override

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def auth_headers(client: AsyncClient, test_db: AsyncSession) -> dict[str, str]:
    """Get JWT auth headers for test user."""
    from app.core.auth import create_access_token, create_refresh_token

    user = User(
        email="authtest@example.com",
        username="authtest",
        password_hash=hash_password("TestPass1"),
        role="user",
        is_active=True,
    )
    test_db.add(user)
    await test_db.commit()
    await test_db.refresh(user)

    token = create_access_token(user.id, user.role)
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def admin_headers(client: AsyncClient, test_db: AsyncSession) -> dict[str, str]:
    """Get JWT auth headers for admin user."""
    from app.core.auth import create_access_token

    user = User(
        email="admintest@example.com",
        username="admintest",
        password_hash=hash_password("AdminPass1"),
        role="admin",
        is_active=True,
    )
    test_db.add(user)
    await test_db.commit()
    await test_db.refresh(user)

    token = create_access_token(user.id, user.role)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def sample_txt_path() -> Path:
    """Path to a sample TXT file for testing."""
    path = Path("test_data/sample.txt")
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(
            "This is a sample text document for testing the RAG pipeline.\n"
            "It contains multiple sentences to verify chunking works correctly.\n"
            "The quick brown fox jumps over the lazy dog.\n"
            "Python is a powerful programming language for AI and machine learning.\n"
            "RAG stands for Retrieval Augmented Generation.\n"
        )
    return path
