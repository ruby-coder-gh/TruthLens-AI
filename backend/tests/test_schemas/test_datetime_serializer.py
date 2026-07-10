"""Unit tests for the shared UTC-aware datetime serializer (bug #9).

SQLite returns naive datetimes even for `DateTime(timezone=True)` columns.
`app.schemas._datetime.utc_iso` is the single point of truth that treats a
naive datetime as UTC and emits an ISO-8601 string with an explicit offset,
applied via `field_serializer` on every response schema with a datetime
field. These tests pin the helper's behavior directly, plus a couple of
representative schema classes to prove the serializer is actually wired up.
"""

from __future__ import annotations

from datetime import datetime, timezone

from app.schemas._datetime import utc_iso
from app.schemas.common import AuditLogResponse
from app.schemas.document import DocumentResponse
from app.schemas.user import UserResponse


def test_utc_iso_treats_naive_datetime_as_utc():
    """A naive datetime (as SQLite returns) gets a UTC offset appended."""
    naive = datetime(2026, 7, 10, 18, 2, 11, 283791)
    result = utc_iso(naive)
    assert result is not None
    assert result.endswith("+00:00")
    parsed = datetime.fromisoformat(result)
    assert parsed.tzinfo is not None
    assert parsed.utcoffset() == timezone.utc.utcoffset(parsed)


def test_utc_iso_preserves_already_aware_datetime():
    """An already tz-aware datetime is converted to UTC, not double-offset."""
    aware = datetime(2026, 7, 10, 20, 2, 11, tzinfo=timezone.utc)
    result = utc_iso(aware)
    assert result == aware.isoformat()


def test_utc_iso_converts_non_utc_aware_datetime_to_utc():
    """A tz-aware datetime in a non-UTC zone is normalized to UTC offset."""
    from datetime import timedelta, timezone as tz

    ist = tz(timedelta(hours=5, minutes=30))
    aware_ist = datetime(2026, 7, 10, 23, 32, 11, tzinfo=ist)
    result = utc_iso(aware_ist)
    assert result is not None
    assert result.endswith("+00:00")
    parsed = datetime.fromisoformat(result)
    assert parsed == aware_ist.astimezone(timezone.utc)


def test_utc_iso_none_passthrough():
    """None values pass through unchanged (for Optional datetime fields)."""
    assert utc_iso(None) is None


def test_document_response_serializes_naive_timestamps_as_utc():
    """DocumentResponse (a representative schema) emits tz-aware created_at/updated_at."""
    naive = datetime(2026, 7, 10, 18, 2, 11, 283791)
    doc = DocumentResponse(
        id="doc-1",
        workspace_id="ws-1",
        filename="a.txt",
        original_filename="a.txt",
        mime_type="text/plain",
        file_size=10,
        status="ready",
        created_at=naive,
        updated_at=naive,
    )
    dumped = doc.model_dump(mode="json")
    assert dumped["created_at"].endswith("+00:00")
    assert dumped["updated_at"].endswith("+00:00")


def test_user_response_last_login_at_optional_and_tz_aware():
    """UserResponse.last_login_at (bug #7 field) is tz-aware when set, null when absent."""
    naive = datetime(2026, 7, 9, 3, 15, 0)
    user = UserResponse(
        id="user-1",
        email="u@example.com",
        username="u",
        role="user",
        is_active=True,
        last_login_at=naive,
        created_at=naive,
        updated_at=naive,
    )
    dumped = user.model_dump(mode="json")
    assert dumped["last_login_at"].endswith("+00:00")

    user_never_logged_in = UserResponse(
        id="user-2",
        email="u2@example.com",
        username="u2",
        role="user",
        is_active=True,
        created_at=naive,
        updated_at=naive,
    )
    assert user_never_logged_in.model_dump(mode="json")["last_login_at"] is None


def test_audit_log_response_created_at_tz_aware():
    """AuditLogResponse.created_at serializes tz-aware (used by /api/admin/logs)."""
    naive = datetime(2026, 7, 10, 18, 2, 11)
    log = AuditLogResponse(
        id="log-1",
        user_id="user-1",
        action="document.upload",
        resource_type="document",
        created_at=naive,
    )
    dumped = log.model_dump(mode="json")
    assert dumped["created_at"].endswith("+00:00")
