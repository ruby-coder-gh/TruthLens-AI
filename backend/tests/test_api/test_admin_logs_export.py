"""Audit log filters (user_id/resource_type/date range) + CSV/JSON export (F5)."""

from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.audit_log import AuditLog

# indent=2 forces literal embedded newlines in the stored JSON text (in
# addition to the comma/quote already present) so the CSV export must
# correctly quote-escape a genuine multi-line field, not just the \n escape
# sequence json.dumps() would otherwise produce for a raw newline.
SPECIAL_DETAILS = json.dumps({"note": 'has, a comma and "a quote"'}, indent=2)
assert "\n" in SPECIAL_DETAILS


async def _seed_logs(test_db: AsyncSession) -> dict:
    now = datetime.now(timezone.utc)
    old = now - timedelta(days=40)

    log_user_a = AuditLog(
        user_id="user-aaa",
        action="document.upload",
        resource_type="document",
        resource_id="doc-1",
        details='{"filename": "a.pdf"}',
        ip_address="10.0.0.1",
        created_at=now,
    )
    log_user_b = AuditLog(
        user_id="user-bbb",
        action="user.invite",
        resource_type="user",
        resource_id="user-2",
        details='{"email": "x@example.com"}',
        ip_address="10.0.0.2",
        created_at=now,
    )
    log_old = AuditLog(
        user_id="user-aaa",
        action="workspace.delete",
        resource_type="workspace",
        resource_id="ws-3",
        details="{}",
        ip_address="10.0.0.3",
        created_at=old,
    )
    log_special = AuditLog(
        user_id="user-aaa",
        action="query.compare",
        resource_type="query",
        resource_id="q-4",
        details=SPECIAL_DETAILS,
        ip_address="10.0.0.4",
        created_at=now,
    )
    test_db.add_all([log_user_a, log_user_b, log_old, log_special])
    await test_db.commit()
    return {
        "log_user_a": log_user_a,
        "log_user_b": log_user_b,
        "log_old": log_old,
        "log_special": log_special,
    }


@pytest.mark.asyncio
async def test_logs_filter_by_user_id(client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession):
    await _seed_logs(test_db)

    resp = await client.get("/api/admin/logs?user_id=user-bbb", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["meta"]["total"] == 1
    assert body["data"][0]["user_id"] == "user-bbb"


@pytest.mark.asyncio
async def test_logs_filter_by_resource_type(client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession):
    await _seed_logs(test_db)

    resp = await client.get("/api/admin/logs?resource_type=workspace", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["meta"]["total"] == 1
    assert body["data"][0]["resource_type"] == "workspace"


@pytest.mark.asyncio
async def test_logs_filter_by_date_range_excludes_old(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession
):
    await _seed_logs(test_db)
    date_from = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()

    resp = await client.get("/api/admin/logs", params={"date_from": date_from}, headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["meta"]["total"] == 3  # excludes the 40-day-old row

    resp_all = await client.get("/api/admin/logs", headers=admin_headers)
    assert resp_all.json()["meta"]["total"] == 4


async def _seed_evening_log(test_db: AsyncSession, day: datetime) -> None:
    """One audit log created at 18:00 UTC on `day` (midnight), used to test
    the inclusive/exclusive edges of `date_to`."""
    test_db.add(AuditLog(
        user_id="user-eod",
        action="document.upload",
        resource_type="document",
        resource_id="doc-eod",
        details="{}",
        ip_address="10.0.0.9",
        created_at=day.replace(hour=18),
    ))
    await test_db.commit()


@pytest.mark.asyncio
async def test_logs_date_to_bare_date_includes_full_day(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession
):
    """A bare `date_to=YYYY-MM-DD` must include the whole day (a row created
    at 18:00 that day), not just its first instant (midnight)."""
    day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    await _seed_evening_log(test_db, day)

    resp = await client.get(
        "/api/admin/logs",
        params={"date_from": day.isoformat(), "date_to": day.date().isoformat()},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["meta"]["total"] == 1


@pytest.mark.asyncio
async def test_logs_date_to_explicit_midnight_excludes_same_day_evening_row(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession
):
    """An explicit `T00:00:00` date_to is NOT widened -- it still means
    midnight, unlike a bare date."""
    day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    await _seed_evening_log(test_db, day)

    resp = await client.get(
        "/api/admin/logs",
        params={"date_from": day.isoformat(), "date_to": f"{day.date().isoformat()}T00:00:00"},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["meta"]["total"] == 0


@pytest.mark.asyncio
async def test_logs_date_to_frontend_end_of_day_still_works(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession
):
    """The frontend's explicit `...T23:59:59.999` end-of-day marker keeps
    working unchanged."""
    day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    await _seed_evening_log(test_db, day)

    resp = await client.get(
        "/api/admin/logs",
        params={"date_from": day.isoformat(), "date_to": f"{day.date().isoformat()}T23:59:59.999"},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["meta"]["total"] == 1


@pytest.mark.asyncio
async def test_logs_export_csv_header_and_count(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession
):
    await _seed_logs(test_db)

    resp = await client.get("/api/admin/logs/export?format=csv", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")
    assert "audit-log-" in resp.headers["content-disposition"]
    assert resp.headers["content-disposition"].endswith('.csv"')

    reader = csv.reader(io.StringIO(resp.text))
    rows = list(reader)
    assert rows[0] == ["id", "created_at", "user_id", "action", "resource_type", "resource_id", "ip_address", "details"]
    assert len(rows) == 5  # header + 4 seeded rows


@pytest.mark.asyncio
async def test_logs_export_csv_escapes_special_chars(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession
):
    seed = await _seed_logs(test_db)

    resp = await client.get("/api/admin/logs/export?format=csv", headers=admin_headers)
    assert resp.status_code == 200

    reader = csv.reader(io.StringIO(resp.text))
    rows = list(reader)
    special_row = next(r for r in rows if r[0] == seed["log_special"].id)
    assert special_row[-1] == SPECIAL_DETAILS  # round-trips through CSV quoting intact


@pytest.mark.asyncio
async def test_logs_export_json_shape(client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession):
    seed = await _seed_logs(test_db)

    resp = await client.get("/api/admin/logs/export?format=json", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/json")
    assert resp.headers["content-disposition"].endswith('.json"')

    body = resp.json()
    assert isinstance(body, list)
    assert len(body) == 4
    item = next(r for r in body if r["id"] == seed["log_special"].id)
    assert item["details"] == json.loads(SPECIAL_DETAILS)
    assert item["user_id"] == "user-aaa"
    assert item["action"] == "query.compare"
    assert "created_at" in item


@pytest.mark.asyncio
async def test_logs_export_filters_honoured(client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession):
    await _seed_logs(test_db)

    resp = await client.get("/api/admin/logs/export?format=json&user_id=user-bbb", headers=admin_headers)
    body = resp.json()
    assert len(body) == 1
    assert body[0]["user_id"] == "user-bbb"


@pytest.mark.asyncio
async def test_logs_export_is_audited(client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession):
    await _seed_logs(test_db)

    resp = await client.get("/api/admin/logs/export?format=csv", headers=admin_headers)
    assert resp.status_code == 200

    result = await test_db.execute(select(AuditLog).where(AuditLog.action == "audit.export"))
    row = result.scalar_one_or_none()
    assert row is not None
    details = json.loads(row.details)
    assert details["format"] == "csv"
    assert details["row_count"] == 4


@pytest.mark.asyncio
async def test_logs_export_cap_respected(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(settings, "AUDIT_EXPORT_MAX_ROWS", 2)
    await _seed_logs(test_db)

    resp = await client.get("/api/admin/logs/export?format=json", headers=admin_headers)
    body = resp.json()
    assert len(body) == 2


@pytest.mark.asyncio
async def test_logs_export_requires_admin(client: AsyncClient, auth_headers: dict[str, str]):
    resp = await client.get("/api/admin/logs/export?format=csv", headers=auth_headers)
    assert resp.status_code == 403
