"""Admin-only bulk document operations: delete / reindex / tag / untag."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import get_current_admin, get_db
from app.models.audit_log import AuditLog
from app.models.document import Document
from app.models.user import User
from app.query_cache import bump_workspace_document_version
from app.schemas.document import (
    BulkDocumentAction,
    BulkDocumentResponse,
    BulkDocumentResult,
    BulkDocumentSummary,
)
from app.utils.logger import logger

router = APIRouter(
    prefix="/admin/documents",
    tags=["admin documents"],
    dependencies=[Depends(get_current_admin)],
)


async def _reindex_one(
    *,
    document_id: str,
    workspace_id: str,
    file_path: Path,
    mime_type: str,
    original_filename: str,
    semaphore: asyncio.Semaphore,
) -> None:
    """Run one document through the ingestion pipeline, bounded by ``semaphore``."""
    from app.api.documents import process_document_background

    async with semaphore:
        await process_document_background(
            document_id=document_id,
            workspace_id=workspace_id,
            file_path=file_path,
            mime_type=mime_type,
            original_filename=original_filename,
        )


async def _bulk_delete(
    db: AsyncSession,
    workspace_id: str,
    docs: list[Document],
    results: dict[str, BulkDocumentResult],
) -> None:
    """Batch-delete one workspace's documents: vectors -> files -> rows -> one version bump."""
    from app.ingestion.indexer import delete_documents

    doc_ids = [doc.id for doc in docs]
    errors = await delete_documents(workspace_id, doc_ids)

    deleted_any = False
    for doc in docs:
        error = errors.get(doc.id)
        if error:
            results[doc.id] = BulkDocumentResult(id=doc.id, status="failed", error=error)
            continue

        file_path = settings.upload_path / doc.filename
        if file_path.exists():
            file_path.unlink()

        await db.delete(doc)
        results[doc.id] = BulkDocumentResult(id=doc.id, status="ok")
        deleted_any = True

    if deleted_any:
        await bump_workspace_document_version(db, workspace_id)


async def _bulk_reindex(
    db: AsyncSession,
    workspace_id: str,
    docs: list[Document],
    results: dict[str, BulkDocumentResult],
    semaphore: asyncio.Semaphore,
) -> None:
    """Mark one workspace's documents pending, bump its version once, fan out reindex jobs."""
    if not docs:
        return

    for doc in docs:
        doc.status = "pending"
        doc.error_message = None
    await bump_workspace_document_version(db, workspace_id)

    for doc in docs:
        file_path = settings.upload_path / doc.filename
        if file_path.exists():
            asyncio.create_task(
                _reindex_one(
                    document_id=doc.id,
                    workspace_id=workspace_id,
                    file_path=file_path,
                    mime_type=doc.mime_type,
                    original_filename=doc.original_filename,
                    semaphore=semaphore,
                )
            )
        else:
            logger.warning("bulk_reindex_missing_file", document_id=doc.id, filename=doc.filename)
        results[doc.id] = BulkDocumentResult(id=doc.id, status="accepted")


def _bulk_tag(docs: list[Document], tags: list[str], results: dict[str, BulkDocumentResult]) -> None:
    """Union the given tags onto each document (idempotent)."""
    additions = {t.strip() for t in tags if t.strip()}
    for doc in docs:
        doc.tags = sorted(set(doc.tags or []) | additions)
        results[doc.id] = BulkDocumentResult(id=doc.id, status="ok")


def _bulk_untag(docs: list[Document], tags: list[str], results: dict[str, BulkDocumentResult]) -> None:
    """Remove the given tags from each document (idempotent)."""
    removals = {t.strip() for t in tags if t.strip()}
    for doc in docs:
        doc.tags = sorted(set(doc.tags or []) - removals)
        results[doc.id] = BulkDocumentResult(id=doc.id, status="ok")


@router.post("/bulk", response_model=BulkDocumentResponse)
async def bulk_document_action(
    body: BulkDocumentAction,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> BulkDocumentResponse:
    """Run delete/reindex/tag/untag across up to 200 documents, grouped by workspace."""
    found = await db.execute(select(Document).where(Document.id.in_(body.document_ids)))
    found_docs = {doc.id: doc for doc in found.scalars().all()}

    results: dict[str, BulkDocumentResult] = {
        doc_id: BulkDocumentResult(id=doc_id, status="failed", error="not found")
        for doc_id in body.document_ids
        if doc_id not in found_docs
    }

    by_workspace: dict[str, list[Document]] = {}
    for doc in found_docs.values():
        by_workspace.setdefault(doc.workspace_id, []).append(doc)

    if body.action == "delete":
        for workspace_id, docs in by_workspace.items():
            await _bulk_delete(db, workspace_id, docs, results)
    elif body.action == "reindex":
        semaphore = asyncio.Semaphore(settings.BULK_REINDEX_CONCURRENCY)
        for workspace_id, docs in by_workspace.items():
            await _bulk_reindex(db, workspace_id, docs, results, semaphore)
    elif body.action == "tag":
        for docs in by_workspace.values():
            _bulk_tag(docs, body.tags or [], results)
    elif body.action == "untag":
        for docs in by_workspace.values():
            _bulk_untag(docs, body.tags or [], results)

    ordered_results = [results[doc_id] for doc_id in body.document_ids]
    summary = BulkDocumentSummary()
    for item in ordered_results:
        if item.status == "ok":
            summary.ok += 1
        elif item.status == "accepted":
            summary.accepted += 1
        else:
            summary.failed += 1

    db.add(
        AuditLog(
            user_id=current_user.id,
            action=f"document.bulk_{body.action}",
            resource_type="document",
            details=json.dumps(
                {
                    "count": len(body.document_ids),
                    "tags": body.tags,
                    "summary": summary.model_dump(),
                }
            ),
        )
    )

    return BulkDocumentResponse(results=ordered_results, summary=summary)
