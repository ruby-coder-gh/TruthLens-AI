"""Aggregate all sub-routers into main API router."""

from __future__ import annotations

from fastapi import APIRouter

from app.api import auth, users, workspaces, documents, queries, feedback, admin, ws

api_router = APIRouter(prefix="/api")

# Include sub-routers
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(workspaces.router)
api_router.include_router(documents.router)
api_router.include_router(queries.router)
api_router.include_router(feedback.router)
api_router.include_router(admin.router)

# WebSocket router (no prefix — path is /ws/query)
api_router.include_router(ws.router)
