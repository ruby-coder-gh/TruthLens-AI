"""Investigation case API: grounded research runs plus review workflow."""

from __future__ import annotations

import asyncio
import json
import zipfile
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import check_workspace_access, get_current_user, get_db, require_workspace_editor
from app.core.exceptions import InvalidInputException, NotFoundException
from app.models.audit_log import AuditLog
from app.models.chunk import Chunk
from app.models.document import Document
from app.models.investigation import Investigation
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.common import PaginatedResponse
from app.schemas.investigation import (
    InvestigationRequest,
    InvestigationResponse,
    InvestigationReviewUpdate,
    InvestigationSummary,
)
from app.report_export import render_investigation_markdown
from app.utils.logger import logger

router = APIRouter(tags=["investigation"])

MIN_PAGE_SIZE = 1
MAX_PAGE_SIZE = 100


def _to_response(case: Investigation) -> InvestigationResponse:
    return InvestigationResponse(
        id=case.id,
        workspace_id=case.workspace_id,
        query=case.query_text,
        final_report=case.final_report,
        trust_score=case.trust_score,
        trust_components=case.trust_components or {},
        reasoning_trace=case.reasoning_trace or [],
        sub_questions=case.sub_questions or [],
        latency_ms=case.latency_ms,
        error=case.error,
        review_status=case.review_status,
        review_note=case.review_note,
        reviewed_by=case.reviewed_by,
        reviewed_at=case.reviewed_at,
        created_at=case.created_at,
        updated_at=case.updated_at,
    )


def _evidence_sources(case: Investigation) -> list[dict[str, Any]]:
    """Flatten immutable cited spans/retrieved chunks into exportable evidence."""
    sources: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for sub_question in case.sub_questions or []:
        if not isinstance(sub_question, dict):
            continue
        for citation in sub_question.get("citations") or []:
            if not isinstance(citation, dict):
                continue
            source = {
                "chunk_id": citation.get("chunk_id", ""),
                "excerpt": citation.get("text", ""),
                "document_name": citation.get("document_name", ""),
            }
            key = (str(source["chunk_id"]), str(source["excerpt"]))
            if key not in seen:
                seen.add(key)
                sources.append(source)
        for retrieved in sub_question.get("retrieved_chunks") or []:
            if not isinstance(retrieved, dict):
                continue
            source = dict(retrieved)
            key = (str(source.get("chunk_id", "")), str(source.get("excerpt", source.get("content", ""))))
            if key not in seen:
                seen.add(key)
                sources.append(source)
    return sources


def _audit_details(raw: str | None) -> dict[str, Any] | None:
    try:
        parsed = json.loads(raw or "{}")
        return parsed if isinstance(parsed, dict) else None
    except (TypeError, json.JSONDecodeError):
        return None


async def _require_reviewer(
    *, workspace: Workspace, current_user: User, db: AsyncSession
) -> None:
    """Backward-compatible investigation alias for the shared role helper."""
    await require_workspace_editor(workspace=workspace, current_user=current_user, db=db)


@router.post(
    "/workspaces/{workspace_id}/investigate",
    response_model=InvestigationResponse,
    status_code=201,
)
async def investigate(
    workspace_id: str,
    body: InvestigationRequest,
    workspace: Workspace = Depends(check_workspace_access),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Run a grounded investigation and persist its reproducible case snapshot."""
    from app.graph.investigation import run_investigation

    logger.info(
        "investigation_api_started",
        query=body.query[:100],
        workspace_id=workspace_id,
        user_id=current_user.id,
    )
    result = await asyncio.to_thread(
        run_investigation,
        query=body.query,
        workspace_id=workspace_id,
        user_id=current_user.id,
        top_k=body.top_k,
        filters=body.filters,
    )

    case = Investigation(
        workspace_id=workspace_id,
        user_id=current_user.id,
        query_text=body.query,
        final_report=result.get("final_report", ""),
        sub_questions=result.get("sub_questions", []),
        reasoning_trace=result.get("reasoning_trace", []),
        trust_components=result.get("trust_components", {}),
        trust_score=result.get("trust_score"),
        latency_ms=result.get("latency_ms", 0),
        error=result.get("error"),
        review_status="needs_changes" if result.get("error") else "draft",
    )
    db.add(case)
    await db.flush()
    await db.refresh(case)
    db.add(
        AuditLog(
            user_id=current_user.id,
            action="investigation.create",
            resource_type="investigation",
            resource_id=case.id,
            details=json.dumps(
                {
                    "workspace_id": workspace_id,
                    "trust_score": case.trust_score,
                    "latency_ms": case.latency_ms,
                    "has_error": bool(case.error),
                    "sub_question_count": len(case.sub_questions or []),
                }
            ),
        )
    )

    logger.info(
        "investigation_api_complete",
        investigation_id=case.id,
        trust_score=case.trust_score,
        latency_ms=case.latency_ms,
    )
    return _to_response(case)


@router.get(
    "/workspaces/{workspace_id}/investigations",
    response_model=PaginatedResponse[InvestigationSummary],
)
async def list_investigations(
    workspace_id: str,
    page: int = 1,
    page_size: int = 20,
    workspace: Workspace = Depends(check_workspace_access),
    db: AsyncSession = Depends(get_db),
):
    """List durable investigation cases for the active workspace."""
    page_size = max(MIN_PAGE_SIZE, min(page_size, MAX_PAGE_SIZE))
    total = (
        await db.execute(
            select(func.count(Investigation.id)).where(Investigation.workspace_id == workspace.id)
        )
    ).scalar() or 0
    records = (
        await db.execute(
            select(Investigation)
            .where(Investigation.workspace_id == workspace.id)
            .order_by(Investigation.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()
    return PaginatedResponse(
        data=[
            InvestigationSummary(
                id=case.id,
                workspace_id=case.workspace_id,
                query=case.query_text,
                trust_score=case.trust_score,
                review_status=case.review_status,
                created_at=case.created_at,
                updated_at=case.updated_at,
            )
            for case in records
        ],
        meta={"page": page, "page_size": page_size, "total": total},
    )


@router.get(
    "/workspaces/{workspace_id}/investigations/{investigation_id}",
    response_model=InvestigationResponse,
)
async def get_investigation(
    workspace_id: str,
    investigation_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    db: AsyncSession = Depends(get_db),
):
    """Return the exact persisted report, evidence snapshots, and review state."""
    case = (
        await db.execute(
            select(Investigation).where(
                Investigation.id == investigation_id,
                Investigation.workspace_id == workspace.id,
            )
        )
    ).scalar_one_or_none()
    if not case:
        raise NotFoundException("Investigation", investigation_id)
    return _to_response(case)


@router.patch(
    "/workspaces/{workspace_id}/investigations/{investigation_id}/review",
    response_model=InvestigationResponse,
)
async def review_investigation(
    workspace_id: str,
    investigation_id: str,
    body: InvestigationReviewUpdate,
    workspace: Workspace = Depends(check_workspace_access),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Record an editor/owner review decision and preserve its audit trail."""
    await _require_reviewer(workspace=workspace, current_user=current_user, db=db)
    case = (
        await db.execute(
            select(Investigation).where(
                Investigation.id == investigation_id,
                Investigation.workspace_id == workspace.id,
            )
        )
    ).scalar_one_or_none()
    if not case:
        raise NotFoundException("Investigation", investigation_id)

    prior_status = case.review_status
    case.review_status = body.review_status
    case.review_note = body.review_note.strip() if body.review_note else None
    case.reviewed_by = current_user.id
    case.reviewed_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(case)
    db.add(
        AuditLog(
            user_id=current_user.id,
            action="investigation.review_update",
            resource_type="investigation",
            resource_id=case.id,
            details=json.dumps(
                {"from": prior_status, "to": case.review_status, "has_note": bool(case.review_note)}
            ),
        )
    )
    return _to_response(case)


@router.get("/workspaces/{workspace_id}/investigations/{investigation_id}/export")
async def export_investigation_audit_bundle(
    workspace_id: str,
    investigation_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Assemble an in-memory, logged compliance bundle for a saved case file."""
    case = (await db.execute(
        select(Investigation).where(
            Investigation.id == investigation_id,
            Investigation.workspace_id == workspace.id,
        )
    )).scalar_one_or_none()
    if not case:
        raise NotFoundException("Investigation", investigation_id)
    if not case.reasoning_trace:
        raise InvalidInputException("This investigation has no reasoning trace to export yet")

    evidence = _evidence_sources(case)
    chunk_ids = [str(source.get("chunk_id")) for source in evidence if source.get("chunk_id")]
    chunk_documents: dict[str, Document] = {}
    if chunk_ids:
        joined = await db.execute(
            select(Chunk.id, Document)
            .join(Document, Document.id == Chunk.document_id)
            .where(Chunk.id.in_(chunk_ids), Document.workspace_id == workspace.id)
        )
        chunk_documents = {chunk_id: document for chunk_id, document in joined.all()}
    for source in evidence:
        document = chunk_documents.get(str(source.get("chunk_id", "")))
        if document:
            source.setdefault("document_id", document.id)
            source["document_name"] = source.get("document_name") or document.original_filename

    documents: dict[str, Document] = {document.id: document for document in chunk_documents.values()}
    document_references = [
        {
            "id": document.id,
            "filename": document.original_filename,
            "mime_type": document.mime_type,
            "file_size": document.file_size,
            "status": document.status,
        }
        for document in documents.values()
    ]
    audit_rows = (await db.execute(
        select(AuditLog)
        .where(
            AuditLog.resource_type == "investigation",
            AuditLog.resource_id == case.id,
        )
        .order_by(AuditLog.created_at.asc())
    )).scalars().all()
    audit_events = [
        {
            "id": row.id,
            "action": row.action,
            "user_id": row.user_id,
            "details": _audit_details(row.details),
            "created_at": row.created_at.isoformat(),
        }
        for row in audit_rows
    ]
    creator = await db.get(User, case.user_id) if case.user_id else None
    raw_bundle = {
        "metadata": {
            "investigation_id": case.id,
            "workspace_id": workspace.id,
            "workspace_name": workspace.name,
            "generated_by": {"id": creator.id, "username": creator.username} if creator else None,
            "created_at": case.created_at.isoformat(),
            "exported_at": datetime.now(timezone.utc).isoformat(),
        },
        "investigation": {
            "query": case.query_text,
            "final_report": case.final_report,
            "trust_score": case.trust_score,
            "trust_components": case.trust_components or {},
            "latency_ms": case.latency_ms,
            "error": case.error,
            "review_status": case.review_status,
            "review_note": case.review_note,
            "reviewed_by": case.reviewed_by,
            "reviewed_at": case.reviewed_at.isoformat() if case.reviewed_at else None,
        },
        "reasoning_trace": case.reasoning_trace or [],
        "sub_questions": case.sub_questions or [],
        "evidence": evidence,
        "source_documents": document_references,
        "audit_events": audit_events,
    }
    summary = render_investigation_markdown(
        investigation_id=case.id,
        workspace_name=workspace.name,
        query=case.query_text,
        final_report=case.final_report,
        trust_score=case.trust_score,
        review_status=case.review_status,
        review_note=case.review_note,
        sources=evidence,
    )

    # Include original files only when the complete referenced set remains
    # within the existing upload-size convention; otherwise references above
    # keep the audit artifact bounded and portable.
    included_documents = bool(documents) and sum(document.file_size for document in documents.values()) <= settings.SERVER_MAX_UPLOAD_SIZE
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("summary.md", summary)
        archive.writestr("audit-data.json", json.dumps(raw_bundle, indent=2, default=str))
        if included_documents:
            for document in documents.values():
                source_path = settings.upload_path / document.filename
                if source_path.is_file():
                    archive.write(source_path, arcname=f"source-documents/{document.id}-{Path(document.original_filename).name}")
                else:
                    included_documents = False
            if not included_documents:
                archive.writestr("source-document-references.json", json.dumps(document_references, indent=2))
        else:
            archive.writestr("source-document-references.json", json.dumps(document_references, indent=2))

    db.add(AuditLog(
        user_id=current_user.id,
        action="investigation.audit_export",
        resource_type="investigation",
        resource_id=case.id,
        details=json.dumps({
            "workspace_id": workspace.id,
            "evidence_count": len(evidence),
            "source_document_count": len(documents),
            "source_documents_included": included_documents,
        }),
    ))
    return Response(
        content=buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="truthlens-audit-{case.id}.zip"'},
    )
