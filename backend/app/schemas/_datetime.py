"""Shared UTC-aware datetime serialization for response schemas.

SQLite (via aiosqlite) returns naive `datetime` objects even for columns
declared `DateTime(timezone=True)`, and every timestamp written by the app
is UTC (see `TimestampMixin` / model defaults using
`datetime.now(timezone.utc)` and SQLite's `func.now()`). Pydantic then
serializes those naive values without any offset (e.g.
`"2026-07-10T18:02:11.283791"`), which clients parse as *local* time,
producing wrong "time ago" displays for non-UTC clients.

`utc_iso` is the single point of truth for fixing this: it treats a naive
datetime as UTC and emits an ISO-8601 string with an explicit `+00:00`
offset. Apply it to every `datetime` response field via:

    from app.schemas._datetime import utc_iso
    from pydantic import field_serializer

    class Foo(BaseModel):
        created_at: datetime
        _serialize_created_at = field_serializer("created_at")(utc_iso)

For multiple datetime fields on one model, pass all field names to a single
decorator call: `field_serializer("created_at", "updated_at")(utc_iso)`.
"""

from __future__ import annotations

from datetime import datetime, timezone


def utc_iso(dt: datetime | None) -> str | None:
    """Serialize a datetime as UTC-aware ISO-8601 (naive values assumed UTC)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.isoformat()
