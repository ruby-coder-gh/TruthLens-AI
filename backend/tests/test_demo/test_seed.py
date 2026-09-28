"""Tests for app.demo.seed — idempotent demo workspace seeding.

Ingestion (`process_document_background`) and the Radar scan (`run_scan`) are
mocked throughout: this module owns seeding orchestration, not the pipelines
those other lanes own.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import select, NullPool
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.demo import seed as seed_module
from app.demo.corpus_builder import load_manifest
from app.models.base import DeclarativeBase
from app.models.document import Document
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember


@pytest_asyncio.fixture
async def seed_engine():
    engine = create_async_engine(
        "sqlite+aiosqlite:///./test_data/test_seed.db",
        poolclass=NullPool,
        connect_args={"check_same_thread": False},
    )
    # No create_all here: seed() runs before the app ever starts, so it must
    # build the schema itself (run.sh --demo crashed on "no such table: users").
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(DeclarativeBase.metadata.drop_all)
    await engine.dispose()


@pytest.fixture(autouse=True)
def _seed_env(monkeypatch: pytest.MonkeyPatch, seed_engine, tmp_path: Path):
    """Point seed.py's DB access + data paths at isolated test resources."""
    factory = async_sessionmaker(seed_engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(seed_module, "async_session_factory", factory)
    monkeypatch.setattr(seed_module, "engine", seed_engine)
    monkeypatch.setattr(settings, "DEMO_PASSWORD", "test-demo-password")
    monkeypatch.setattr(settings, "DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path / "data" / "uploads"))
    monkeypatch.setattr(settings, "BM25_INDEX_DIR", str(tmp_path / "data" / "bm25"))


@pytest.fixture(autouse=True)
def _mock_ingestion_and_radar(monkeypatch: pytest.MonkeyPatch):
    """Ingestion + Radar are owned by other lanes — mock both."""
    mock_process = AsyncMock()
    monkeypatch.setattr("app.api.documents.process_document_background", mock_process)

    mock_scan = AsyncMock(return_value="scan-id")
    monkeypatch.setattr("app.radar.scan.run_scan", mock_scan)

    return {"process": mock_process, "scan": mock_scan}


async def _fetch_all(seed_engine, stmt):
    factory = async_sessionmaker(seed_engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        result = await session.execute(stmt)
        return result.scalars().all()


@pytest.mark.asyncio
async def test_seed_raises_when_demo_password_empty(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "DEMO_PASSWORD", "")

    with pytest.raises(seed_module.DemoPasswordMissing):
        await seed_module.seed()


@pytest.mark.asyncio
async def test_seed_creates_users_workspace_documents_and_marker(seed_engine, _mock_ingestion_and_radar):
    result = await seed_module.seed()

    assert "workspace_id" in result
    marker = seed_module._marker_path()
    assert marker.exists()

    users = await _fetch_all(seed_engine, select(User))
    emails = {u.email for u in users}
    assert emails == {seed_module.ADMIN_EMAIL, seed_module.ANALYST_EMAIL}

    workspaces = await _fetch_all(seed_engine, select(Workspace))
    assert len(workspaces) == 1
    manifest = load_manifest()
    assert workspaces[0].name == manifest["workspace_name"]

    members = await _fetch_all(seed_engine, select(WorkspaceMember))
    roles_by_email = {}
    for m in members:
        user = next(u for u in users if u.id == m.user_id)
        roles_by_email[user.email] = m.role
    assert roles_by_email == {
        seed_module.ANALYST_EMAIL: "owner",
        seed_module.ADMIN_EMAIL: "editor",
    }

    docs = await _fetch_all(seed_engine, select(Document))
    assert len(docs) == len(manifest["docs"])

    assert _mock_ingestion_and_radar["process"].await_count == len(manifest["docs"])
    assert _mock_ingestion_and_radar["scan"].await_count == 1


@pytest.mark.asyncio
async def test_seed_is_idempotent_by_default(seed_engine, _mock_ingestion_and_radar):
    first = await seed_module.seed()
    second = await seed_module.seed()

    assert second == first
    # No second round of ingestion/scan work on the already-seeded workspace.
    assert _mock_ingestion_and_radar["process"].await_count == len(load_manifest()["docs"])
    assert _mock_ingestion_and_radar["scan"].await_count == 1


@pytest.mark.asyncio
async def test_seed_reset_tears_down_and_reseeds(seed_engine, _mock_ingestion_and_radar, monkeypatch):
    monkeypatch.setattr(seed_module, "delete_workspace_collection", lambda workspace_id: None)
    monkeypatch.setattr(seed_module, "clear_bm25_cache", lambda workspace_id: None)

    first = await seed_module.seed()
    second = await seed_module.seed(reset=True)

    assert second["workspace_id"] != first["workspace_id"]
    workspaces = await _fetch_all(seed_engine, select(Workspace))
    assert len(workspaces) == 1
    assert workspaces[0].id == second["workspace_id"]
    # Ingestion ran again for the fresh workspace.
    assert _mock_ingestion_and_radar["process"].await_count == 2 * len(load_manifest()["docs"])


@pytest.mark.asyncio
async def test_seed_tolerates_radar_not_implemented(seed_engine, monkeypatch):
    monkeypatch.setattr("app.api.documents.process_document_background", AsyncMock())
    monkeypatch.setattr(
        "app.radar.scan.run_scan",
        AsyncMock(side_effect=NotImplementedError("lane L5")),
    )

    result = await seed_module.seed()  # must not raise

    assert "workspace_id" in result
