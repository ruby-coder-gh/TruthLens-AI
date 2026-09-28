"""Contradiction Radar — owned by lane L5.

Routes: `POST /api/workspaces/{wid}/radar/scans`, `GET /api/workspaces/{wid}/radar`,
`PATCH /api/workspaces/{wid}/radar/contradictions/{id}`.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["radar"])
