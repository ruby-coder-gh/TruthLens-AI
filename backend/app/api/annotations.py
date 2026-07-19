"""Collaborative query-answer and source annotation routes."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import (
    check_workspace_access,
    get_current_user,
    get_db,
    is_workspace_owner_or_admin,
)
from app.core.exceptions import ConflictException, ForbiddenException, InvalidInputException, NotFoundException
from app.models.annotation import Annotation
from app.models.audit_log import AuditLog
from app.models.query import Query
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.annotation import AnnotationCountResponse, AnnotationCreate, AnnotationResponse, AnnotationUpdate
from app.schemas.common import ListResponse

router = APIRouter(tags=["annotations"])


def _cited_source_ids(query: Query) -> set[str]:
    try:
        sources = json.loads(query.response_sources or "[]")
    except (TypeError, json.JSONDecodeError):
        return set()
    if not isinstance(sources, list):
        return set()
    return {
        str(source.get("chunk_id"))
        for source in sources
        if isinstance(source, dict) and source.get("chunk_id")
    }


async def _query_or_404(db: AsyncSession, *, workspace_id: str, query_id: str) -> Query:
    query = (await db.execute(
        select(Query).where(Query.id == query_id, Query.workspace_id == workspace_id)
    )).scalar_one_or_none()
    if not query:
        raise NotFoundException("Query", query_id)
    return query


async def _can_manage(annotation: Annotation, *, workspace: Workspace, user: User) -> bool:
    # "Workspace admin" is the owner (or global administrator); editors do not
    # gain authority to rewrite another member's collaborative comment.
    return annotation.user_id == user.id or await is_workspace_owner_or_admin(
        workspace=workspace, current_user=user
    )


def _to_response(annotation: Annotation, *, can_edit: bool) -> AnnotationResponse:
    return AnnotationResponse(
        id=annotation.id,
        workspace_id=annotation.workspace_id,
        query_id=annotation.query_id,
        source_id=annotation.source_id,
        user_id=annotation.user_id,
        author_name=annotation.author.username if annotation.author else None,
        body=None if annotation.deleted_at else annotation.body,
        is_deleted=annotation.deleted_at is not None,
        can_edit=can_edit and annotation.deleted_at is None,
        created_at=annotation.created_at,
        updated_at=annotation.updated_at,
    )


@router.get(
    "/workspaces/{workspace_id}/queries/{query_id}/annotations",
    response_model=ListResponse[AnnotationResponse],
)
async def list_annotations(
    workspace_id: str,
    query_id: str,
    source_id: str | None = None,
    answer_only: bool = False,
    workspace: Workspace = Depends(check_workspace_access),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List answer-level or source-level comments visible to workspace members."""
    await _query_or_404(db, workspace_id=workspace.id, query_id=query_id)
    filters = [Annotation.workspace_id == workspace.id, Annotation.query_id == query_id]
    if source_id is not None:
        filters.append(Annotation.source_id == source_id)
    elif answer_only:
        filters.append(Annotation.source_id.is_(None))
    records = (await db.execute(
        select(Annotation).where(*filters).order_by(Annotation.created_at.asc())
    )).scalars().all()
    can_administer = await is_workspace_owner_or_admin(workspace=workspace, current_user=current_user)
    return ListResponse(data=[
        _to_response(record, can_edit=can_administer or record.user_id == current_user.id)
        for record in records
    ])


@router.get(
    "/workspaces/{workspace_id}/queries/{query_id}/annotations/count",
    response_model=AnnotationCountResponse,
)
async def count_annotations(
    workspace_id: str,
    query_id: str,
    source_id: str | None = None,
    answer_only: bool = False,
    workspace: Workspace = Depends(check_workspace_access),
    db: AsyncSession = Depends(get_db),
):
    """Return an active-comment count for subtle answer/source affordances."""
    await _query_or_404(db, workspace_id=workspace.id, query_id=query_id)
    filters = [
        Annotation.workspace_id == workspace.id,
        Annotation.query_id == query_id,
        Annotation.deleted_at.is_(None),
    ]
    if source_id is not None:
        filters.append(Annotation.source_id == source_id)
    elif answer_only:
        filters.append(Annotation.source_id.is_(None))
    count = (await db.execute(select(func.count(Annotation.id)).where(*filters))).scalar() or 0
    return AnnotationCountResponse(count=count)


@router.post(
    "/workspaces/{workspace_id}/queries/{query_id}/annotations",
    response_model=AnnotationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_annotation(
    workspace_id: str,
    query_id: str,
    payload: AnnotationCreate,
    workspace: Workspace = Depends(check_workspace_access),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a plain-text collaborative comment on an answer or cited source."""
    query = await _query_or_404(db, workspace_id=workspace.id, query_id=query_id)
    body = payload.body.strip()
    if not body:
        raise InvalidInputException("Annotation body must not be empty")
    if payload.source_id and payload.source_id not in _cited_source_ids(query):
        raise InvalidInputException("Source annotation must reference a cited source from this answer")

    annotation = Annotation(
        workspace_id=workspace.id,
        query_id=query.id,
        source_id=payload.source_id,
        user_id=current_user.id,
        body=body,
    )
    db.add(annotation)
    await db.flush()
    await db.refresh(annotation, attribute_names=["author"])
    db.add(AuditLog(
        user_id=current_user.id,
        action="annotation.create",
        resource_type="annotation",
        resource_id=annotation.id,
        details=json.dumps({"workspace_id": workspace.id, "query_id": query.id, "source_id": annotation.source_id}),
    ))
    return _to_response(annotation, can_edit=True)


@router.patch(
    "/workspaces/{workspace_id}/queries/{query_id}/annotations/{annotation_id}",
    response_model=AnnotationResponse,
)
async def update_annotation(
    workspace_id: str,
    query_id: str,
    annotation_id: str,
    payload: AnnotationUpdate,
    workspace: Workspace = Depends(check_workspace_access),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Edit an annotation only as its author or a workspace administrator."""
    await _query_or_404(db, workspace_id=workspace.id, query_id=query_id)
    annotation = (await db.execute(
        select(Annotation).where(
            Annotation.id == annotation_id,
            Annotation.workspace_id == workspace.id,
            Annotation.query_id == query_id,
        )
    )).scalar_one_or_none()
    if not annotation:
        raise NotFoundException("Annotation", annotation_id)
    if annotation.deleted_at:
        raise ConflictException("Deleted annotations cannot be edited")
    if not await _can_manage(annotation, workspace=workspace, user=current_user):
        raise ForbiddenException("Only the annotation author or workspace owner can edit it")
    annotation.body = payload.body.strip()
    if not annotation.body:
        raise InvalidInputException("Annotation body must not be empty")
    await db.flush()
    await db.refresh(annotation, attribute_names=["author"])
    db.add(AuditLog(
        user_id=current_user.id,
        action="annotation.update",
        resource_type="annotation",
        resource_id=annotation.id,
        details=json.dumps({"workspace_id": workspace.id, "query_id": query_id}),
    ))
    return _to_response(annotation, can_edit=True)


@router.delete(
    "/workspaces/{workspace_id}/queries/{query_id}/annotations/{annotation_id}",
    response_model=AnnotationResponse,
)
async def delete_annotation(
    workspace_id: str,
    query_id: str,
    annotation_id: str,
    workspace: Workspace = Depends(check_workspace_access),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Soft-delete a collaborative comment while preserving its audit history."""
    await _query_or_404(db, workspace_id=workspace.id, query_id=query_id)
    annotation = (await db.execute(
        select(Annotation).where(
            Annotation.id == annotation_id,
            Annotation.workspace_id == workspace.id,
            Annotation.query_id == query_id,
        )
    )).scalar_one_or_none()
    if not annotation:
        raise NotFoundException("Annotation", annotation_id)
    if not await _can_manage(annotation, workspace=workspace, user=current_user):
        raise ForbiddenException("Only the annotation author or workspace owner can delete it")
    if not annotation.deleted_at:
        annotation.deleted_at = datetime.now(timezone.utc)
        annotation.deleted_by = current_user.id
        await db.flush()
    db.add(AuditLog(
        user_id=current_user.id,
        action="annotation.delete",
        resource_type="annotation",
        resource_id=annotation.id,
        details=json.dumps({"workspace_id": workspace.id, "query_id": query_id}),
    ))
    return _to_response(annotation, can_edit=False)
