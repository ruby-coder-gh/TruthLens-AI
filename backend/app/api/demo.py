"""Demo mode — owned by lane L9.

Routes: `GET /api/health/ready` (public), `POST /api/auth/demo-login`,
`GET /api/workspaces/{wid}/suggestions`.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["demo"])
