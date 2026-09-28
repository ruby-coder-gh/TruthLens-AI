"""Investigation background-job API: start (202), progress polling, failure, authz (BUG-10).

The graph itself is always mocked here — no LLM/Ollama calls, no retrieval.
`test_graph/test_investigation_decompose_and_progress.py` covers the graph
node progress reporting; `test_audit_bundle_api.py` covers the export route.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.auth import create_access_token
from app.graph import investigation_progress
from app.models.investigation import Investigation
from app.models.user import User


@pytest.fixture(autouse=True)
def _point_app_db_at_test_engine(monkeypatch, test_engine):
    """`_run_investigation_background` opens its own session via
    `app.database.async_session_factory` (imported fresh inside the
    function) — point that at the test engine so persisted rows are visible
    through `test_db` (same pattern as `test_quarantine_api.py`)."""
    import app.database as db_module

    test_session_factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(db_module, "engine", test_engine)
    monkeypatch.setattr(db_module, "async_session_factory", test_session_factory)
    yield


@pytest.fixture(autouse=True)
def _clear_progress_registry():
    yield
    investigation_progress._registry.clear()  # noqa: SLF001 — test cleanup


async def _make_workspace(client: AsyncClient, headers: dict[str, str]) -> str:
    resp = await client.post("/api/workspaces", json={"name": "Investigation WS"}, headers=headers)
    return resp.json()["id"]


def _canned_result(**overrides) -> dict:
    result = {
        "final_report": "# Report\n\nFindings here.",
        "sub_questions": [{"id": "sq-1", "question": "What?", "purpose": "P", "citations": []}],
        "reasoning_trace": [{"phase": "decompose", "title": "T", "description": "D"}],
        "trust_components": {"faithfulness": 0.8},
        "trust_score": 0.8,
        "latency_ms": 1234,
        "error": None,
    }
    result.update(overrides)
    return result


class TestInvestigateStarts202:
    @pytest.mark.asyncio
    async def test_returns_202_with_running_row_and_progress_entry(
        self, client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession
    ):
        workspace_id = await _make_workspace(client, auth_headers)

        with patch("app.api.investigations._run_investigation_background", new=AsyncMock()):
            response = await client.post(
                f"/api/workspaces/{workspace_id}/investigate",
                json={"query": "What are the key risks?"},
                headers=auth_headers,
            )

        assert response.status_code == 202
        body = response.json()
        assert body["status"] == "running"
        assert body["workspace_id"] == workspace_id
        investigation_id = body["id"]

        case = await test_db.get(Investigation, investigation_id)
        assert case is not None
        assert case.query_text == "What are the key risks?"
        assert case.final_report == ""
        assert case.review_status == "draft"

        snapshot = investigation_progress.get(investigation_id)
        assert snapshot is not None
        assert snapshot["status"] == "running"
        assert snapshot["step"] == "decompose"

    @pytest.mark.asyncio
    async def test_outsider_cannot_start_an_investigation(
        self, client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession
    ):
        workspace_id = await _make_workspace(client, auth_headers)
        outsider = User(email="inv-out@example.com", username="invout", password_hash="hash", is_active=True)
        test_db.add(outsider)
        await test_db.commit()
        outsider_headers = {"Authorization": f"Bearer {create_access_token(outsider.id, outsider.role)}"}

        with patch("app.api.investigations._run_investigation_background", new=AsyncMock()):
            response = await client.post(
                f"/api/workspaces/{workspace_id}/investigate",
                json={"query": "Anything?"},
                headers=outsider_headers,
            )
        assert response.status_code == 403


class TestProgressTransitions:
    @pytest.mark.asyncio
    async def test_progress_reports_running_before_background_task_finishes(
        self, client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession
    ):
        workspace_id = await _make_workspace(client, auth_headers)
        with patch("app.api.investigations._run_investigation_background", new=AsyncMock()):
            start = await client.post(
                f"/api/workspaces/{workspace_id}/investigate",
                json={"query": "What are the key risks?"},
                headers=auth_headers,
            )
        investigation_id = start.json()["id"]

        response = await client.get(
            f"/api/workspaces/{workspace_id}/investigations/{investigation_id}/progress",
            headers=auth_headers,
        )
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "running"
        assert body["report"] is None

    @pytest.mark.asyncio
    async def test_progress_reports_done_with_full_report_after_background_completes(
        self, client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession
    ):
        from app.api.investigations import _run_investigation_background

        workspace_id = await _make_workspace(client, auth_headers)
        with patch("app.api.investigations._run_investigation_background", new=AsyncMock()):
            start = await client.post(
                f"/api/workspaces/{workspace_id}/investigate",
                json={"query": "What are the key risks?", "top_k": 5},
                headers=auth_headers,
            )
        investigation_id = start.json()["id"]

        with patch("app.graph.investigation.run_investigation", return_value=_canned_result()):
            await _run_investigation_background(
                investigation_id=investigation_id,
                workspace_id=workspace_id,
                user_id=None,
                query="What are the key risks?",
                top_k=5,
                filters=None,
            )

        response = await client.get(
            f"/api/workspaces/{workspace_id}/investigations/{investigation_id}/progress",
            headers=auth_headers,
        )
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "done"
        assert body["error"] is None
        assert body["report"]["final_report"] == "# Report\n\nFindings here."
        assert body["report"]["trust_score"] == 0.8

        case = await test_db.get(Investigation, investigation_id)
        await test_db.refresh(case)
        assert case.final_report == "# Report\n\nFindings here."
        assert case.review_status == "draft"

    @pytest.mark.asyncio
    async def test_progress_reports_failed_with_error_message(
        self, client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession
    ):
        from app.api.investigations import _run_investigation_background

        workspace_id = await _make_workspace(client, auth_headers)
        with patch("app.api.investigations._run_investigation_background", new=AsyncMock()):
            start = await client.post(
                f"/api/workspaces/{workspace_id}/investigate",
                json={"query": "What are the key risks?"},
                headers=auth_headers,
            )
        investigation_id = start.json()["id"]

        failed_result = _canned_result(error="Ollama timed out", trust_score=0.0)
        with patch("app.graph.investigation.run_investigation", return_value=failed_result):
            await _run_investigation_background(
                investigation_id=investigation_id,
                workspace_id=workspace_id,
                user_id=None,
                query="What are the key risks?",
                top_k=10,
                filters=None,
            )

        response = await client.get(
            f"/api/workspaces/{workspace_id}/investigations/{investigation_id}/progress",
            headers=auth_headers,
        )
        body = response.json()
        assert body["status"] == "failed"
        assert body["error"] == "Ollama timed out"

        case = await test_db.get(Investigation, investigation_id)
        await test_db.refresh(case)
        assert case.review_status == "needs_changes"

    @pytest.mark.asyncio
    async def test_background_crash_still_finishes_progress_as_failed(
        self, client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession
    ):
        """An unexpected exception (not the graph's own caught-and-returned
        error) must still close out the progress entry — otherwise the
        frontend polls forever."""
        from app.api.investigations import _run_investigation_background

        workspace_id = await _make_workspace(client, auth_headers)
        with patch("app.api.investigations._run_investigation_background", new=AsyncMock()):
            start = await client.post(
                f"/api/workspaces/{workspace_id}/investigate",
                json={"query": "What are the key risks?"},
                headers=auth_headers,
            )
        investigation_id = start.json()["id"]

        with patch("app.graph.investigation.run_investigation", side_effect=RuntimeError("boom")):
            await _run_investigation_background(
                investigation_id=investigation_id,
                workspace_id=workspace_id,
                user_id=None,
                query="What are the key risks?",
                top_k=10,
                filters=None,
            )

        response = await client.get(
            f"/api/workspaces/{workspace_id}/investigations/{investigation_id}/progress",
            headers=auth_headers,
        )
        body = response.json()
        assert body["status"] == "failed"
        assert "boom" in body["error"]


class TestProgressAuthzAndFallback:
    @pytest.mark.asyncio
    async def test_outsider_cannot_poll_progress(
        self, client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession
    ):
        workspace_id = await _make_workspace(client, auth_headers)
        with patch("app.api.investigations._run_investigation_background", new=AsyncMock()):
            start = await client.post(
                f"/api/workspaces/{workspace_id}/investigate",
                json={"query": "What are the key risks?"},
                headers=auth_headers,
            )
        investigation_id = start.json()["id"]

        outsider = User(email="prog-out@example.com", username="progout", password_hash="hash", is_active=True)
        test_db.add(outsider)
        await test_db.commit()
        outsider_headers = {"Authorization": f"Bearer {create_access_token(outsider.id, outsider.role)}"}

        response = await client.get(
            f"/api/workspaces/{workspace_id}/investigations/{investigation_id}/progress",
            headers=outsider_headers,
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_unknown_investigation_id_is_404(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ):
        workspace_id = await _make_workspace(client, auth_headers)
        response = await client.get(
            f"/api/workspaces/{workspace_id}/investigations/does-not-exist/progress",
            headers=auth_headers,
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_registry_miss_falls_back_to_persisted_row(
        self, client: AsyncClient, auth_headers: dict[str, str], test_db: AsyncSession
    ):
        """Simulates a process restart: the in-memory registry has nothing,
        but a finished row is on disk — the endpoint should still report it
        as done rather than polling forever."""
        workspace_id = await _make_workspace(client, auth_headers)
        case = Investigation(
            workspace_id=workspace_id,
            query_text="What happened?",
            final_report="Already finished before restart.",
            review_status="draft",
            trust_score=0.6,
            latency_ms=999,
        )
        test_db.add(case)
        await test_db.commit()
        await test_db.refresh(case)

        response = await client.get(
            f"/api/workspaces/{workspace_id}/investigations/{case.id}/progress",
            headers=auth_headers,
        )
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "done"
        assert body["report"]["final_report"] == "Already finished before restart."
