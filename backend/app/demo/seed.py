"""Seed the demo workspace: users, the Northwind Renewables corpus documents,
and an initial Contradiction Radar scan.

Idempotent via a `.demo_seeded` marker file in `DATA_DIR`; `--reset` tears
down the existing demo workspace (documents, Chroma collection, BM25 index)
and reseeds from scratch. Run via `python -m app.demo seed [--reset]`.
"""

from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.chroma_client import delete_workspace_collection
from app.config import settings
from app.core.auth import hash_password
from app.database import async_session_factory, engine
from app.demo.corpus_builder import build_corpus_files, load_manifest
from app.models.base import DeclarativeBase
from app.models.document import Document
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.retrieval.bm25_utils import clear_bm25_cache
from app.utils.logger import logger

ADMIN_EMAIL = "admin@truthlens.dev"
ADMIN_USERNAME = "demo_admin"
ANALYST_EMAIL = "analyst@truthlens.dev"
ANALYST_USERNAME = "demo_analyst"


class DemoPasswordMissing(RuntimeError):
    def __init__(self) -> None:
        super().__init__(
            "DEMO_PASSWORD is empty — set it in backend/.env before seeding "
            "(run.sh generates one automatically)."
        )


def _marker_path() -> Path:
    return settings.data_path / ".demo_seeded"


async def _get_or_create_user(session: AsyncSession, *, email: str, username: str, role: str) -> User:
    result = await session.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user:
        return user
    user = User(
        email=email,
        username=username,
        password_hash=hash_password(settings.DEMO_PASSWORD),
        role=role,
        is_active=True,
    )
    session.add(user)
    await session.flush()
    return user


async def _teardown_existing_demo_workspace(workspace_name: str) -> None:
    """Delete the demo workspace (if any) and its Chroma/BM25 state."""
    async with async_session_factory() as session:
        result = await session.execute(select(Workspace).where(Workspace.name == workspace_name))
        workspace = result.scalar_one_or_none()
        if not workspace:
            return
        workspace_id = workspace.id
        await session.delete(workspace)
        await session.commit()

    delete_workspace_collection(workspace_id)
    clear_bm25_cache(workspace_id)
    bm25_dir = settings.bm25_path / workspace_id
    if bm25_dir.exists():
        shutil.rmtree(bm25_dir, ignore_errors=True)
    logger.info("demo_workspace_torn_down", workspace_id=workspace_id)


async def seed(reset: bool = False) -> dict[str, Any]:
    """Seed (or re-seed) the demo workspace. Returns `{"workspace_id": ...}`."""
    if not settings.DEMO_PASSWORD:
        raise DemoPasswordMissing()

    # Seed runs before the app has ever started, so build what the app's
    # lifespan would: data dirs and tables.
    for path in (Path(settings.DATA_DIR), settings.upload_path, settings.bm25_path, settings.chroma_path):
        path.mkdir(parents=True, exist_ok=True)
    async with engine.begin() as conn:
        await conn.run_sync(DeclarativeBase.metadata.create_all)

    manifest = load_manifest()
    marker = _marker_path()

    if reset:
        await _teardown_existing_demo_workspace(manifest["workspace_name"])
        marker.unlink(missing_ok=True)
    elif marker.exists():
        data = json.loads(marker.read_text())
        logger.info("demo_seed_skipped_already_seeded", workspace_id=data.get("workspace_id"))
        return data

    # 1. Users + workspace (own short session scope — committed before any
    # ingestion work starts).
    async with async_session_factory() as session:
        admin = await _get_or_create_user(session, email=ADMIN_EMAIL, username=ADMIN_USERNAME, role="admin")
        analyst = await _get_or_create_user(session, email=ANALYST_EMAIL, username=ANALYST_USERNAME, role="user")

        workspace = Workspace(name=manifest["workspace_name"], owner_id=analyst.id)
        session.add(workspace)
        await session.flush()
        session.add(WorkspaceMember(workspace_id=workspace.id, user_id=analyst.id, role="owner"))
        session.add(WorkspaceMember(workspace_id=workspace.id, user_id=admin.id, role="editor"))
        await session.commit()
        workspace_id = workspace.id
        analyst_id = analyst.id

    # 2. Build the corpus's PDF/DOCX/CSV/MD files into a scratch dir, then
    # copy each into the real upload dir alongside a Document row — mirrors
    # documents.py's upload_document (lines ~106-140).
    build_dir = settings.upload_path / f"_demo_build_{uuid.uuid4().hex[:8]}"
    built_docs = build_corpus_files(build_dir)

    to_process: list[tuple[str, Path, str, str]] = []
    async with async_session_factory() as session:
        for entry in built_docs:
            file_id = str(uuid.uuid4())
            ext = entry["path"].suffix
            server_filename = f"{file_id}{ext}"
            dest = settings.upload_path / server_filename
            settings.upload_path.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(entry["path"], dest)
            original_filename = f"{entry['title']}{ext}"

            session.add(Document(
                id=file_id,
                workspace_id=workspace_id,
                filename=server_filename,
                original_filename=original_filename,
                mime_type=entry["mime_type"],
                file_size=dest.stat().st_size,
                status="pending",
                uploaded_by=analyst_id,
            ))
            to_process.append((file_id, dest, entry["mime_type"], original_filename))
        await session.commit()

    shutil.rmtree(build_dir, ignore_errors=True)

    # 3. Ingest sequentially — process_document_background manages its own
    # DB session per call, same as a real upload.
    from app.api.documents import process_document_background

    for document_id, file_path, mime_type, original_filename in to_process:
        await process_document_background(
            document_id=document_id,
            workspace_id=workspace_id,
            file_path=file_path,
            mime_type=mime_type,
            original_filename=original_filename,
        )

    # 4. Contradiction Radar (lane L5) — tolerate the stub raising
    # NotImplementedError until that lane lands.
    try:
        from app.radar.scan import run_scan

        await run_scan(workspace_id)
    except NotImplementedError:
        logger.warning("demo_seed_radar_scan_not_implemented", workspace_id=workspace_id)

    result = {"workspace_id": workspace_id}
    settings.data_path.mkdir(parents=True, exist_ok=True)
    marker.write_text(json.dumps(result))
    logger.info("demo_seed_complete", workspace_id=workspace_id, documents=len(to_process))
    return result
