"""Tests for POST /api/admin/documents/bulk (delete / reindex / tag / untag)."""

from __future__ import annotations

import asyncio
import json
import uuid
from unittest.mock import patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.audit_log import AuditLog
from app.models.document import Document
from app.models.user import User
from app.models.workspace import Workspace


async def _make_workspace(test_db: AsyncSession, owner: User) -> Workspace:
    ws = Workspace(name=f"WS-{uuid.uuid4().hex[:8]}", owner_id=owner.id)
    test_db.add(ws)
    await test_db.commit()
    await test_db.refresh(ws)
    return ws


async def _make_document(
    test_db: AsyncSession,
    workspace_id: str,
    *,
    status: str = "ready",
    tags: list[str] | None = None,
) -> Document:
    doc = Document(
        workspace_id=workspace_id,
        filename=f"{uuid.uuid4().hex}.txt",
        original_filename="doc.txt",
        mime_type="text/plain",
        file_size=10,
        status=status,
        tags=tags or [],
    )
    test_db.add(doc)
    await test_db.commit()
    await test_db.refresh(doc)
    return doc


# ── Auth / validation ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_bulk_action_non_admin_forbidden(client: AsyncClient, auth_headers: dict[str, str]):
    """Non-admin users cannot call the bulk endpoint."""
    resp = await client.post(
        "/api/admin/documents/bulk",
        json={"action": "delete", "document_ids": [str(uuid.uuid4())]},
        headers=auth_headers,
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_bulk_action_too_many_ids_returns_422(client: AsyncClient, admin_headers: dict[str, str]):
    """More than 200 document_ids is rejected before any processing."""
    ids = [str(uuid.uuid4()) for _ in range(201)]
    resp = await client.post(
        "/api/admin/documents/bulk",
        json={"action": "delete", "document_ids": ids},
        headers=admin_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_bulk_action_empty_ids_returns_422(client: AsyncClient, admin_headers: dict[str, str]):
    """An empty document_ids list is rejected."""
    resp = await client.post(
        "/api/admin/documents/bulk",
        json={"action": "delete", "document_ids": []},
        headers=admin_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_bulk_tag_without_tags_returns_422(client: AsyncClient, admin_headers: dict[str, str]):
    """Tag action requires a non-empty tags list."""
    resp = await client.post(
        "/api/admin/documents/bulk",
        json={"action": "tag", "document_ids": [str(uuid.uuid4())]},
        headers=admin_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_bulk_action_unknown_id_reported_failed_not_found(
    client: AsyncClient, admin_headers: dict[str, str]
):
    """An id with no matching document row is reported as a per-item failure."""
    missing_id = str(uuid.uuid4())
    resp = await client.post(
        "/api/admin/documents/bulk",
        json={"action": "delete", "document_ids": [missing_id]},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["results"] == [
        {"id": missing_id, "status": "failed", "error": "not found", "warning": None}
    ]
    assert body["summary"] == {"ok": 0, "accepted": 0, "failed": 1}


# ── Delete ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_bulk_delete_removes_rows_batches_indexer_and_bumps_version_once(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession, test_user: User
):
    """Delete removes DB rows, calls the batched indexer once per workspace, bumps version once."""
    ws1 = await _make_workspace(test_db, test_user)
    ws2 = await _make_workspace(test_db, test_user)
    docs_ws1 = [await _make_document(test_db, ws1.id) for _ in range(2)]
    docs_ws2 = [await _make_document(test_db, ws2.id) for _ in range(2)]
    all_ids = [d.id for d in docs_ws1 + docs_ws2]

    calls: list[tuple[str, list[str]]] = []

    async def fake_delete_documents(workspace_id: str, document_ids: list[str]) -> dict[str, str | None]:
        calls.append((workspace_id, list(document_ids)))
        return dict.fromkeys(document_ids)

    with patch("app.ingestion.indexer.delete_documents", side_effect=fake_delete_documents):
        resp = await client.post(
            "/api/admin/documents/bulk",
            json={"action": "delete", "document_ids": all_ids},
            headers=admin_headers,
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["summary"] == {"ok": 4, "accepted": 0, "failed": 0}
    assert {r["id"]: r["status"] for r in body["results"]} == {i: "ok" for i in all_ids}

    # Batched indexer called exactly once per workspace (not once per doc).
    assert len(calls) == 2
    assert {c[0] for c in calls} == {ws1.id, ws2.id}
    for workspace_id, ids in calls:
        expected = {d.id for d in (docs_ws1 if workspace_id == ws1.id else docs_ws2)}
        assert set(ids) == expected

    # Rows removed.
    remaining = await test_db.execute(select(Document).where(Document.id.in_(all_ids)))
    assert remaining.scalars().all() == []

    # Version bumped exactly once per workspace. The bulk call ran in a
    # separate session, so force a fresh read past test_db's identity map.
    await test_db.refresh(ws1)
    await test_db.refresh(ws2)
    assert ws1.document_version == 1
    assert ws2.document_version == 1


@pytest.mark.asyncio
async def test_bulk_delete_partial_failure_reported_per_id(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession, test_user: User
):
    """A workspace whose indexer batch fails keeps its rows and reports per-id failures."""
    ws_ok = await _make_workspace(test_db, test_user)
    ws_fail = await _make_workspace(test_db, test_user)
    doc_ok = await _make_document(test_db, ws_ok.id)
    doc_fail = await _make_document(test_db, ws_fail.id)

    async def fake_delete_documents(workspace_id: str, document_ids: list[str]) -> dict[str, str | None]:
        if workspace_id == ws_fail.id:
            return {doc_id: "chromadb delete failed: boom" for doc_id in document_ids}
        return dict.fromkeys(document_ids)

    with patch("app.ingestion.indexer.delete_documents", side_effect=fake_delete_documents):
        resp = await client.post(
            "/api/admin/documents/bulk",
            json={"action": "delete", "document_ids": [doc_ok.id, doc_fail.id]},
            headers=admin_headers,
        )

    assert resp.status_code == 200
    body = resp.json()
    results = {r["id"]: r for r in body["results"]}
    assert results[doc_ok.id]["status"] == "ok"
    assert results[doc_fail.id]["status"] == "failed"
    assert "boom" in results[doc_fail.id]["error"]
    assert body["summary"] == {"ok": 1, "accepted": 0, "failed": 1}

    # Failed doc's row is preserved; ok doc's row is gone.
    remaining_ids = (
        (await test_db.execute(select(Document.id).where(Document.id.in_([doc_ok.id, doc_fail.id]))))
        .scalars()
        .all()
    )
    assert remaining_ids == [doc_fail.id]

    # Only the succeeding workspace's version bumps.
    await test_db.refresh(ws_ok)
    await test_db.refresh(ws_fail)
    assert ws_ok.document_version == 1
    assert ws_fail.document_version == 0


# ── Reindex ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_bulk_reindex_returns_accepted_sets_pending_and_bumps_version_once(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession, test_user: User
):
    """Reindex marks docs pending, bumps the workspace version once, and returns accepted."""
    ws = await _make_workspace(test_db, test_user)
    docs = [await _make_document(test_db, ws.id, status="ready") for _ in range(3)]
    doc_ids = [d.id for d in docs]

    with patch("app.api.documents.process_document_background", return_value=None):
        resp = await client.post(
            "/api/admin/documents/bulk",
            json={"action": "reindex", "document_ids": doc_ids},
            headers=admin_headers,
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["summary"] == {"ok": 0, "accepted": 3, "failed": 0}
    assert {r["id"]: r["status"] for r in body["results"]} == {i: "accepted" for i in doc_ids}

    for doc in docs:
        await test_db.refresh(doc)
        assert doc.status == "pending"

    await test_db.refresh(ws)
    assert ws.document_version == 1


@pytest.mark.asyncio
async def test_bulk_reindex_respects_concurrency_semaphore(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession, test_user: User
):
    """No more than BULK_REINDEX_CONCURRENCY reindex jobs run at once."""
    ws = await _make_workspace(test_db, test_user)
    docs = [await _make_document(test_db, ws.id, status="ready") for _ in range(6)]
    doc_ids = [d.id for d in docs]

    # Real files must exist for the background task to be scheduled at all.
    settings.upload_path.mkdir(parents=True, exist_ok=True)
    for doc in docs:
        (settings.upload_path / doc.filename).write_text("content")

    import app.api.admin_documents as admin_documents_module

    concurrent = 0
    max_concurrent = 0
    max_tracked = 0
    lock = asyncio.Lock()

    async def fake_process(**kwargs):
        nonlocal concurrent, max_concurrent, max_tracked
        async with lock:
            concurrent += 1
            max_concurrent = max(max_concurrent, concurrent)
            max_tracked = max(max_tracked, len(admin_documents_module._background_tasks))
        await asyncio.sleep(0.05)
        async with lock:
            concurrent -= 1

    with patch("app.api.documents.process_document_background", side_effect=fake_process), \
         patch("app.api.admin_documents.settings.BULK_REINDEX_CONCURRENCY", 2):
        resp = await client.post(
            "/api/admin/documents/bulk",
            json={"action": "reindex", "document_ids": doc_ids},
            headers=admin_headers,
        )
        assert resp.status_code == 200

        # Drain background tasks fired via asyncio.create_task before asserting.
        pending = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
        await asyncio.gather(*pending)

    assert max_concurrent == 2

    # Tasks must be held in the module-level tracking set while in flight
    # (asyncio.create_task's return value is otherwise the only strong
    # reference keeping a fire-and-forget task alive, so with 6 tasks fired
    # here a GC pass between requests could otherwise silently drop one).
    assert max_tracked > 0

    # Each fired task removes itself from the tracking set via its
    # done-callback once finished, so nothing lingers after they drain.
    assert len(admin_documents_module._background_tasks) == 0

    for doc in docs:
        (settings.upload_path / doc.filename).unlink(missing_ok=True)


# ── Tag / Untag ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_bulk_tag_adds_tags_idempotently(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession, test_user: User
):
    """Tagging twice with the same tags is idempotent (set-union, no duplicates)."""
    ws = await _make_workspace(test_db, test_user)
    doc = await _make_document(test_db, ws.id, tags=["existing"])

    for _ in range(2):
        resp = await client.post(
            "/api/admin/documents/bulk",
            json={"action": "tag", "document_ids": [doc.id], "tags": ["urgent", "reviewed"]},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["summary"] == {"ok": 1, "accepted": 0, "failed": 0}

    await test_db.refresh(doc)
    assert set(doc.tags) == {"existing", "urgent", "reviewed"}


@pytest.mark.asyncio
async def test_bulk_untag_removes_tags_idempotently(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession, test_user: User
):
    """Untagging twice with the same tags is idempotent (set-difference, no error)."""
    ws = await _make_workspace(test_db, test_user)
    doc = await _make_document(test_db, ws.id, tags=["urgent", "reviewed", "keep"])

    for _ in range(2):
        resp = await client.post(
            "/api/admin/documents/bulk",
            json={"action": "untag", "document_ids": [doc.id], "tags": ["urgent", "reviewed"]},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["summary"] == {"ok": 1, "accepted": 0, "failed": 0}

    await test_db.refresh(doc)
    assert doc.tags == ["keep"]


@pytest.mark.asyncio
async def test_bulk_tag_untag_no_version_bump(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession, test_user: User
):
    """Tag/untag do not touch the retrieval-visible document version (cache stays valid)."""
    ws = await _make_workspace(test_db, test_user)
    doc = await _make_document(test_db, ws.id)

    resp = await client.post(
        "/api/admin/documents/bulk",
        json={"action": "tag", "document_ids": [doc.id], "tags": ["x"]},
        headers=admin_headers,
    )
    assert resp.status_code == 200

    await test_db.refresh(ws)
    assert ws.document_version == 0


# ── Audit log ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_bulk_action_writes_single_audit_log_row(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession, test_user: User
):
    """Exactly one AuditLog row is written per bulk call, regardless of doc count."""
    ws = await _make_workspace(test_db, test_user)
    docs = [await _make_document(test_db, ws.id) for _ in range(3)]
    doc_ids = [d.id for d in docs]

    resp = await client.post(
        "/api/admin/documents/bulk",
        json={"action": "tag", "document_ids": doc_ids, "tags": ["audited"]},
        headers=admin_headers,
    )
    assert resp.status_code == 200

    result = await test_db.execute(
        select(AuditLog).where(AuditLog.action == "document.bulk_tag")
    )
    rows = result.scalars().all()
    assert len(rows) == 1
    details = json.loads(rows[0].details)
    assert details["count"] == 3
    assert details["tags"] == ["audited"]


@pytest.mark.asyncio
async def test_bulk_delete_audit_log_includes_document_ids_and_status_lists(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession, test_user: User
):
    """The audit row for an irreversible bulk delete records the affected ids, not just a count."""
    ws = await _make_workspace(test_db, test_user)
    docs = [await _make_document(test_db, ws.id) for _ in range(2)]
    doc_ids = [d.id for d in docs]

    async def fake_delete_documents(workspace_id: str, document_ids: list[str]) -> dict[str, str | None]:
        return dict.fromkeys(document_ids)

    with patch("app.ingestion.indexer.delete_documents", side_effect=fake_delete_documents):
        resp = await client.post(
            "/api/admin/documents/bulk",
            json={"action": "delete", "document_ids": doc_ids},
            headers=admin_headers,
        )
    assert resp.status_code == 200

    result = await test_db.execute(select(AuditLog).where(AuditLog.action == "document.bulk_delete"))
    row = result.scalars().one()
    details = json.loads(row.details)
    assert details["count"] == 2
    assert set(details["document_ids"]) == set(doc_ids)
    assert set(details["ok_ids"]) == set(doc_ids)
    assert details["failed_ids"] == []
    assert details["accepted_ids"] == []


# ── Dedupe ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_bulk_action_dedupes_duplicate_ids(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession, test_user: User
):
    """A repeated id in document_ids counts once in results/summary/audit, not once per occurrence."""
    ws = await _make_workspace(test_db, test_user)
    doc = await _make_document(test_db, ws.id)

    resp = await client.post(
        "/api/admin/documents/bulk",
        json={"action": "tag", "document_ids": [doc.id, doc.id, doc.id], "tags": ["dup"]},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["results"]) == 1
    assert body["summary"] == {"ok": 1, "accepted": 0, "failed": 0}

    result = await test_db.execute(select(AuditLog).where(AuditLog.action == "document.bulk_tag"))
    row = result.scalars().one()
    details = json.loads(row.details)
    assert details["count"] == 1
    assert details["document_ids"] == [doc.id]


# ── Eager loading (performance/correctness) ───────────────────────────────────


@pytest.mark.asyncio
async def test_bulk_action_does_not_eager_load_chunks_or_relationships(
    client: AsyncClient,
    admin_headers: dict[str, str],
    test_db: AsyncSession,
    test_user: User,
    test_engine,
):
    """Bulk actions must not pull chunk bodies or unrelated relationships into memory.

    Document.chunks/.comparison_results/.workspace/.uploader/.collection are
    all lazy="selectin", so an unguarded `select(Document)` issues a separate
    SELECT per relationship (and chunks.content is unbounded Text) for every
    id in the batch. Regression-test this by capturing every SQL statement
    the request issues and asserting none of them touch the chunks table.
    """
    from sqlalchemy import event

    from app.models.chunk import Chunk

    ws = await _make_workspace(test_db, test_user)
    doc = await _make_document(test_db, ws.id, tags=["x"])
    for i in range(5):
        test_db.add(Chunk(document_id=doc.id, index=i, content="x" * 5000, token_count=1))
    await test_db.commit()

    statements: list[str] = []

    def _capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    sync_engine = test_engine.sync_engine
    event.listen(sync_engine, "before_cursor_execute", _capture)
    try:
        resp = await client.post(
            "/api/admin/documents/bulk",
            json={"action": "tag", "document_ids": [doc.id], "tags": ["y"]},
            headers=admin_headers,
        )
    finally:
        event.remove(sync_engine, "before_cursor_execute", _capture)

    assert resp.status_code == 200
    assert not any("chunks" in s.lower() for s in statements), (
        "bulk action queried the chunks table; Document.chunks should be noload()ed"
    )


# ── File-cleanup resilience ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_bulk_delete_file_cleanup_failure_does_not_abort_batch(
    client: AsyncClient, admin_headers: dict[str, str], test_db: AsyncSession, test_user: User
):
    """An OSError unlinking a doc's upload file must not roll back the whole delete batch.

    Vectors are already irreversibly deleted by the time file cleanup runs;
    letting a stray OSError propagate would roll back the row delete, the
    version bump, and the audit log even though the vectors are gone for
    good — the worse outcome. The row must still be removed and the item
    reported "ok" with a warning.
    """
    from pathlib import Path

    ws = await _make_workspace(test_db, test_user)
    doc = await _make_document(test_db, ws.id)

    target_path = settings.upload_path / doc.filename
    settings.upload_path.mkdir(parents=True, exist_ok=True)
    target_path.write_text("content")

    original_unlink = Path.unlink

    def flaky_unlink(self, *args, **kwargs):
        if self == target_path:
            raise OSError("disk error")
        return original_unlink(self, *args, **kwargs)

    async def fake_delete_documents(workspace_id: str, document_ids: list[str]) -> dict[str, str | None]:
        return dict.fromkeys(document_ids)

    try:
        with patch("app.ingestion.indexer.delete_documents", side_effect=fake_delete_documents), patch.object(
            Path, "unlink", flaky_unlink
        ):
            resp = await client.post(
                "/api/admin/documents/bulk",
                json={"action": "delete", "document_ids": [doc.id]},
                headers=admin_headers,
            )
    finally:
        if target_path.exists():
            original_unlink(target_path)

    assert resp.status_code == 200
    body = resp.json()
    result = body["results"][0]
    assert result["status"] == "ok"
    assert result["warning"] is not None
    assert "disk error" in result["warning"]

    remaining = await test_db.execute(select(Document).where(Document.id == doc.id))
    assert remaining.scalar_one_or_none() is None

    await test_db.refresh(ws)
    assert ws.document_version == 1
