"""Admin-only bulk document operations: delete / reindex / tag / untag."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import noload

from app.config import settings
from app.core.deps import get_current_admin, get_db
from app.models.audit_log import AuditLog
from app.models.chunk import Chunk
from app.models.comparison import ComparisonResult
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

# Relationships we never need for a bulk action (tags/status/filename/
# mime_type are the only columns any action touches). Document.chunks in
# particular is lazy="selectin" with an unbounded Text body per row, so
# without this a 200-doc bulk call would pull every chunk's full content
# into memory on every call.
_BULK_LOAD_OPTIONS = (
    noload(Document.chunks),
    noload(Document.comparison_results),
    noload(Document.workspace),
    noload(Document.uploader),
    noload(Document.collection),
)

# Strong references to fire-and-forget reindex tasks so they aren't
# garbage-collected mid-flight (asyncio only weakly tracks tasks with no
# other referent); each task removes itself once done.
_background_tasks: set[asyncio.Task[None]] = set()


def _track(task: asyncio.Task[None]) -> None:
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


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

    to_delete_ids: list[str] = []
    for doc in docs:
        error = errors.get(doc.id)
        if error:
            results[doc.id] = BulkDocumentResult(id=doc.id, status="failed", error=error)
            continue

        # Vectors are already gone (irreversibly) at this point. Best-effort
        # file cleanup must never abort the batch: a stray OSError here used
        # to propagate out of the request, roll back the whole session, and
        # leave rows/audit-log/version-bump undone even though the vectors
        # for THIS workspace were already deleted for real.
        warning: str | None = None
        try:
            file_path = settings.upload_path / doc.filename
            if file_path.exists():
                file_path.unlink()
        except OSError as e:
            warning = f"file cleanup failed: {e}"
            logger.warning("bulk_delete_file_cleanup_failed", document_id=doc.id, error=str(e))

        to_delete_ids.append(doc.id)
        results[doc.id] = BulkDocumentResult(id=doc.id, status="ok", warning=warning)

    if to_delete_ids:
        # Bulk-delete via Core statements instead of `await db.delete(doc)`
        # per row. Two reasons: (1) avoids the ORM loading every chunk's
        # full Text body + comparison_results into memory just to cascade
        # them one object at a time; (2) this app runs on SQLite without
        # `PRAGMA foreign_keys=ON` set anywhere (verified — no pragma is
        # issued at connection time), so the `ondelete="CASCADE"` on
        # Chunk/ComparisonResult's FK is metadata-only and is NOT enforced
        # by the database itself. Relying on it here would silently orphan
        # rows. Delete children explicitly, then the parent.
        await db.execute(delete(Chunk).where(Chunk.document_id.in_(to_delete_ids)))
        await db.execute(delete(ComparisonResult).where(ComparisonResult.document_id.in_(to_delete_ids)))
        await db.execute(delete(Document).where(Document.id.in_(to_delete_ids)))
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
            task = asyncio.create_task(
                _reindex_one(
                    document_id=doc.id,
                    workspace_id=workspace_id,
                    file_path=file_path,
                    mime_type=doc.mime_type,
                    original_filename=doc.original_filename,
                    semaphore=semaphore,
                )
            )
            _track(task)
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
    # Dedupe while preserving order: a repeated id must count once in the
    # summary/audit log, not once per occurrence in the request body.
    doc_ids = list(dict.fromkeys(body.document_ids))

    found = await db.execute(
        select(Document).options(*_BULK_LOAD_OPTIONS).where(Document.id.in_(doc_ids))
    )
    found_docs = {doc.id: doc for doc in found.scalars().all()}

    results: dict[str, BulkDocumentResult] = {
        doc_id: BulkDocumentResult(id=doc_id, status="failed", error="not found")
        for doc_id in doc_ids
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

    ordered_results = [results[doc_id] for doc_id in doc_ids]
    summary = BulkDocumentSummary()
    ok_ids: list[str] = []
    accepted_ids: list[str] = []
    failed_ids: list[str] = []
    for item in ordered_results:
        if item.status == "ok":
            summary.ok += 1
            ok_ids.append(item.id)
        elif item.status == "accepted":
            summary.accepted += 1
            accepted_ids.append(item.id)
        else:
            summary.failed += 1
            failed_ids.append(item.id)

    db.add(
        AuditLog(
            user_id=current_user.id,
            action=f"document.bulk_{body.action}",
            resource_type="document",
            details=json.dumps(
                {
                    "count": len(doc_ids),
                    "tags": body.tags,
                    "summary": summary.model_dump(),
                    "document_ids": doc_ids,
                    "ok_ids": ok_ids,
                    "accepted_ids": accepted_ids,
                    "failed_ids": failed_ids,
                }
            ),
        )
    )

    return BulkDocumentResponse(results=ordered_results, summary=summary)
