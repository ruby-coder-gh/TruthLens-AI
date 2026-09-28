"""Truth Receipts — owned by lane L3.

Routes: `POST /api/queries/{qid}/receipts`, `GET /api/queries/{qid}/receipts`,
`GET /api/receipts/{token}` (public), `DELETE /api/receipts/{token}`.
"""

from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import get_accessible_workspace_ids, get_current_user, get_db, require_workspace_editor
from app.core.exceptions import ForbiddenException, NotFoundException
from app.models.audit_log import AuditLog
from app.models.query import Query
from app.models.receipt import Receipt
from app.models.user import User
from app.receipts import build_payload, canonicalize, seal_and_sign, verify
from app.schemas.common import ListResponse
from app.schemas.receipt import ReceiptCreateResponse, ReceiptPublicResponse, ReceiptSummary

router = APIRouter(tags=["receipts"])


def _load_claims(query: Query) -> list[dict[str, Any]]:
    """Parse the query's persisted per-claim verdicts (Truth Lens, lane L1). Empty if none yet."""
    claims_row = query.query_claims
    if claims_row is None:
        return []
    try:
        loaded = json.loads(claims_row.claims or "[]")
    except (json.JSONDecodeError, TypeError):
        return []
    return [c for c in loaded if isinstance(c, dict)] if isinstance(loaded, list) else []


async def _get_query_with_access(query_id: str, user: User, db: AsyncSession) -> Query:
    """Fetch a query the caller can reach (owner/member of its workspace). 404, never leaks existence."""
    workspace_ids = await get_accessible_workspace_ids(db, user)
    if not workspace_ids:
        raise NotFoundException("Query", query_id)
    query = (
        await db.execute(select(Query).where(Query.id == query_id, Query.workspace_id.in_(workspace_ids)))
    ).scalar_one_or_none()
    if not query:
        raise NotFoundException("Query", query_id)
    return query


@router.post(
    "/queries/{query_id}/receipts",
    response_model=ReceiptCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_receipt(
    query_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ReceiptCreateResponse:
    """Seal a Truth Receipt for a finished query."""
    if not settings.RECEIPTS_ENABLED:
        raise ForbiddenException(message="Truth Receipts are disabled")

    query = await _get_query_with_access(query_id, user, db)
    # Sealing publishes a public, unauthenticated page — a viewer (read-only
    # membership) must not be able to publish on the workspace's behalf.
    await require_workspace_editor(workspace=query.workspace, current_user=user, db=db)
    if not query.response_text or query.edge_case:
        raise HTTPException(
            status_code=422,
            detail="Cannot seal a receipt for an abstained or answerless query",
        )

    claims = _load_claims(query)
    payload = build_payload(query, claims, query.workspace)
    canonical = canonicalize(payload)
    seal, signature = seal_and_sign(canonical)

    receipt = Receipt(
        token=secrets.token_urlsafe(24),
        query_id=query.id,
        workspace_id=query.workspace_id,
        created_by=user.id,
        payload=json.dumps(payload),
        canonical=canonical,
        seal=seal,
        signature=signature,
    )
    db.add(receipt)
    await db.flush()
    await db.refresh(receipt)
    db.add(
        AuditLog(
            user_id=user.id,
            action="receipt.create",
            resource_type="receipt",
            resource_id=receipt.id,
            details=json.dumps({"workspace_id": query.workspace_id, "query_id": query.id}),
        )
    )
    return ReceiptCreateResponse(
        token=receipt.token,
        url_path=f"/r/{receipt.token}",
        seal=receipt.seal,
        created_at=receipt.created_at,
    )


@router.get("/queries/{query_id}/receipts", response_model=ListResponse[ReceiptSummary])
async def list_query_receipts(
    query_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ListResponse[ReceiptSummary]:
    """List every receipt sealed for a query the caller can access."""
    query = await _get_query_with_access(query_id, user, db)
    receipts = (
        await db.execute(select(Receipt).where(Receipt.query_id == query.id).order_by(Receipt.created_at.desc()))
    ).scalars().all()
    return ListResponse(
        data=[
            ReceiptSummary(
                token=r.token,
                url_path=f"/r/{r.token}",
                seal=r.seal,
                created_at=r.created_at,
                revoked_at=r.revoked_at,
                view_count=r.view_count,
            )
            for r in receipts
        ]
    )


@router.get("/receipts/{token}", response_model=ReceiptPublicResponse)
async def get_receipt(
    token: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> ReceiptPublicResponse:
    """Public: view a sealed receipt by token. No auth, no cookies required."""
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Robots-Tag"] = "noindex"

    receipt = (await db.execute(select(Receipt).where(Receipt.token == token))).scalar_one_or_none()
    if not receipt:
        raise NotFoundException("Receipt", token)
    if receipt.revoked_at is not None:
        raise HTTPException(status_code=410, detail="This receipt has been revoked")

    seal_valid, signature_valid = verify(receipt)
    # Atomic server-side increment — no read-modify-write race on concurrent views.
    await db.execute(update(Receipt).where(Receipt.id == receipt.id).values(view_count=Receipt.view_count + 1))

    return ReceiptPublicResponse(
        payload=json.loads(receipt.payload),
        canonical=receipt.canonical,
        seal=receipt.seal,
        seal_valid=seal_valid,
        signature_valid=signature_valid,
        issued_at=receipt.created_at,
        revoked=False,
    )


@router.delete("/receipts/{token}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_receipt(
    token: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Revoke a receipt. Allowed for its creator, a workspace editor/owner, or an admin."""
    receipt = (await db.execute(select(Receipt).where(Receipt.token == token))).scalar_one_or_none()
    if not receipt:
        raise NotFoundException("Receipt", token)

    if receipt.created_by != user.id:
        try:
            await require_workspace_editor(workspace=receipt.workspace, current_user=user, db=db)
        except ForbiddenException:
            raise ForbiddenException(
                message="Only the creator, a workspace editor/owner, or an admin can revoke this receipt"
            )

    if receipt.revoked_at is None:
        receipt.revoked_at = datetime.now(timezone.utc)
        db.add(
            AuditLog(
                user_id=user.id,
                action="receipt.revoke",
                resource_type="receipt",
                resource_id=receipt.id,
                details=json.dumps({"workspace_id": receipt.workspace_id, "query_id": receipt.query_id}),
            )
        )
