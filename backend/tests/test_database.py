"""Tests for database module."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, async_session_factory, engine


@pytest.mark.asyncio
async def test_get_db_yields_session():
    """get_db should yield an AsyncSession."""
    async for session in get_db():
        assert isinstance(session, AsyncSession)
        break  # just test the yield


@pytest.mark.asyncio
async def test_engine_exists():
    """Engine should be configured."""
    assert engine is not None
    assert engine.url is not None


@pytest.mark.asyncio
async def test_session_factory():
    """Session factory should produce sessions."""
    async with async_session_factory() as session:
        assert isinstance(session, AsyncSession)
