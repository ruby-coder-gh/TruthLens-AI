"""HTTP tests for /api/admin/stats — BUG-19: total_chunks must reflect the
real chunk count, not a hard-coded 0."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chunk import Chunk
from app.models.document import Document


@pytest.mark.asyncio
async def test_admin_stats_total_chunks_reflects_real_count(
    client: AsyncClient,
    admin_headers: dict[str, str],
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    ws_resp = await client.post("/api/workspaces", json={"name": "Stats WS"}, headers=auth_headers)
    workspace_id = ws_resp.json()["id"]

    doc = Document(
        workspace_id=workspace_id,
        filename="server-name.txt",
        original_filename="report.txt",
        mime_type="text/plain",
        file_size=100,
        status="ready",
    )
    test_db.add(doc)
    await test_db.commit()
    await test_db.refresh(doc)

    for i in range(3):
        test_db.add(Chunk(document_id=doc.id, index=i, content=f"chunk {i}", token_count=5))
    await test_db.commit()

    resp = await client.get("/api/admin/stats", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["total_chunks"] == 3
