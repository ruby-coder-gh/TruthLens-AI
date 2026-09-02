"""Tests for /api/admin/logs: q search filter and timestamp serialization (bugs #8, #9)."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog


async def _seed_logs(test_db: AsyncSession) -> None:
    test_db.add_all(
        [
            AuditLog(
                action="document.upload",
                resource_type="document",
                resource_id="doc-123",
                details='{"filename": "quarterly_report.pdf"}',
                ip_address="10.0.0.1",
            ),
            AuditLog(
                action="user.invite",
                resource_type="user",
                resource_id="user-456",
                details='{"email": "someone@example.com"}',
                ip_address="10.0.0.2",
            ),
            AuditLog(
                action="workspace.delete",
                resource_type="workspace",
                resource_id="ws-789",
                details='{"name": "Old Workspace"}',
                ip_address="10.0.0.3",
            ),
        ]
    )
    await test_db.commit()


@pytest.mark.asyncio
async def test_audit_logs_q_filters_by_action(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession
):
    """`q` matches against the action column (case-insensitive substring)."""
    await _seed_logs(test_db)

    resp = await client.get("/api/admin/logs?q=upload", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["meta"]["total"] == 1
    assert all("upload" in item["action"] for item in body["data"])


@pytest.mark.asyncio
async def test_audit_logs_q_is_case_insensitive(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession
):
    """`q` matching is case-insensitive."""
    await _seed_logs(test_db)

    resp = await client.get("/api/admin/logs?q=UPLOAD", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["meta"]["total"] == 1


@pytest.mark.asyncio
async def test_audit_logs_q_matches_details_json(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession
):
    """`q` also searches the details column (e.g. filenames stored as JSON text)."""
    await _seed_logs(test_db)

    resp = await client.get("/api/admin/logs?q=quarterly_report", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["meta"]["total"] == 1
    assert body["data"][0]["resource_id"] == "doc-123"


@pytest.mark.asyncio
async def test_audit_logs_q_no_match_returns_empty(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession
):
    """`q` with no matches returns an empty page, not an error."""
    await _seed_logs(test_db)

    resp = await client.get("/api/admin/logs?q=nonexistent_search_term_xyz", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["meta"]["total"] == 0
    assert body["data"] == []


@pytest.mark.asyncio
async def test_audit_logs_q_combines_with_action_filter_and_pagination(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession
):
    """`q` composes with the existing `action` filter and pagination stays correct."""
    await _seed_logs(test_db)

    # action filter narrows to zero when q wouldn't match that action.
    resp = await client.get(
        "/api/admin/logs?action=user.invite&q=upload", headers=admin_headers
    )
    assert resp.status_code == 200
    assert resp.json()["meta"]["total"] == 0

    # action + matching q returns exactly the one row.
    resp = await client.get(
        "/api/admin/logs?action=user.invite&q=someone", headers=admin_headers
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["meta"]["total"] == 1
    assert body["data"][0]["action"] == "user.invite"


@pytest.mark.asyncio
async def test_audit_logs_created_at_is_tz_aware(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession
):
    """Serialized created_at carries a UTC offset (Z or +00:00), not a naive timestamp (bug #9)."""
    await _seed_logs(test_db)

    resp = await client.get("/api/admin/logs", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["data"], "expected at least one audit log row"

    for item in body["data"]:
        created_at_raw = item["created_at"]
        assert created_at_raw.endswith("Z") or "+00:00" in created_at_raw or created_at_raw[-6] in "+-"
        parsed = datetime.fromisoformat(created_at_raw.replace("Z", "+00:00"))
        assert parsed.tzinfo is not None
        assert parsed.utcoffset() == timezone.utc.utcoffset(parsed)


# ─── SEC-1 (LOW): LIKE wildcards in the `q` filter ───────────────────


@pytest.mark.asyncio
async def test_audit_logs_q_treats_wildcards_literally(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession
):
    """`q` is a substring search: `_` must not act as a single-char wildcard."""
    test_db.add_all([
        AuditLog(action="a_b.literal", resource_type="query", resource_id="lit-1", details="{}"),
        AuditLog(action="axb.wildcard", resource_type="query", resource_id="wild-1", details="{}"),
    ])
    await test_db.commit()

    resp = await client.get("/api/admin/logs?q=a_b", headers=admin_headers)
    assert resp.status_code == 200
    ids = [row["resource_id"] for row in resp.json()["data"]]
    assert ids == ["lit-1"]


@pytest.mark.asyncio
async def test_audit_logs_q_percent_does_not_match_everything(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession
):
    """A bare `%` is a literal character, not "match every row"."""
    await _seed_logs(test_db)

    resp = await client.get("/api/admin/logs?q=%25", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["meta"]["total"] == 0
