"""Document routes: /api/workspaces/{id}/documents/*"""

from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import APIRouter, Depends, UploadFile, File

from app.config import settings
from app.core.deps import check_workspace_access, check_workspace_access_or_admin, get_current_user, get_db
from app.core.exceptions import ForbiddenException, NotFoundException, TooLargeException, UnsupportedTypeException
from app.models.audit_log import AuditLog
from app.models.chunk import Chunk
from app.models.document import Document
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.schemas.common import PaginatedResponse
from app.schemas.document import (
    ChunkInfo,
    DocumentDetailResponse,
    DocumentResponse,
    DocumentStatusResponse,
)
from app.query_cache import bump_workspace_document_version
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
UPLOAD_CHUNK_SIZE = 1024 * 1024
MIN_PAGE_SIZE = 1
MAX_PAGE_SIZE = 100
MAX_DETAIL_CHUNKS = 200


@router.post("/workspaces/{workspace_id}/documents", response_model=DocumentResponse, status_code=202)
async def upload_document(
    workspace_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    workspace: Workspace = Depends(check_workspace_access),
    db: AsyncSession = Depends(get_db),
):
    """Upload a document. Returns 202, processes in background."""
    content_length = file.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_FILE_SIZE:
                raise TooLargeException(f"File exceeds {MAX_FILE_SIZE // 1024 // 1024}MB limit")
        except ValueError as e:
            logger.debug("invalid_content_length_header", content_length=content_length, error=str(e))

    file_size_hint = getattr(file, "size", None)
    if file_size_hint is not None and file_size_hint > MAX_FILE_SIZE:
        raise TooLargeException(f"File exceeds {MAX_FILE_SIZE // 1024 // 1024}MB limit")

    if current_user.role != "admin" and workspace.owner_id != current_user.id:
        member_result = await db.execute(
            select(WorkspaceMember.role).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == current_user.id,
            )
        )
        if member_result.scalar_one_or_none() == "viewer":
            raise ForbiddenException("Viewer role cannot upload documents")

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

    file_size = 0
    try:
        with open(file_path, "wb") as f:
            while True:
                chunk = await file.read(UPLOAD_CHUNK_SIZE)
                if not chunk:
                    break
                file_size += len(chunk)
                if file_size > MAX_FILE_SIZE:
                    raise TooLargeException(f"File exceeds {MAX_FILE_SIZE // 1024 // 1024}MB limit")
                f.write(chunk)
    except TooLargeException:
        if file_path.exists():
            file_path.unlink()
        raise

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
    await bump_workspace_document_version(db, workspace_id)
    await db.refresh(doc)

    # Audit log
    db.add(AuditLog(
        user_id=current_user.id,
        action="document.upload",
        resource_type="document",
        resource_id=doc.id,
        details=json.dumps({"filename": file.filename, "size": file_size, "mime_type": mime_type}),
    ))

    # Schedule background processing via asyncio (reliable for async tasks)
    asyncio.create_task(
        process_document_background(
            document_id=doc.id,
            workspace_id=workspace_id,
            file_path=file_path,
            mime_type=mime_type,
            original_filename=file.filename or "unknown",
        )
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
    page_size = max(MIN_PAGE_SIZE, min(page_size, MAX_PAGE_SIZE))

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
    workspace: Workspace = Depends(check_workspace_access_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get document with its chunks. Admins may view any workspace's documents."""
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.workspace_id == workspace_id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise NotFoundException("Document", doc_id)

    chunk_result = await db.execute(
        select(Chunk).where(Chunk.document_id == doc_id).order_by(Chunk.index).limit(MAX_DETAIL_CHUNKS)
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
        created_at=doc.created_at,
        updated_at=doc.updated_at,
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
    workspace: Workspace = Depends(check_workspace_access_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Poll document processing status. Admins may view any workspace's documents."""
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

    if current_user.role != "admin" and workspace.owner_id != current_user.id:
        member_result = await db.execute(
            select(WorkspaceMember.role).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == current_user.id,
            )
        )
        if member_result.scalar_one_or_none() == "viewer":
            raise ForbiddenException("Viewer role cannot delete documents")

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
    await bump_workspace_document_version(db, workspace_id)
    await db.delete(doc)


@router.get("/documents", response_model=PaginatedResponse[DocumentResponse])
async def list_all_documents(
    status: str | None = None,
    search: str | None = None,
    file_type: str | None = None,
    page: int = 1,
    page_size: int = 20,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List ALL documents across accessible workspaces (no workspace scope)."""
    page_size = max(MIN_PAGE_SIZE, min(page_size, MAX_PAGE_SIZE))

    # Admin sees all documents
    if current_user.role == "admin":
        query = select(Document)
        count_query = select(func.count(Document.id))
        if status:
            query = query.where(Document.status == status)
            count_query = count_query.where(Document.status == status)
    else:
        # Regular user: documents from workspaces they are members of
        member_ws_ids = select(WorkspaceMember.workspace_id).where(
            WorkspaceMember.user_id == current_user.id
        )
        query = select(Document).where(Document.workspace_id.in_(member_ws_ids))
        count_query = select(func.count(Document.id)).where(Document.workspace_id.in_(member_ws_ids))
        if status:
            query = query.where(Document.status == status)
            count_query = count_query.where(Document.status == status)

    # Apply the same controlled filters to the data and count queries. Search
    # is server-backed, so results on later pages remain discoverable.
    if search and search.strip():
        filename_pattern = f"%{search.strip()}%"
        query = query.where(Document.original_filename.ilike(filename_pattern))
        count_query = count_query.where(Document.original_filename.ilike(filename_pattern))

    allowed_types = {"pdf", "docx", "txt", "md", "csv", "json"}
    normalized_type = (file_type or "").lower().lstrip(".")
    if normalized_type in allowed_types:
        extension_pattern = f"%.{normalized_type}"
        query = query.where(func.lower(Document.original_filename).like(extension_pattern))
        count_query = count_query.where(func.lower(Document.original_filename).like(extension_pattern))

    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0

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


@router.post("/workspaces/{workspace_id}/documents/{doc_id}/reindex", status_code=202)
async def reindex_document(
    workspace_id: str,
    doc_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Re-trigger ingestion for a document (workspace owner or admin)."""
    from app.models.workspace import Workspace

    # Check workspace ownership
    ws_result = await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    workspace = ws_result.scalar_one_or_none()
    if not workspace:
        raise NotFoundException("Workspace", workspace_id)

    if current_user.role != "admin" and workspace.owner_id != current_user.id:
        member_result = await db.execute(
            select(WorkspaceMember.role).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == current_user.id,
            )
        )
        if member_result.scalar_one_or_none() == "viewer":
            raise ForbiddenException("Viewer role cannot reindex documents")

    if workspace.owner_id != current_user.id and current_user.role != "admin":
        raise ForbiddenException("Only workspace owner or admin can reindex")

    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.workspace_id == workspace_id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise NotFoundException("Document", doc_id)

    # Reset status to trigger re-ingestion
    doc.status = "pending"
    doc.error_message = None
    await bump_workspace_document_version(db, workspace_id)

    # Schedule background processing via asyncio
    file_path = settings.upload_path / doc.filename
    if file_path.exists():
        asyncio.create_task(
            process_document_background(
                document_id=doc.id,
                workspace_id=workspace_id,
                file_path=file_path,
                mime_type=doc.mime_type,
                original_filename=doc.original_filename,
            )
        )

    db.add(AuditLog(
        user_id=current_user.id,
        action="document.reindex",
        resource_type="document",
        resource_id=doc_id,
    ))

    return {"message": "Document reindex initiated", "document_id": doc_id}


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
    ingest_result = await run_ingestion_pipeline(
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
            if ingest_result["status"] == "success":
                doc.status = "ready"
                doc.chunk_count = ingest_result["chunk_count"]
                await bump_workspace_document_version(session, workspace_id)
            else:
                doc.status = "failed"
                doc.error_message = ingest_result.get("error", "Unknown error")
            await session.commit()

    logger.info(
        "background_ingestion_complete",
        document_id=document_id,
        status=ingest_result["status"],
        chunk_count=ingest_result["chunk_count"],
    )
