"""Aggregate all sub-routers into main API router."""

from __future__ import annotations

from fastapi import APIRouter

from app.api import auth, users, workspaces, documents, admin_documents, queries, feedback, admin, admin_prompts, ws, collections, comparisons, investigations, search, review_queue, annotations

api_router = APIRouter(prefix="/api")

# Include sub-routers
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(workspaces.router)
api_router.include_router(documents.router)
api_router.include_router(admin_documents.router)
api_router.include_router(queries.router)
api_router.include_router(feedback.router)
api_router.include_router(admin.router)
api_router.include_router(admin_prompts.router)
api_router.include_router(collections.router)
api_router.include_router(comparisons.router)
api_router.include_router(investigations.router)
api_router.include_router(search.router)
api_router.include_router(review_queue.router)
api_router.include_router(annotations.router)

# WebSocket router (no prefix — path is /ws/query)
api_router.include_router(ws.router)
