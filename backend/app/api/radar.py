"""Contradiction Radar — owned by lane L5.

Routes: `POST /api/workspaces/{wid}/radar/scans`, `GET /api/workspaces/{wid}/radar`,
`PATCH /api/workspaces/{wid}/radar/contradictions/{id}`.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import noload

from app.chroma_client import get_workspace_collection
from app.core.deps import (
    check_workspace_access,
    check_workspace_access_or_admin,
    get_current_user,
    get_db,
    require_workspace_editor,
)
from app.core.exceptions import NotFoundException
from app.models.audit_log import AuditLog
from app.models.contradiction import Contradiction
from app.models.document import Document
from app.models.radar_scan import RadarScan
from app.models.user import User
from app.models.workspace import Workspace
from app.radar.scan import start_scan_task
from app.utils.logger import logger

router = APIRouter(tags=["radar"])

ContradictionStatus = Literal["open", "dismissed", "resolved"]
# ponytail: hard cap instead of pagination; add paging if a workspace ever nears it.
MAX_ITEMS = 500


class ScanStarted(BaseModel):
    scan_id: str
    status: str


class RadarScanOut(BaseModel):
    id: str
    status: str
    scope: list[str] | None
    chunks_scanned: int
    pairs_checked: int
    found: int
    error: str | None
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime


class ContradictionSide(BaseModel):
    document_id: str
    document_name: str
    chunk_id: str
    page_number: int | None
    sentence: str


class ContradictionOut(BaseModel):
    id: str
    score: float
    similarity: float
    status: str
    created_at: datetime
    a: ContradictionSide
    b: ContradictionSide


class RadarState(BaseModel):
    latest_scan: RadarScanOut | None
    contradictions: list[ContradictionOut]
    counts: dict[str, int]


class ContradictionUpdate(BaseModel):
    status: ContradictionStatus


def _scan_out(scan: RadarScan) -> RadarScanOut:
    return RadarScanOut(
        id=scan.id,
        status=scan.status,
        scope=json.loads(scan.scope) if scan.scope else None,
        chunks_scanned=scan.chunks_scanned or 0,
        pairs_checked=scan.pairs_checked or 0,
        found=scan.found or 0,
        error=scan.error,
        started_at=scan.started_at,
        finished_at=scan.finished_at,
        created_at=scan.created_at,
    )


def _page_numbers_sync(workspace_id: str, chunk_ids: list[str]) -> dict[str, int]:
    got = get_workspace_collection(workspace_id).get(where={"chunk_id": {"$in": chunk_ids}}, include=["metadatas"])
    pages = {}
    for meta in got["metadatas"]:
        if meta and meta.get("chunk_id") and isinstance(meta.get("page_number"), int):
            pages[str(meta["chunk_id"])] = meta["page_number"]
    return pages


async def _page_numbers(workspace_id: str, chunk_ids: list[str]) -> dict[str, int]:
    """Page per chunk from Chroma metadata — best effort, a lookup failure just drops pages."""
    if not chunk_ids:
        return {}
    try:
        return await asyncio.to_thread(_page_numbers_sync, workspace_id, chunk_ids)
    except Exception as e:
        logger.warning("radar_page_lookup_failed", workspace_id=workspace_id, error=str(e))
        return {}


async def _to_items(db: AsyncSession, workspace_id: str, rows: list[Contradiction]) -> list[ContradictionOut]:
    doc_ids = {r.doc_a_id for r in rows} | {r.doc_b_id for r in rows}
    names = dict((await db.execute(
        select(Document.id, Document.original_filename).where(Document.id.in_(doc_ids))
    )).all()) if doc_ids else {}
    pages = await _page_numbers(workspace_id, sorted({r.chunk_a_id for r in rows} | {r.chunk_b_id for r in rows}))

    def side(doc_id: str, chunk_id: str, sentence: str) -> ContradictionSide:
        return ContradictionSide(
            document_id=doc_id, document_name=names.get(doc_id, ""), chunk_id=chunk_id,
            page_number=pages.get(chunk_id), sentence=sentence,
        )

    return [
        ContradictionOut(
            id=r.id, score=r.score, similarity=r.similarity, status=r.status, created_at=r.created_at,
            a=side(r.doc_a_id, r.chunk_a_id, r.sentence_a),
            b=side(r.doc_b_id, r.chunk_b_id, r.sentence_b),
        )
        for r in rows
    ]


@router.post("/workspaces/{workspace_id}/radar/scans", response_model=ScanStarted, status_code=202)
async def start_scan(
    workspace_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Queue a full-workspace contradiction scan (editors). 409 while one is running."""
    await require_workspace_editor(workspace=workspace, current_user=current_user, db=db)
    scan_id = await start_scan_task(workspace.id, created_by=current_user.id)
    db.add(AuditLog(
        user_id=current_user.id,
        action="radar.scan",
        resource_type="workspace",
        resource_id=workspace.id,
        details=json.dumps({"scan_id": scan_id}),
    ))
    return ScanStarted(scan_id=scan_id, status="queued")


@router.get("/workspaces/{workspace_id}/radar", response_model=RadarState)
async def get_radar(
    workspace_id: str,
    status: ContradictionStatus | None = None,
    workspace: Workspace = Depends(check_workspace_access_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Latest scan, contradictions (open first, newest first) and per-status counts."""
    latest = (await db.execute(
        select(RadarScan).options(noload("*"))
        .where(RadarScan.workspace_id == workspace.id)
        .order_by(RadarScan.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()

    query = select(Contradiction).options(noload("*")).where(Contradiction.workspace_id == workspace.id)
    if status:
        query = query.where(Contradiction.status == status)
    rows = list((await db.execute(
        query.order_by(case((Contradiction.status == "open", 0), else_=1), Contradiction.created_at.desc())
        .limit(MAX_ITEMS)
    )).scalars())

    counts = {"open": 0, "dismissed": 0, "resolved": 0}
    for row_status, count in (await db.execute(
        select(Contradiction.status, func.count())
        .where(Contradiction.workspace_id == workspace.id)
        .group_by(Contradiction.status)
    )).all():
        counts[row_status] = count

    return RadarState(
        latest_scan=_scan_out(latest) if latest else None,
        contradictions=await _to_items(db, workspace.id, rows),
        counts=counts,
    )


@router.patch("/workspaces/{workspace_id}/radar/contradictions/{contradiction_id}", response_model=ContradictionOut)
async def update_contradiction(
    workspace_id: str,
    contradiction_id: str,
    payload: ContradictionUpdate,
    workspace: Workspace = Depends(check_workspace_access),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Dismiss, resolve or reopen a contradiction (editors)."""
    await require_workspace_editor(workspace=workspace, current_user=current_user, db=db)
    row = (await db.execute(
        select(Contradiction).options(noload("*")).where(
            Contradiction.id == contradiction_id, Contradiction.workspace_id == workspace.id
        )
    )).scalar_one_or_none()
    if row is None:
        raise NotFoundException("Contradiction", contradiction_id)

    previous = row.status
    row.status = payload.status
    row.resolved_by = None if payload.status == "open" else current_user.id
    db.add(AuditLog(
        user_id=current_user.id,
        action="radar.update",
        resource_type="contradiction",
        resource_id=row.id,
        details=json.dumps({"workspace_id": workspace.id, "from": previous, "to": payload.status}),
    ))
    await db.flush()
    return (await _to_items(db, workspace.id, [row]))[0]
