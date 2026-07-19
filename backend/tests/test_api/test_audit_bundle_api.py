"""Investigation audit-bundle ZIP and authorization coverage."""

from __future__ import annotations

import io
import json
import zipfile

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth import create_access_token
from app.models.audit_log import AuditLog
from app.models.chunk import Chunk
from app.models.document import Document
from app.models.investigation import Investigation
from app.models.user import User


async def _seed_case(client: AsyncClient, headers: dict[str, str], test_db: AsyncSession, tmp_path) -> tuple[str, Investigation]:
    workspace_response = await client.post("/api/workspaces", json={"name": "Audit export workspace"}, headers=headers)
    workspace_id = workspace_response.json()["id"]
    document = Document(
        workspace_id=workspace_id,
        filename="evidence.txt",
        original_filename="evidence.txt",
        mime_type="text/plain",
        file_size=14,
        status="ready",
    )
    test_db.add(document)
    await test_db.flush()
    chunk = Chunk(document_id=document.id, index=0, content="Evidence passage", token_count=2)
    test_db.add(chunk)
    await test_db.flush()
    case = Investigation(
        workspace_id=workspace_id,
        query_text="What happened?",
        final_report="The evidence supports the conclusion.",
        reasoning_trace=[{"phase": "retrieve", "title": "Retrieved", "description": "Found evidence"}],
        sub_questions=[{"id": "sub-1", "question": "What evidence?", "citations": [{"chunk_id": chunk.id, "text": "Evidence passage"}]}],
        trust_components={"faithfulness": 0.8},
        trust_score=0.8,
        review_status="approved",
        review_note="Approved for handoff",
    )
    test_db.add(case)
    await test_db.commit()
    await test_db.refresh(case)
    (tmp_path / document.filename).write_text("Evidence passage")
    return workspace_id, case


@pytest.mark.asyncio
async def test_audit_bundle_contains_markdown_json_sources_and_export_log(
    client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession, tmp_path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    workspace_id, case = await _seed_case(client, auth_headers, test_db, tmp_path)
    test_db.add(AuditLog(
        action="investigation.review_update",
        resource_type="investigation",
        resource_id=case.id,
        details=json.dumps({"from": "in_review", "to": "approved", "has_note": True}),
    ))
    await test_db.commit()
    response = await client.get(f"/api/workspaces/{workspace_id}/investigations/{case.id}/export", headers=auth_headers)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/zip")

    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = set(archive.namelist())
        assert {"summary.md", "audit-data.json"}.issubset(names)
        assert any(name.startswith("source-documents/") for name in names)
        assert "What happened?" in archive.read("summary.md").decode()
        raw = json.loads(archive.read("audit-data.json"))
        assert raw["reasoning_trace"]
        assert raw["investigation"]["review_status"] == "approved"
        assert raw["evidence"][0]["chunk_id"]
        assert raw["audit_events"][0]["action"] == "investigation.review_update"

    audit = (await test_db.execute(
        select(AuditLog).where(AuditLog.action == "investigation.audit_export", AuditLog.resource_id == case.id)
    )).scalar_one()
    assert json.loads(audit.details or "{}")["source_documents_included"] is True


@pytest.mark.asyncio
async def test_audit_bundle_uses_reference_fallback_and_enforces_access(
    client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession, tmp_path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "SERVER_MAX_UPLOAD_SIZE", 1)
    workspace_id, case = await _seed_case(client, auth_headers, test_db, tmp_path)
    response = await client.get(f"/api/workspaces/{workspace_id}/investigations/{case.id}/export", headers=auth_headers)
    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert "source-document-references.json" in archive.namelist()
        assert not any(name.startswith("source-documents/") for name in archive.namelist())

    outsider = User(email="audit-out@example.com", username="auditout", password_hash="hash", is_active=True)
    test_db.add(outsider)
    await test_db.commit()
    outsider_headers = {"Authorization": f"Bearer {create_access_token(outsider.id, outsider.role)}"}
    forbidden = await client.get(f"/api/workspaces/{workspace_id}/investigations/{case.id}/export", headers=outsider_headers)
    assert forbidden.status_code == 403
