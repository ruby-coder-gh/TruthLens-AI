"""Document routes: /api/workspaces/{id}/documents/*"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import APIRouter, Depends, UploadFile, File, Form, BackgroundTasks

from app.config import settings
from app.core.deps import check_workspace_access, get_current_user, get_db
from app.core.exceptions import NotFoundException, TooLargeException, UnsupportedTypeException
from app.models.audit_log import AuditLog
from app.models.chunk import Chunk
from app.models.document import Document
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.common import PaginatedResponse
from app.schemas.document import (
    ChunkInfo,
    DocumentDetailResponse,
    DocumentResponse,
    DocumentStatusResponse,
)
from app.utils.logger import logger

router = APIRouter(tags=["documents"])

SUPPORTED_MIME_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/json",
}

MAX_FILE_SIZE = 52_428_800  # 50 MB


@router.post("/workspaces/{workspace_id}/documents", response_model=DocumentResponse, status_code=202)
async def upload_document(
    workspace_id: str,
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = None,
    current_user: User = Depends(get_current_user),
    workspace: Workspace = Depends(check_workspace_access),
    db: AsyncSession = Depends(get_db),
):
    """Upload a document. Returns 202, processes in background."""
    # Validate file size
    contents = await file.read()
    file_size = len(contents)
    if file_size > MAX_FILE_SIZE:
        raise TooLargeException(f"File exceeds {MAX_FILE_SIZE // 1024 // 1024}MB limit")

    # Validate MIME type
    mime_type = file.content_type or "application/octet-stream"
    if mime_type not in SUPPORTED_MIME_TYPES:
        # Try to detect from extension
        ext = Path(file.filename or "").suffix.lower()
        mime_map = {
            ".pdf": "application/pdf",
            ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".txt": "text/plain",
            ".md": "text/markdown",
            ".csv": "text/csv",
            ".json": "application/json",
        }
        mime_type = mime_map.get(ext, mime_type)
        if mime_type not in SUPPORTED_MIME_TYPES:
            raise UnsupportedTypeException(f"Unsupported file type: {mime_type}")

    # Save file
    upload_dir = settings.upload_path
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_id = str(uuid.uuid4())
    ext = Path(file.filename or "file").suffix
    server_filename = f"{file_id}{ext}"
    file_path = upload_dir / server_filename

    with open(file_path, "wb") as f:
        f.write(contents)

    # Create document record
    doc = Document(
        id=file_id,
        workspace_id=workspace_id,
        filename=server_filename,
        original_filename=file.filename or "unknown",
        mime_type=mime_type,
        file_size=file_size,
        status="pending",
        uploaded_by=current_user.id,
    )
    db.add(doc)
    await db.flush()
    await db.refresh(doc)

    # Audit log
    db.add(AuditLog(
        user_id=current_user.id,
        action="document.upload",
        resource_type="document",
        resource_id=doc.id,
        details=json.dumps({"filename": file.filename, "size": file_size, "mime_type": mime_type}),
    ))

    # Schedule background processing
    if background_tasks:
        background_tasks.add_task(
            process_document_background,
            document_id=doc.id,
            workspace_id=workspace_id,
            file_path=file_path,
            mime_type=mime_type,
            original_filename=file.filename or "unknown",
        )

    return DocumentResponse(
        id=doc.id,
        workspace_id=doc.workspace_id,
        filename=doc.filename,
        original_filename=doc.original_filename,
        mime_type=doc.mime_type,
        file_size=doc.file_size,
        page_count=doc.page_count,
        chunk_count=doc.chunk_count,
        status=doc.status,
        error_message=doc.error_message,
        uploaded_by=doc.uploaded_by,
        created_at=doc.created_at,
        updated_at=doc.updated_at,
    )


@router.get("/workspaces/{workspace_id}/documents", response_model=PaginatedResponse[DocumentResponse])
async def list_documents(
    workspace_id: str,
    status: str | None = None,
    page: int = 1,
    page_size: int = 20,
    workspace: Workspace = Depends(check_workspace_access),
    db: AsyncSession = Depends(get_db),
):
    """List documents in a workspace, filterable by status."""
    query = select(Document).where(Document.workspace_id == workspace_id)
    count_query = select(func.count(Document.id)).where(Document.workspace_id == workspace_id)

    if status:
        query = query.where(Document.status == status)
        count_query = count_query.where(Document.status == status)

    # Count
    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0

    # Fetch page
    offset = (page - 1) * page_size
    result = await db.execute(query.order_by(Document.created_at.desc()).offset(offset).limit(page_size))
    docs = result.scalars().all()

    return PaginatedResponse(
        data=[
            DocumentResponse(
                id=d.id,
                workspace_id=d.workspace_id,
                filename=d.filename,
                original_filename=d.original_filename,
                mime_type=d.mime_type,
                file_size=d.file_size,
                page_count=d.page_count,
                chunk_count=d.chunk_count,
                status=d.status,
                error_message=d.error_message,
                uploaded_by=d.uploaded_by,
                created_at=d.created_at,
                updated_at=d.updated_at,
            )
            for d in docs
        ],
        meta={"page": page, "page_size": page_size, "total": total},
    )


@router.get("/workspaces/{workspace_id}/documents/{doc_id}", response_model=DocumentDetailResponse)
async def get_document(
    workspace_id: str,
    doc_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    db: AsyncSession = Depends(get_db),
):
    """Get document with its chunks."""
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.workspace_id == workspace_id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise NotFoundException("Document", doc_id)

    chunk_result = await db.execute(
        select(Chunk).where(Chunk.document_id == doc_id).order_by(Chunk.index)
    )
    chunks = chunk_result.scalars().all()

    return DocumentDetailResponse(
        id=doc.id,
        workspace_id=doc.workspace_id,
        original_filename=doc.original_filename,
        mime_type=doc.mime_type,
        file_size=doc.file_size,
        page_count=doc.page_count,
        chunk_count=doc.chunk_count,
        status=doc.status,
        chunks=[
            ChunkInfo(
                id=c.id,
                index=c.index,
                content=c.content[:500] + ("..." if len(c.content) > 500 else ""),
                token_count=c.token_count,
                created_at=c.created_at,
            )
            for c in chunks
        ],
    )


@router.get("/workspaces/{workspace_id}/documents/{doc_id}/status", response_model=DocumentStatusResponse)
async def get_document_status(
    workspace_id: str,
    doc_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    db: AsyncSession = Depends(get_db),
):
    """Poll document processing status."""
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.workspace_id == workspace_id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise NotFoundException("Document", doc_id)

    return DocumentStatusResponse(
        id=doc.id,
        status=doc.status,
        chunk_count=doc.chunk_count,
        error_message=doc.error_message,
    )


@router.delete("/workspaces/{workspace_id}/documents/{doc_id}", status_code=204)
async def delete_document(
    workspace_id: str,
    doc_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete document and remove from ChromaDB."""
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.workspace_id == workspace_id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise NotFoundException("Document", doc_id)

    # Remove from ChromaDB + BM25
    from app.ingestion.indexer import delete_document as delete_index
    await delete_index(workspace_id, doc_id)

    # Delete file
    file_path = settings.upload_path / doc.filename
    if file_path.exists():
        file_path.unlink()

    db.add(AuditLog(
        user_id=current_user.id,
        action="document.delete",
        resource_type="document",
        resource_id=doc_id,
    ))
    await db.delete(doc)


async def process_document_background(
    document_id: str,
    workspace_id: str,
    file_path: Path,
    mime_type: str,
    original_filename: str,
) -> None:
    """Background task: process document through ingestion pipeline."""
    from app.database import async_session_factory
    from app.graph.ingestion_graph import run_ingestion_pipeline

    logger.info("background_ingestion_start", document_id=document_id)

    # Update status to processing
    async with async_session_factory() as session:
        result = await session.execute(select(Document).where(Document.id == document_id))
        doc = result.scalar_one_or_none()
        if doc:
            doc.status = "processing"
            await session.commit()

    # Run ingestion pipeline
    result = await run_ingestion_pipeline(
        document_id=document_id,
        workspace_id=workspace_id,
        file_path=file_path,
        mime_type=mime_type,
        original_filename=original_filename,
    )

    # Update document status
    async with async_session_factory() as session:
        doc_result = await session.execute(select(Document).where(Document.id == document_id))
        doc = doc_result.scalar_one_or_none()
        if doc:
            if result["status"] == "success":
                doc.status = "ready"
                doc.chunk_count = result["chunk_count"]
            else:
                doc.status = "failed"
                doc.error_message = result.get("error", "Unknown error")
            await session.commit()

    logger.info(
        "background_ingestion_complete",
        document_id=document_id,
        status=result["status"],
        chunk_count=result["chunk_count"],
    )
