"""Query-cache behavior tests."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.query import Query
from app.models.user import User
from app.models.workspace import Workspace
from app.query_cache import lookup_cached_query, normalize_query


async def _create_workspace(test_db: AsyncSession, user: User, name: str, document_version: int = 0) -> Workspace:
    workspace = Workspace(name=name, owner_id=user.id, document_version=document_version)
    test_db.add(workspace)
    await test_db.commit()
    await test_db.refresh(workspace)
    return workspace


async def _create_cached_query(
    test_db: AsyncSession,
    workspace: Workspace,
    user: User,
    question: str,
    *,
    document_version: int | None = None,
    created_at: datetime | None = None,
) -> Query:
    query = Query(
        workspace_id=workspace.id,
        user_id=user.id,
        query_text=question,
        normalized_query=normalize_query(question),
        document_version=workspace.document_version if document_version is None else document_version,
        response_text="Cached answer",
        response_sources="[]",
        trust_score=0.91,
        guardrail_score=0.94,
        guardrail_passed=True,
        model_used="test-model",
        latency_ms=123,
        token_count=12,
        created_at=created_at or datetime.now(timezone.utc),
    )
    test_db.add(query)
    await test_db.commit()
    await test_db.refresh(query)
    return query


@pytest.mark.asyncio
async def test_exact_match_returns_cached_query(monkeypatch, test_db: AsyncSession, test_user: User):
    monkeypatch.setattr(settings, "QUERY_CACHE_ENABLED", True)
    monkeypatch.setattr(settings, "QUERY_CACHE_TTL_SECONDS", 3_600)
    workspace = await _create_workspace(test_db, test_user, "Exact cache", document_version=2)
    cached = await _create_cached_query(test_db, workspace, test_user, "What is the policy?")

    hit = await lookup_cached_query(
        test_db,
        workspace_id=workspace.id,
        query_text="What is the policy?",
        document_version=workspace.document_version,
    )

    assert hit is not None
    assert hit.id == cached.id
    assert hit.response_text == "Cached answer"
    assert hit.cache_hit_count == 1


@pytest.mark.asyncio
async def test_normalized_question_returns_cached_query(monkeypatch, test_db: AsyncSession, test_user: User):
    monkeypatch.setattr(settings, "QUERY_CACHE_ENABLED", True)
    monkeypatch.setattr(settings, "QUERY_CACHE_TTL_SECONDS", 3_600)
    workspace = await _create_workspace(test_db, test_user, "Normalized cache", document_version=1)
    cached = await _create_cached_query(test_db, workspace, test_user, "What is the policy?")

    hit = await lookup_cached_query(
        test_db,
        workspace_id=workspace.id,
        query_text="  WHAT   is   the policy!!!  ",
        document_version=workspace.document_version,
    )

    assert hit is not None
    assert hit.id == cached.id


@pytest.mark.asyncio
async def test_cache_misses_for_different_workspace(monkeypatch, test_db: AsyncSession, test_user: User):
    monkeypatch.setattr(settings, "QUERY_CACHE_ENABLED", True)
    monkeypatch.setattr(settings, "QUERY_CACHE_TTL_SECONDS", 3_600)
    source_workspace = await _create_workspace(test_db, test_user, "Source workspace", document_version=1)
    other_workspace = await _create_workspace(test_db, test_user, "Other workspace", document_version=1)
    await _create_cached_query(test_db, source_workspace, test_user, "What is the policy?")

    hit = await lookup_cached_query(
        test_db,
        workspace_id=other_workspace.id,
        query_text="What is the policy?",
        document_version=other_workspace.document_version,
    )

    assert hit is None


@pytest.mark.asyncio
async def test_cache_misses_when_document_version_changes(monkeypatch, test_db: AsyncSession, test_user: User):
    monkeypatch.setattr(settings, "QUERY_CACHE_ENABLED", True)
    monkeypatch.setattr(settings, "QUERY_CACHE_TTL_SECONDS", 3_600)
    workspace = await _create_workspace(test_db, test_user, "Version cache", document_version=4)
    await _create_cached_query(test_db, workspace, test_user, "What is the policy?", document_version=3)

    hit = await lookup_cached_query(
        test_db,
        workspace_id=workspace.id,
        query_text="What is the policy?",
        document_version=workspace.document_version,
    )

    assert hit is None


@pytest.mark.asyncio
async def test_cache_misses_after_ttl_expiry(monkeypatch, test_db: AsyncSession, test_user: User):
    monkeypatch.setattr(settings, "QUERY_CACHE_ENABLED", True)
    monkeypatch.setattr(settings, "QUERY_CACHE_TTL_SECONDS", 60)
    workspace = await _create_workspace(test_db, test_user, "TTL cache", document_version=1)
    now = datetime.now(timezone.utc)
    await _create_cached_query(
        test_db,
        workspace,
        test_user,
        "What is the policy?",
        created_at=now - timedelta(seconds=61),
    )

    hit = await lookup_cached_query(
        test_db,
        workspace_id=workspace.id,
        query_text="What is the policy?",
        document_version=workspace.document_version,
        now=now,
    )

    assert hit is None
