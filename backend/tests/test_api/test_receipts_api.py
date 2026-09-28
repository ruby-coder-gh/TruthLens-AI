"""HTTP tests for Truth Receipt create/view/list/revoke (lane L3)."""

from __future__ import annotations

import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token, hash_password
from app.models.query import Query
from app.models.receipt import Receipt
from app.models.user import User
from app.models.workspace import WorkspaceMember


async def _make_user(test_db: AsyncSession, *, email: str, role: str = "user") -> User:
    user = User(email=email, username=email.split("@")[0], password_hash=hash_password("TestPass1"), role=role, is_active=True)
    test_db.add(user)
    await test_db.commit()
    await test_db.refresh(user)
    return user


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.id, user.role)}"}


@pytest.fixture
async def owner_and_query(client: AsyncClient, test_db: AsyncSession) -> tuple[User, str, str]:
    """Create an owner user, a workspace, and a finished (non-abstained) query."""
    owner = await _make_user(test_db, email="owner@example.com")
    ws_resp = await client.post("/api/workspaces", json={"name": "Receipt WS", "description": ""}, headers=_headers(owner))
    ws_id = ws_resp.json()["id"]

    query = Query(
        workspace_id=ws_id,
        user_id=owner.id,
        query_text="What powers the turbines?",
        response_text="Wind powers the turbines [source:1].",
        response_sources=json.dumps(
            [{"chunk_id": "c1", "document_id": "d1", "document_name": "spec.pdf", "content": "Wind turbines generate power from wind.", "page_number": 2}]
        ),
        trust_score=0.9,
        trust_components={"retrieval": 0.9},
        guardrail_score=0.95,
        guardrail_passed=True,
        model_used="qwen3:4b",
        prompt_version="v1",
    )
    test_db.add(query)
    await test_db.commit()
    await test_db.refresh(query)
    return owner, ws_id, query.id


# ── Create ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_receipt_returns_token_and_seal(client: AsyncClient, owner_and_query):
    owner, ws_id, q_id = owner_and_query
    resp = await client.post(f"/api/queries/{q_id}/receipts", headers=_headers(owner))
    assert resp.status_code == 201
    body = resp.json()
    assert body["url_path"] == f"/r/{body['token']}"
    assert len(body["seal"]) == 64
    assert "created_at" in body


@pytest.mark.asyncio
async def test_create_receipt_requires_auth(client: AsyncClient, owner_and_query):
    _, _, q_id = owner_and_query
    resp = await client.post(f"/api/queries/{q_id}/receipts")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_create_receipt_other_user_gets_404_not_403(client: AsyncClient, test_db: AsyncSession, owner_and_query):
    """No-access user gets 404 (does not leak that the query exists)."""
    _, _, q_id = owner_and_query
    outsider = await _make_user(test_db, email="outsider@example.com")
    resp = await client.post(f"/api/queries/{q_id}/receipts", headers=_headers(outsider))
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_create_receipt_viewer_member_is_forbidden(client: AsyncClient, test_db: AsyncSession, owner_and_query):
    """A viewer can read the query but must not be able to publish a public receipt of it."""
    _, ws_id, q_id = owner_and_query
    viewer = await _make_user(test_db, email="viewer@example.com")
    test_db.add(WorkspaceMember(workspace_id=ws_id, user_id=viewer.id, role="viewer"))
    await test_db.commit()

    resp = await client.post(f"/api/queries/{q_id}/receipts", headers=_headers(viewer))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_receipt_editor_member_is_allowed(client: AsyncClient, test_db: AsyncSession, owner_and_query):
    _, ws_id, q_id = owner_and_query
    editor = await _make_user(test_db, email="editor@example.com")
    test_db.add(WorkspaceMember(workspace_id=ws_id, user_id=editor.id, role="editor"))
    await test_db.commit()

    resp = await client.post(f"/api/queries/{q_id}/receipts", headers=_headers(editor))
    assert resp.status_code == 201


@pytest.mark.asyncio
async def test_create_receipt_unknown_query_404(client: AsyncClient, test_db: AsyncSession):
    user = await _make_user(test_db, email="lonely@example.com")
    resp = await client.post("/api/queries/does-not-exist/receipts", headers=_headers(user))
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_create_receipt_abstention_returns_422(client: AsyncClient, test_db: AsyncSession):
    owner = await _make_user(test_db, email="abstain-owner@example.com")
    ws_resp = await client.post("/api/workspaces", json={"name": "Abstain WS"}, headers=_headers(owner))
    ws_id = ws_resp.json()["id"]
    query = Query(
        workspace_id=ws_id,
        user_id=owner.id,
        query_text="Unanswerable question",
        response_text=None,
        edge_case="insufficient_evidence",
    )
    test_db.add(query)
    await test_db.commit()
    await test_db.refresh(query)

    resp = await client.post(f"/api/queries/{query.id}/receipts", headers=_headers(owner))
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_receipt_disabled_flag_returns_403(client: AsyncClient, owner_and_query, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "RECEIPTS_ENABLED", False)
    owner, _, q_id = owner_and_query
    resp = await client.post(f"/api/queries/{q_id}/receipts", headers=_headers(owner))
    assert resp.status_code == 403


# ── Public view ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_public_view_no_cookies_no_auth_verifies(client: AsyncClient, owner_and_query):
    owner, _, q_id = owner_and_query
    create_resp = await client.post(f"/api/queries/{q_id}/receipts", headers=_headers(owner))
    token = create_resp.json()["token"]

    resp = await client.get(f"/api/receipts/{token}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["seal_valid"] is True
    assert body["signature_valid"] is True
    assert body["revoked"] is False
    assert body["payload"]["question"] == "What powers the turbines?"
    assert resp.headers["cache-control"] == "no-store"
    assert resp.headers["x-robots-tag"] == "noindex"


@pytest.mark.asyncio
async def test_public_view_increments_view_count(client: AsyncClient, test_db: AsyncSession, owner_and_query):
    owner, _, q_id = owner_and_query
    create_resp = await client.post(f"/api/queries/{q_id}/receipts", headers=_headers(owner))
    token = create_resp.json()["token"]

    await client.get(f"/api/receipts/{token}")
    await client.get(f"/api/receipts/{token}")

    list_resp = await client.get(f"/api/queries/{q_id}/receipts", headers=_headers(owner))
    assert list_resp.json()["data"][0]["view_count"] == 2


@pytest.mark.asyncio
async def test_public_view_unknown_token_404(client: AsyncClient):
    resp = await client.get("/api/receipts/does-not-exist")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_tampered_canonical_fails_seal_valid(client: AsyncClient, test_db: AsyncSession, owner_and_query):
    owner, _, q_id = owner_and_query
    create_resp = await client.post(f"/api/queries/{q_id}/receipts", headers=_headers(owner))
    token = create_resp.json()["token"]

    receipt = (await test_db.execute(select(Receipt).where(Receipt.token == token))).scalar_one()
    receipt.canonical = receipt.canonical.replace("turbines", "TAMPERED")
    await test_db.commit()

    resp = await client.get(f"/api/receipts/{token}")
    assert resp.status_code == 200
    assert resp.json()["seal_valid"] is False


@pytest.mark.asyncio
async def test_tampered_seal_fails_signature_valid(client: AsyncClient, test_db: AsyncSession, owner_and_query):
    owner, _, q_id = owner_and_query
    create_resp = await client.post(f"/api/queries/{q_id}/receipts", headers=_headers(owner))
    token = create_resp.json()["token"]

    receipt = (await test_db.execute(select(Receipt).where(Receipt.token == token))).scalar_one()
    receipt.seal = "0" * 64
    await test_db.commit()

    resp = await client.get(f"/api/receipts/{token}")
    assert resp.status_code == 200
    assert resp.json()["signature_valid"] is False


# ── Revoke ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_creator_can_revoke_and_then_public_view_returns_410(client: AsyncClient, owner_and_query):
    owner, _, q_id = owner_and_query
    create_resp = await client.post(f"/api/queries/{q_id}/receipts", headers=_headers(owner))
    token = create_resp.json()["token"]

    del_resp = await client.delete(f"/api/receipts/{token}", headers=_headers(owner))
    assert del_resp.status_code == 204

    view_resp = await client.get(f"/api/receipts/{token}")
    assert view_resp.status_code == 410


@pytest.mark.asyncio
async def test_workspace_owner_can_revoke_receipt_created_by_an_editor(client: AsyncClient, test_db: AsyncSession, owner_and_query):
    owner, ws_id, q_id = owner_and_query
    editor = await _make_user(test_db, email="editor2@example.com")
    test_db.add(WorkspaceMember(workspace_id=ws_id, user_id=editor.id, role="editor"))
    await test_db.commit()

    create_resp = await client.post(f"/api/queries/{q_id}/receipts", headers=_headers(editor))
    token = create_resp.json()["token"]

    del_resp = await client.delete(f"/api/receipts/{token}", headers=_headers(owner))
    assert del_resp.status_code == 204


@pytest.mark.asyncio
async def test_editor_can_revoke_receipt_they_did_not_create(client: AsyncClient, test_db: AsyncSession, owner_and_query):
    """A workspace editor who didn't seal the receipt can still revoke it — not just the owner/admin/creator."""
    owner, ws_id, q_id = owner_and_query
    editor = await _make_user(test_db, email="editor3@example.com")
    test_db.add(WorkspaceMember(workspace_id=ws_id, user_id=editor.id, role="editor"))
    await test_db.commit()

    create_resp = await client.post(f"/api/queries/{q_id}/receipts", headers=_headers(owner))
    token = create_resp.json()["token"]

    del_resp = await client.delete(f"/api/receipts/{token}", headers=_headers(editor))
    assert del_resp.status_code == 204


@pytest.mark.asyncio
async def test_admin_can_revoke_any_receipt(client: AsyncClient, test_db: AsyncSession, owner_and_query):
    owner, _, q_id = owner_and_query
    admin = await _make_user(test_db, email="admin2@example.com", role="admin")
    create_resp = await client.post(f"/api/queries/{q_id}/receipts", headers=_headers(owner))
    token = create_resp.json()["token"]

    del_resp = await client.delete(f"/api/receipts/{token}", headers=_headers(admin))
    assert del_resp.status_code == 204


@pytest.mark.asyncio
async def test_non_creator_non_owner_non_admin_cannot_revoke(client: AsyncClient, test_db: AsyncSession, owner_and_query):
    owner, ws_id, q_id = owner_and_query
    other_member = await _make_user(test_db, email="othermember@example.com")
    test_db.add(WorkspaceMember(workspace_id=ws_id, user_id=other_member.id, role="viewer"))
    await test_db.commit()

    create_resp = await client.post(f"/api/queries/{q_id}/receipts", headers=_headers(owner))
    token = create_resp.json()["token"]

    del_resp = await client.delete(f"/api/receipts/{token}", headers=_headers(other_member))
    assert del_resp.status_code == 403


@pytest.mark.asyncio
async def test_revoke_unknown_token_404(client: AsyncClient, test_db: AsyncSession):
    user = await _make_user(test_db, email="revoke-lonely@example.com")
    resp = await client.delete("/api/receipts/does-not-exist", headers=_headers(user))
    assert resp.status_code == 404


# ── List ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_receipts_for_query(client: AsyncClient, owner_and_query):
    owner, _, q_id = owner_and_query
    await client.post(f"/api/queries/{q_id}/receipts", headers=_headers(owner))
    await client.post(f"/api/queries/{q_id}/receipts", headers=_headers(owner))

    resp = await client.get(f"/api/queries/{q_id}/receipts", headers=_headers(owner))
    assert resp.status_code == 200
    assert len(resp.json()["data"]) == 2
