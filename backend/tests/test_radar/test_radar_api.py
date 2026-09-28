"""Contradiction Radar API, post-ingest hook, delete cleanup and WS `conflicts` (lane L5)."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth import create_access_token
from app.models.audit_log import AuditLog
from app.models.contradiction import Contradiction
from app.models.document import Document
from app.models.radar_scan import RadarScan
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from tests.test_radar.conftest import FakeCollection


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.id, user.role)}"}


@pytest_asyncio.fixture
async def world(test_db: AsyncSession):
    """Owner, viewer, outsider; one workspace with two documents."""
    users = {}
    for name in ("owner", "viewer", "outsider"):
        user = User(email=f"{name}@radar.dev", username=f"radar_{name}", password_hash="x", role="user", is_active=True)
        test_db.add(user)
        users[name] = user
    await test_db.commit()
    workspace = Workspace(name="Radar", owner_id=users["owner"].id)
    test_db.add(workspace)
    await test_db.commit()
    test_db.add(WorkspaceMember(workspace_id=workspace.id, user_id=users["viewer"].id, role="viewer"))
    docs = []
    for name in ("annual-report.pdf", "press-release.pdf"):
        doc = Document(
            workspace_id=workspace.id, filename=f"srv-{name}", original_filename=name,
            mime_type="application/pdf", file_size=1, status="ready",
        )
        test_db.add(doc)
        docs.append(doc)
    await test_db.commit()
    return workspace, docs, users


def _contradiction(workspace, docs, key: str, status: str = "open", age_minutes: int = 0, **kw) -> Contradiction:
    return Contradiction(
        workspace_id=workspace.id, pair_key=key,
        doc_a_id=docs[0].id, chunk_a_id=kw.get("chunk_a", "chunk-a"), sentence_a="Revenue was €412 million.",
        doc_b_id=docs[1].id, chunk_b_id=kw.get("chunk_b", "chunk-b"), sentence_b="Revenue was €398 million.",
        score=0.97, similarity=0.88, status=status,
        created_at=datetime.now(timezone.utc) - timedelta(minutes=age_minutes),
    )


@pytest.fixture
def page_collection(monkeypatch):
    """Fake Chroma for page-number lookups in GET."""
    collection = FakeCollection([
        {"id": "d:0", "document_id": "d", "chunk_id": "chunk-a", "text": "", "embedding": [1.0], "page_number": 4},
        {"id": "d:1", "document_id": "d", "chunk_id": "chunk-b", "text": "", "embedding": [1.0], "page_number": 2},
    ])
    monkeypatch.setattr("app.api.radar.get_workspace_collection", lambda _wid: collection)
    return collection


@pytest.mark.asyncio
class TestRadarApi:
    async def test_owner_starts_scan_202_and_audits(self, client: AsyncClient, world, test_db, monkeypatch):
        from app.api.stream_registry import pending_tasks
        from app.radar import scan as scan_mod

        workspace, _docs, users = world
        monkeypatch.setattr(scan_mod, "get_workspace_collection", lambda _wid: FakeCollection([]))

        resp = await client.post(f"/api/workspaces/{workspace.id}/radar/scans", headers=_headers(users["owner"]))
        await asyncio.gather(*pending_tasks())

        assert resp.status_code == 202
        body = resp.json()
        assert body["status"] == "queued"
        scan = (await test_db.execute(select(RadarScan).where(RadarScan.id == body["scan_id"]))).scalar_one()
        assert scan.created_by == users["owner"].id
        audit = (await test_db.execute(select(AuditLog).where(AuditLog.action == "radar.scan"))).scalar_one()
        assert audit.resource_id == workspace.id
        assert json.loads(audit.details)["scan_id"] == body["scan_id"]

    async def test_scan_409_when_one_is_active(self, client: AsyncClient, world, test_db):
        workspace, _docs, users = world
        test_db.add(RadarScan(workspace_id=workspace.id, status="queued"))
        await test_db.commit()

        resp = await client.post(f"/api/workspaces/{workspace.id}/radar/scans", headers=_headers(users["owner"]))

        assert resp.status_code == 409

    async def test_viewer_can_read_but_not_scan_or_update(self, client: AsyncClient, world, test_db, page_collection):
        workspace, docs, users = world
        row = _contradiction(workspace, docs, "k1")
        test_db.add(row)
        await test_db.commit()
        viewer = _headers(users["viewer"])

        assert (await client.get(f"/api/workspaces/{workspace.id}/radar", headers=viewer)).status_code == 200
        assert (await client.post(f"/api/workspaces/{workspace.id}/radar/scans", headers=viewer)).status_code == 403
        patch_resp = await client.patch(
            f"/api/workspaces/{workspace.id}/radar/contradictions/{row.id}", json={"status": "dismissed"}, headers=viewer,
        )
        assert patch_resp.status_code == 403

    async def test_outsider_cannot_read(self, client: AsyncClient, world):
        workspace, _docs, users = world
        resp = await client.get(f"/api/workspaces/{workspace.id}/radar", headers=_headers(users["outsider"]))
        assert resp.status_code == 403

    async def test_get_returns_latest_scan_items_and_counts(self, client: AsyncClient, world, test_db, page_collection):
        workspace, docs, users = world
        test_db.add(RadarScan(workspace_id=workspace.id, status="done", found=3,
                              created_at=datetime.now(timezone.utc) - timedelta(hours=1)))
        latest = RadarScan(workspace_id=workspace.id, status="running", chunks_scanned=7, scope=json.dumps([docs[0].id]))
        test_db.add(latest)
        test_db.add_all([
            _contradiction(workspace, docs, "old-open", age_minutes=30),
            _contradiction(workspace, docs, "new-dismissed", status="dismissed", age_minutes=1),
            _contradiction(workspace, docs, "new-open", age_minutes=5),
        ])
        await test_db.commit()

        resp = await client.get(f"/api/workspaces/{workspace.id}/radar", headers=_headers(users["owner"]))

        assert resp.status_code == 200
        body = resp.json()
        assert body["latest_scan"]["id"] == latest.id
        assert body["latest_scan"]["status"] == "running"
        assert body["latest_scan"]["chunks_scanned"] == 7
        assert body["latest_scan"]["scope"] == [docs[0].id]
        assert body["counts"] == {"open": 2, "dismissed": 1, "resolved": 0}
        statuses = [item["status"] for item in body["contradictions"]]
        assert statuses == ["open", "open", "dismissed"]  # open first, newest first
        first = body["contradictions"][0]
        assert first["a"] == {
            "document_id": docs[0].id, "document_name": "annual-report.pdf", "chunk_id": "chunk-a",
            "page_number": 4, "sentence": "Revenue was €412 million.",
        }
        assert first["b"]["document_name"] == "press-release.pdf"
        assert first["b"]["page_number"] == 2
        assert first["score"] == pytest.approx(0.97)
        assert first["similarity"] == pytest.approx(0.88)
        assert {"id", "created_at"} <= set(first)

    async def test_get_filters_by_status_and_rejects_unknown(self, client: AsyncClient, world, test_db, page_collection):
        workspace, docs, users = world
        test_db.add_all([_contradiction(workspace, docs, "a"), _contradiction(workspace, docs, "b", status="resolved")])
        await test_db.commit()
        owner = _headers(users["owner"])

        resp = await client.get(f"/api/workspaces/{workspace.id}/radar?status=resolved", headers=owner)
        assert [c["status"] for c in resp.json()["contradictions"]] == ["resolved"]
        assert resp.json()["counts"] == {"open": 1, "dismissed": 0, "resolved": 1}
        assert resp.json()["latest_scan"] is None

        bad = await client.get(f"/api/workspaces/{workspace.id}/radar?status=bogus", headers=owner)
        assert bad.status_code == 422

    async def test_get_survives_chroma_lookup_failure(self, client: AsyncClient, world, test_db, monkeypatch):
        workspace, docs, users = world
        test_db.add(_contradiction(workspace, docs, "a"))
        await test_db.commit()

        def boom(_wid):
            raise RuntimeError("chroma down")

        monkeypatch.setattr("app.api.radar.get_workspace_collection", boom)
        resp = await client.get(f"/api/workspaces/{workspace.id}/radar", headers=_headers(users["owner"]))

        assert resp.status_code == 200
        assert resp.json()["contradictions"][0]["a"]["page_number"] is None

    async def test_patch_updates_status_resolver_and_audits(self, client: AsyncClient, world, test_db, page_collection):
        workspace, docs, users = world
        row = _contradiction(workspace, docs, "k1")
        test_db.add(row)
        await test_db.commit()
        owner = _headers(users["owner"])
        url = f"/api/workspaces/{workspace.id}/radar/contradictions/{row.id}"

        resp = await client.patch(url, json={"status": "resolved"}, headers=owner)

        assert resp.status_code == 200
        assert resp.json()["status"] == "resolved"
        assert resp.json()["a"]["document_name"] == "annual-report.pdf"
        await test_db.refresh(row)
        assert row.status == "resolved"
        assert row.resolved_by == users["owner"].id
        audit = (await test_db.execute(select(AuditLog).where(AuditLog.action == "radar.update"))).scalar_one()
        assert json.loads(audit.details) == {"workspace_id": workspace.id, "from": "open", "to": "resolved"}

        reopened = await client.patch(url, json={"status": "open"}, headers=owner)
        assert reopened.json()["status"] == "open"
        await test_db.refresh(row)
        assert row.resolved_by is None

        assert (await client.patch(url, json={"status": "maybe"}, headers=owner)).status_code == 422

    async def test_patch_404_for_other_workspace(self, client: AsyncClient, world, test_db, page_collection):
        workspace, docs, users = world
        other = Workspace(name="Other", owner_id=users["owner"].id)
        test_db.add(other)
        await test_db.commit()
        row = _contradiction(workspace, docs, "k1")
        test_db.add(row)
        await test_db.commit()

        resp = await client.patch(
            f"/api/workspaces/{other.id}/radar/contradictions/{row.id}",
            json={"status": "dismissed"}, headers=_headers(users["owner"]),
        )

        assert resp.status_code == 404


@pytest.mark.asyncio
class TestPostIngestHook:
    async def _ingest(self, monkeypatch, doc: Document, workspace_id: str, result: dict):
        from app.api.documents import process_document_background

        async def fake_pipeline(**_kwargs):
            return {"error": None, "quarantined": [], **result}

        monkeypatch.setattr("app.graph.ingestion_graph.run_ingestion_pipeline", fake_pipeline)
        await process_document_background(
            document_id=doc.id, workspace_id=workspace_id, file_path=Path("/tmp/x.txt"),
            mime_type="text/plain", original_filename="x.txt",
        )

    async def test_successful_ingest_requests_scoped_auto_scan(self, world, monkeypatch):
        workspace, docs, _users = world
        monkeypatch.setattr(settings, "RADAR_AUTO_SCAN", True)
        requested = AsyncMock(return_value="scan-1")
        monkeypatch.setattr("app.radar.scan.request_auto_scan", requested)

        await self._ingest(monkeypatch, docs[0], workspace.id, {"status": "success", "chunk_count": 3})

        requested.assert_awaited_once_with(workspace.id, [docs[0].id])

    @pytest.mark.parametrize(
        ("auto", "result"),
        [
            (True, {"status": "failed", "chunk_count": 0, "error": "boom"}),
            (True, {"status": "success", "chunk_count": 0}),
            (False, {"status": "success", "chunk_count": 3}),
        ],
        ids=["failed-ingest", "no-chunks", "auto-scan-off"],
    )
    async def test_hook_does_not_fire(self, world, monkeypatch, auto, result):
        workspace, docs, _users = world
        monkeypatch.setattr(settings, "RADAR_AUTO_SCAN", auto)
        requested = AsyncMock()
        monkeypatch.setattr("app.radar.scan.request_auto_scan", requested)

        await self._ingest(monkeypatch, docs[0], workspace.id, result)

        requested.assert_not_awaited()

    async def test_hook_failure_never_breaks_ingestion(self, world, monkeypatch, test_db):
        workspace, docs, _users = world
        monkeypatch.setattr(settings, "RADAR_AUTO_SCAN", True)
        monkeypatch.setattr("app.radar.scan.request_auto_scan", AsyncMock(side_effect=RuntimeError("radar down")))

        await self._ingest(monkeypatch, docs[0], workspace.id, {"status": "success", "chunk_count": 2})

        await test_db.refresh(docs[0])
        assert docs[0].status == "ready"
        assert docs[0].chunk_count == 2


@pytest.mark.asyncio
class TestDocumentDeleteCleansContradictions:
    async def test_single_delete(self, client: AsyncClient, world, test_db):
        import sys
        import types

        workspace, docs, users = world
        test_db.add(_contradiction(workspace, docs, "k1"))
        await test_db.commit()

        fake_indexer = types.ModuleType("app.ingestion.indexer")
        fake_indexer.delete_document = AsyncMock()
        with patch.dict(sys.modules, {"app.ingestion.indexer": fake_indexer}):
            resp = await client.delete(
                f"/api/workspaces/{workspace.id}/documents/{docs[1].id}", headers=_headers(users["owner"]),
            )

        assert resp.status_code == 204
        assert (await test_db.execute(select(Contradiction))).scalars().all() == []

    async def test_bulk_delete(self, client: AsyncClient, world, test_db, admin_headers):
        workspace, docs, _users = world
        test_db.add(_contradiction(workspace, docs, "k1"))
        await test_db.commit()

        async def fake_delete_documents(workspace_id, document_ids):
            return dict.fromkeys(document_ids)

        with patch("app.ingestion.indexer.delete_documents", side_effect=fake_delete_documents):
            resp = await client.post(
                "/api/admin/documents/bulk", json={"action": "delete", "document_ids": [docs[0].id]},
                headers=admin_headers,
            )

        assert resp.status_code == 200
        assert (await test_db.execute(select(Contradiction))).scalars().all() == []


# ─── WS `sources` frames carry `conflicts` ────────────────────────────


@pytest.fixture
def ws_factory(monkeypatch, test_engine):
    from sqlalchemy.ext.asyncio import AsyncSession as _AsyncSession, async_sessionmaker

    from app.api import ws as ws_api

    factory = async_sessionmaker(test_engine, class_=_AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(ws_api, "async_session_factory", factory)
    return factory


def _sink(frames: list[dict]):
    from app.api.stream_registry import StreamBuffer, StreamSink

    async def send(message: dict) -> None:
        frames.append(message)

    return StreamSink(StreamBuffer(query_id="q-1", user_id="u-1", workspace_id="ws-1"), send)


@pytest.mark.asyncio
class TestWsConflicts:
    async def test_live_sources_frame_counts_open_conflicts(self, world, test_db, ws_factory, monkeypatch):
        from types import SimpleNamespace

        from app.api import ws as ws_api

        workspace, docs, _users = world
        test_db.add_all([
            _contradiction(workspace, docs, "k1", chunk_a="chunk-1", chunk_b="chunk-9"),
            _contradiction(workspace, docs, "k2", chunk_a="chunk-8", chunk_b="chunk-1"),
            _contradiction(workspace, docs, "k3", status="dismissed", chunk_a="chunk-2", chunk_b="chunk-9"),
        ])
        await test_db.commit()

        hits = [
            SimpleNamespace(chunk_id=cid, document_id=docs[0].id, content="text", score=0.9, final_score=0.9,
                            rerank_score=0.9, metadata={"document_name": "Doc"})
            for cid in ("chunk-1", "chunk-2")
        ]

        async def fake_rewrite(query):
            return query

        async def fake_search(*_a, **_k):
            return hits

        async def fake_rerank(*_a, **_k):
            return hits

        async def stop(*_a, **_k):
            raise RuntimeError("stop after sources")

        async def none(*_a, **_k):
            return None

        async def zero(*_a, **_k):
            return 0

        monkeypatch.setattr("app.retrieval.query_rewrite.rewrite", fake_rewrite)
        monkeypatch.setattr("app.retrieval.hybrid_search.hybrid_search", fake_search)
        monkeypatch.setattr("app.retrieval.reranker.rerank", fake_rerank)
        monkeypatch.setattr("app.generation.streamer.stream_tokens", stop)
        monkeypatch.setattr(ws_api, "lookup_cached_query", none)
        monkeypatch.setattr(ws_api, "get_workspace_document_version", zero)
        monkeypatch.setattr(ws_api, "_save_query", none)

        frames: list[dict] = []
        await ws_api._run_query_pipeline(
            query_text="What was revenue?", workspace_id=workspace.id, user_id=None,
            query_id="q-1", top_k=5, filters=None, sink=_sink(frames),
        )

        sources = next(f for f in frames if f["type"] == "sources")["payload"]["sources"]
        assert {s["chunk_id"]: s["conflicts"] for s in sources} == {"chunk-1": 2, "chunk-2": 0}

    async def test_cached_sources_frame_counts_open_conflicts(self, world, test_db, ws_factory):
        from types import SimpleNamespace

        from app.api import ws as ws_api

        workspace, docs, _users = world
        test_db.add(_contradiction(workspace, docs, "k1", chunk_a="chunk-1"))
        await test_db.commit()
        query = SimpleNamespace(
            id="q-1", response_text="answer", guardrail_score=None, guardrail_passed=None, trust_score=None,
            model_used="m", token_count=1, prompt_version=None, edge_case=None, sufficiency=None,
            response_sources=json.dumps([
                {"chunk_id": "chunk-1", "document_id": docs[0].id, "content": "x", "score": 0.9},
                {"chunk_id": "chunk-7", "document_id": docs[0].id, "content": "y", "score": 0.8},
            ]),
        )

        frames: list[dict] = []
        await ws_api._send_cached_query(query, _sink(frames), 5)

        sources = next(f for f in frames if f["type"] == "sources")["payload"]["sources"]
        assert [s["conflicts"] for s in sources] == [1, 0]

    async def test_conflict_lookup_failure_degrades_to_zero(self, ws_factory, monkeypatch):
        from app.api import ws as ws_api

        async def boom(*_a, **_k):
            raise RuntimeError("db gone")

        monkeypatch.setattr(ws_api, "conflict_counts", boom)

        assert await ws_api._source_conflicts(["chunk-1"]) == {}
