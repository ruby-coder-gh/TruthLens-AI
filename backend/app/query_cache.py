"""SQLite-backed cache helpers for completed workspace queries."""

from __future__ import annotations

import json
import re
import string
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.query import Query
from app.models.workspace import Workspace
from app.utils.logger import logger


def normalize_query(query: str) -> str:
    """Normalize a query for an intentional, whitespace/punctuation-tolerant cache key."""
    return re.sub(r"\s+", " ", query).strip().lower().rstrip(string.punctuation).strip()


async def get_workspace_document_version(session: AsyncSession, workspace_id: str) -> int:
    """Return the current document-set version for a workspace, defaulting safely to zero."""
    version = await session.scalar(
        select(Workspace.document_version).where(Workspace.id == workspace_id)
    )
    return int(version or 0)


async def bump_workspace_document_version(session: AsyncSession, workspace_id: str) -> int:
    """Advance the document-set version after a retrieval-visible document change."""
    result = await session.execute(
        update(Workspace)
        .where(Workspace.id == workspace_id)
        .values(document_version=Workspace.document_version + 1)
    )
    if result.rowcount != 1:
        logger.warning("workspace_document_version_bump_skipped", workspace_id=workspace_id)
        return 0

    version = await get_workspace_document_version(session, workspace_id)
    logger.info("workspace_document_version_bumped", workspace_id=workspace_id, document_version=version)
    return version


async def lookup_cached_query(
    session: AsyncSession,
    *,
    workspace_id: str,
    query_text: str,
    document_version: int,
    now: datetime | None = None,
    force_refresh: bool = False,
) -> Query | None:
    """Find a valid cached answer for one workspace and increment its hit counter."""
    normalized_query = normalize_query(query_text)

    if not settings.QUERY_CACHE_ENABLED:
        logger.info("query_cache_miss", workspace_id=workspace_id, reason="disabled")
        return None
    if force_refresh:
        logger.info("query_cache_bypassed", workspace_id=workspace_id, reason="force_refresh")
        return None
    if not normalized_query:
        logger.info("query_cache_miss", workspace_id=workspace_id, reason="empty_query")
        return None

    ttl_seconds = settings.QUERY_CACHE_TTL_SECONDS
    if ttl_seconds <= 0:
        logger.info("query_cache_miss", workspace_id=workspace_id, reason="ttl_disabled")
        return None

    timestamp = now or datetime.now(timezone.utc)
    cutoff = timestamp - timedelta(seconds=ttl_seconds)
    cached_query = await session.scalar(
        select(Query)
        .where(
            Query.workspace_id == workspace_id,
            Query.normalized_query == normalized_query,
            Query.document_version == document_version,
            Query.response_text.isnot(None),
            Query.created_at >= cutoff,
        )
        .order_by(Query.created_at.desc())
        .limit(1)
    )

    if cached_query is None:
        logger.info(
            "query_cache_miss",
            workspace_id=workspace_id,
            document_version=document_version,
            reason="not_found",
        )
        return None

    cached_query.cache_hit_count += 1
    await session.flush()
    logger.info(
        "query_cache_hit",
        workspace_id=workspace_id,
        cache_query_id=cached_query.id,
        document_version=document_version,
    )
    return cached_query


def cached_query_sources(query: Query) -> list[dict[str, Any]]:
    """Decode the persisted source contexts defensively for cache responses."""
    if not query.response_sources:
        return []
    try:
        parsed = json.loads(query.response_sources)
    except (TypeError, json.JSONDecodeError):
        return []
    return [source for source in parsed if isinstance(source, dict)] if isinstance(parsed, list) else []
