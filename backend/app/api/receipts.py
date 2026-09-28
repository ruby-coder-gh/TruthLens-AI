"""Truth Receipts — owned by lane L3.

Routes: `POST /api/queries/{qid}/receipts`, `GET /api/queries/{qid}/receipts`,
`GET /api/receipts/{token}` (public), `DELETE /api/receipts/{token}`.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["receipts"])
