"""Admin prompt-version API: draft → eval → gated promotion → rollback.

The whole point of F1 is that a prompt cannot go live without clearing the
`EVAL_MIN_*` floors, so most of this file drives the gate: a failing run must
block promotion (409 with the failed metrics), a passing run must stage it, and
promotion must retire the previous active version and refresh the registry.

The golden-set run is exercised for real — only `generate` / `guardrail` /
`trust` are monkeypatched (the pattern from `test_eval_run_writepath.py`), so
no Ollama and no `ragas` package are needed.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.generation.generator import DEFAULT_SYSTEM_PROMPT, GenerationResult
from app.generation.guardrail import GuardrailResult
from app.models.audit_log import AuditLog
from app.models.eval_run import EvalRun
from app.models.prompt_version import PromptVersion
from app.prompts import registry

PROMPTS = "/api/admin/prompts"


@pytest.fixture(autouse=True)
def _point_app_db_at_test_engine(monkeypatch, test_engine):
    """The background eval job opens its own session — point it at the test DB."""
    from sqlalchemy.ext.asyncio import AsyncSession as _AsyncSession
    from sqlalchemy.ext.asyncio import async_sessionmaker

    import app.database as db_module

    factory = async_sessionmaker(test_engine, class_=_AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(db_module, "engine", test_engine)
    monkeypatch.setattr(db_module, "async_session_factory", factory)
    yield


def _grounded_generate():
    """Echo the reference context back — a fully supported answer."""

    async def _generate(gen_input):
        ctx = gen_input.contexts[0]["content"] if gen_input.contexts else ""
        return GenerationResult(text=ctx, token_count=len(ctx.split()), model_used="mock")

    return _generate


def _ungrounded_generate():
    """Always assert something unsupported — fails faithfulness and trust."""

    async def _generate(gen_input):
        return GenerationResult(
            text="Absolutely, the answer is definitely forty two in every case.",
            token_count=11,
            model_used="mock",
        )

    return _generate


def _guardrail():
    async def _check(answer, contexts):
        premise = " ".join(c.get("content", "") for c in contexts).lower()
        ans = (answer or "").strip().lower()
        if ans and ans in premise:
            return GuardrailResult(passed=True, score=0.95, details="mock: supported")
        return GuardrailResult(passed=False, score=0.05, details="mock: unsupported")

    return _check


def _trust():
    class _Trust:
        def __init__(self, overall, relevance):
            self.overall = overall
            self.relevance = relevance

    async def _compute(retrieval_results=None, guardrail_result=None, generation_result=None, query=""):
        faith = getattr(guardrail_result, "score", 0.0) if guardrail_result else 0.0
        return _Trust(overall=round(min(1.0, 0.3 + 0.7 * faith), 4), relevance=0.8)

    return _Trust and _compute


def _install_pipeline(monkeypatch, generate_fn):
    monkeypatch.setattr("app.generation.generator.generate", generate_fn)
    monkeypatch.setattr("app.generation.guardrail.check", _guardrail())
    monkeypatch.setattr("app.evaluation.trust_score.compute_trust", _trust())


async def _create_draft(client, headers, content, **extra):
    payload = {"name": "answer", "content": content, **extra}
    resp = await client.post(PROMPTS, json=payload, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _evaluate(client, headers, prompt_id, subset="smoke"):
    """Queue an eval and then run the (normally detached) job inline."""
    from app.api import admin_prompts

    resp = await client.post(
        f"{PROMPTS}/{prompt_id}/evaluate?subset={subset}", headers=headers
    )
    assert resp.status_code == 202, resp.text
    body = resp.json()
    await admin_prompts._run_prompt_eval_background(prompt_id, body["eval_run_id"], subset)
    return body


class TestAuthorization:
    async def test_non_admin_cannot_list(self, client: AsyncClient, auth_headers):
        assert (await client.get(PROMPTS, headers=auth_headers)).status_code == 403

    async def test_anonymous_cannot_list(self, client: AsyncClient):
        assert (await client.get(PROMPTS)).status_code == 401

    async def test_non_admin_cannot_promote(self, client: AsyncClient, auth_headers, admin_headers):
        draft = await _create_draft(client, admin_headers, "Some prompt content.")
        resp = await client.post(f"{PROMPTS}/{draft['id']}/promote", headers=auth_headers)
        assert resp.status_code == 403


class TestCreateDraft:
    async def test_first_draft_is_version_one_with_a_content_hash(
        self, client: AsyncClient, admin_headers
    ):
        body = await _create_draft(client, admin_headers, "A brand new prompt.")

        assert body["name"] == "answer"
        assert body["version"] == 1
        assert body["status"] == "draft"
        assert body["content_hash"] == registry.compute_hash("A brand new prompt.")
        assert body["promoted_at"] is None
        assert body["eval"] is None

    async def test_identical_content_for_the_same_name_conflicts(
        self, client: AsyncClient, admin_headers
    ):
        await _create_draft(client, admin_headers, "Duplicated content.")

        resp = await client.post(
            PROMPTS, json={"name": "answer", "content": "Duplicated content."}, headers=admin_headers
        )

        assert resp.status_code == 409

    async def test_same_content_under_a_different_name_is_allowed(
        self, client: AsyncClient, admin_headers
    ):
        await _create_draft(client, admin_headers, "Shared content.")
        other = await _create_draft(client, admin_headers, "Shared content.", name="summary")

        assert other["name"] == "summary"
        assert other["version"] == 1

    async def test_versions_increment_per_name(self, client: AsyncClient, admin_headers):
        first = await _create_draft(client, admin_headers, "Draft one.")
        second = await _create_draft(client, admin_headers, "Draft two.")

        assert (first["version"], second["version"]) == (1, 2)

    async def test_empty_content_is_rejected(self, client: AsyncClient, admin_headers):
        resp = await client.post(PROMPTS, json={"content": "   "}, headers=admin_headers)
        assert resp.status_code == 422

    async def test_concurrent_creates_get_distinct_versions(
        self, client: AsyncClient, admin_headers
    ):
        """Version numbering is serialised, so no two drafts collide on (name, version)."""
        import asyncio as _asyncio

        results = await _asyncio.gather(
            client.post(PROMPTS, json={"content": "concurrent A"}, headers=admin_headers),
            client.post(PROMPTS, json={"content": "concurrent B"}, headers=admin_headers),
        )

        assert [r.status_code for r in results] == [201, 201]
        assert sorted(r.json()["version"] for r in results) == [1, 2]

    async def test_trailing_slash_form_also_works(self, client: AsyncClient, admin_headers):
        """The FE client may build either `/prompts` or `/prompts/`."""
        resp = await client.get(f"{PROMPTS}/", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["data"] == []

    async def test_created_by_records_the_admin(
        self, client: AsyncClient, admin_headers, test_db: AsyncSession
    ):
        body = await _create_draft(client, admin_headers, "Attributed prompt.")

        row = (
            await test_db.execute(select(PromptVersion).where(PromptVersion.id == body["id"]))
        ).scalar_one()
        assert row.created_by is not None


class TestListAndActive:
    async def test_list_filters_and_orders_by_version_desc(
        self, client: AsyncClient, admin_headers
    ):
        await _create_draft(client, admin_headers, "v1 content.")
        await _create_draft(client, admin_headers, "v2 content.")
        await _create_draft(client, admin_headers, "other content.", name="summary")

        resp = await client.get(f"{PROMPTS}?name=answer", headers=admin_headers)

        assert resp.status_code == 200
        rows = resp.json()["data"]
        assert [r["version"] for r in rows] == [2, 1]
        assert {r["name"] for r in rows} == {"answer"}

    async def test_list_filters_by_status(self, client: AsyncClient, admin_headers):
        await _create_draft(client, admin_headers, "still a draft.")

        assert len((await client.get(f"{PROMPTS}?status=draft", headers=admin_headers)).json()["data"]) == 1
        assert (await client.get(f"{PROMPTS}?status=active", headers=admin_headers)).json()["data"] == []

    async def test_active_falls_back_to_the_code_default(self, client: AsyncClient, admin_headers):
        resp = await client.get(f"{PROMPTS}/active?name=answer", headers=admin_headers)

        assert resp.status_code == 200
        body = resp.json()
        assert body["is_default"] is True
        assert body["content"] == DEFAULT_SYSTEM_PROMPT
        assert body["content_hash"] == registry.DEFAULT_PROMPT_HASH
        assert body["version_id"] is None

    async def test_detail_404_for_unknown_id(self, client: AsyncClient, admin_headers):
        assert (await client.get(f"{PROMPTS}/does-not-exist", headers=admin_headers)).status_code == 404


class TestDiff:
    async def test_diff_against_active_default(self, client: AsyncClient, admin_headers):
        draft = await _create_draft(client, admin_headers, "A totally different prompt body.")

        resp = await client.get(f"{PROMPTS}/{draft['id']}/diff?against=active", headers=admin_headers)

        assert resp.status_code == 200
        body = resp.json()
        assert body["to_id"] == draft["id"]
        assert "A totally different prompt body." in body["diff"]
        assert body["diff"].startswith("---")

    async def test_diff_against_another_version(self, client: AsyncClient, admin_headers):
        first = await _create_draft(client, admin_headers, "line one\nline two")
        second = await _create_draft(client, admin_headers, "line one\nline three")

        resp = await client.get(
            f"{PROMPTS}/{second['id']}/diff?against={first['id']}", headers=admin_headers
        )

        assert resp.status_code == 200
        diff = resp.json()["diff"]
        assert "-line two" in diff
        assert "+line three" in diff

    async def test_diff_against_unknown_id_is_404(self, client: AsyncClient, admin_headers):
        draft = await _create_draft(client, admin_headers, "content")
        resp = await client.get(f"{PROMPTS}/{draft['id']}/diff?against=nope", headers=admin_headers)
        assert resp.status_code == 404


class TestEvaluateQueue:
    async def test_returns_202_with_a_running_eval_run(
        self, client: AsyncClient, admin_headers, test_db: AsyncSession, monkeypatch
    ):
        async def _noop(*args, **kwargs):
            return None

        monkeypatch.setattr("app.api.admin_prompts._run_prompt_eval_background", _noop)
        draft = await _create_draft(client, admin_headers, "Prompt to evaluate.")

        resp = await client.post(f"{PROMPTS}/{draft['id']}/evaluate", headers=admin_headers)

        assert resp.status_code == 202
        body = resp.json()
        assert body["subset"] == "smoke"
        assert body["status"] == "running"

        run = (
            await test_db.execute(select(EvalRun).where(EvalRun.id == body["eval_run_id"]))
        ).scalar_one()
        assert run.status == "running"
        assert run.prompt_version_id == draft["id"]

    async def test_rejects_an_unknown_subset(self, client: AsyncClient, admin_headers):
        draft = await _create_draft(client, admin_headers, "Prompt.")
        resp = await client.post(
            f"{PROMPTS}/{draft['id']}/evaluate?subset=enormous", headers=admin_headers
        )
        assert resp.status_code == 400

    async def test_evaluate_unknown_prompt_is_404(self, client: AsyncClient, admin_headers):
        assert (
            await client.post(f"{PROMPTS}/nope/evaluate", headers=admin_headers)
        ).status_code == 404

    async def test_queued_run_is_committed_before_the_job_is_dispatched(
        self, client: AsyncClient, admin_headers, monkeypatch
    ):
        """The detached job opens its own session — the row must already be there."""
        from app.database import async_session_factory

        seen: dict[str, Any] = {}

        async def _probe(prompt_version_id, eval_run_id, subset):
            async with async_session_factory() as other_session:
                seen["found"] = (
                    await other_session.execute(
                        select(EvalRun).where(EvalRun.id == eval_run_id)
                    )
                ).scalar_one_or_none() is not None

        monkeypatch.setattr("app.api.admin_prompts._run_prompt_eval_background", _probe)
        draft = await _create_draft(client, admin_headers, "Prompt to evaluate.")

        resp = await client.post(f"{PROMPTS}/{draft['id']}/evaluate", headers=admin_headers)
        assert resp.status_code == 202

        # Let the fire-and-forget task actually run.
        import asyncio as _asyncio

        for _ in range(10):
            if "found" in seen:
                break
            await _asyncio.sleep(0)

        assert seen.get("found") is True, "background job could not see its own EvalRun row"


class TestEvalGatedPromotion:
    async def test_failing_eval_keeps_the_draft_and_blocks_promotion(
        self, client: AsyncClient, admin_headers, test_db: AsyncSession, monkeypatch
    ):
        _install_pipeline(monkeypatch, _ungrounded_generate())
        draft = await _create_draft(client, admin_headers, "A prompt that scores badly.")

        queued = await _evaluate(client, admin_headers, draft["id"])

        run = (
            await test_db.execute(select(EvalRun).where(EvalRun.id == queued["eval_run_id"]))
        ).scalar_one()
        assert run.status == "failed"

        detail = (await client.get(f"{PROMPTS}/{draft['id']}", headers=admin_headers)).json()
        assert detail["status"] == "draft"
        assert detail["eval"]["status"] == "failed"
        assert detail["eval"]["verdict"]["failed_metrics"]

        resp = await client.post(f"{PROMPTS}/{draft['id']}/promote", headers=admin_headers)

        assert resp.status_code == 409
        details = resp.json()["error"]["details"]
        assert details["detail"] == "eval_gate_failed"
        assert "faithfulness" in details["failed_metrics"]
        assert details["thresholds"]["min_faithfulness"] > 0
        assert "faithfulness" in details["scores"]

    async def test_promotion_without_any_eval_is_blocked(
        self, client: AsyncClient, admin_headers
    ):
        draft = await _create_draft(client, admin_headers, "Never evaluated.")

        resp = await client.post(f"{PROMPTS}/{draft['id']}/promote", headers=admin_headers)

        assert resp.status_code == 409
        assert resp.json()["error"]["details"]["reason"] == "no_eval_run"

    async def test_force_promote_bypasses_the_gate_and_is_audited(
        self, client: AsyncClient, admin_headers, test_db: AsyncSession, monkeypatch
    ):
        _install_pipeline(monkeypatch, _ungrounded_generate())
        draft = await _create_draft(client, admin_headers, "Forced through the gate.")
        await _evaluate(client, admin_headers, draft["id"])

        resp = await client.post(
            f"{PROMPTS}/{draft['id']}/promote?force=true", headers=admin_headers
        )

        assert resp.status_code == 200
        assert resp.json()["status"] == "active"
        assert resp.json()["promoted_at"] is not None

        audit = (
            await test_db.execute(
                select(AuditLog).where(
                    AuditLog.action == "prompt.promote", AuditLog.resource_id == draft["id"]
                )
            )
        ).scalar_one()
        details = json.loads(audit.details or "{}")
        assert details["force"] is True
        assert details["to_hash"] == registry.compute_hash("Forced through the gate.")
        assert details["from_hash"] == registry.DEFAULT_PROMPT_HASH
        assert "scores" in details

    async def test_passing_eval_stages_then_promotes_and_retires_the_previous(
        self, client: AsyncClient, admin_headers, test_db: AsyncSession, monkeypatch
    ):
        _install_pipeline(monkeypatch, _grounded_generate())

        first = await _create_draft(client, admin_headers, "First good prompt.")
        await _evaluate(client, admin_headers, first["id"])
        assert (
            await client.get(f"{PROMPTS}/{first['id']}", headers=admin_headers)
        ).json()["status"] == "staged"
        assert (
            await client.post(f"{PROMPTS}/{first['id']}/promote", headers=admin_headers)
        ).status_code == 200

        second = await _create_draft(client, admin_headers, "Second good prompt.")
        await _evaluate(client, admin_headers, second["id"])
        resp = await client.post(f"{PROMPTS}/{second['id']}/promote", headers=admin_headers)

        assert resp.status_code == 200
        assert resp.json()["status"] == "active"

        rows = {
            r.id: r.status
            for r in (await test_db.execute(select(PromptVersion))).scalars().all()
        }
        assert rows[first["id"]] == "retired"
        assert rows[second["id"]] == "active"

        # The registry now serves the newly promoted text.
        resolved = await registry.get_active(test_db, "answer")
        assert resolved.content == "Second good prompt."
        assert resolved.hash == registry.compute_hash("Second good prompt.")
        assert resolved.is_default is False

    async def test_a_still_running_eval_blocks_promotion(
        self, client: AsyncClient, admin_headers, monkeypatch
    ):
        async def _noop(*args, **kwargs):
            return None

        monkeypatch.setattr("app.api.admin_prompts._run_prompt_eval_background", _noop)
        draft = await _create_draft(client, admin_headers, "Mid-flight prompt.")
        await client.post(f"{PROMPTS}/{draft['id']}/evaluate", headers=admin_headers)

        resp = await client.post(f"{PROMPTS}/{draft['id']}/promote", headers=admin_headers)

        assert resp.status_code == 409
        assert resp.json()["error"]["details"]["reason"] == "eval_incomplete"

    async def test_a_failing_re_eval_demotes_a_staged_version(
        self, client: AsyncClient, admin_headers, monkeypatch
    ):
        """A staged version whose latest run fails must not still look promotable."""
        _install_pipeline(monkeypatch, _grounded_generate())
        draft = await _create_draft(client, admin_headers, "Was good, now bad.")
        await _evaluate(client, admin_headers, draft["id"])
        assert (
            await client.get(f"{PROMPTS}/{draft['id']}", headers=admin_headers)
        ).json()["status"] == "staged"

        _install_pipeline(monkeypatch, _ungrounded_generate())
        await _evaluate(client, admin_headers, draft["id"])

        assert (
            await client.get(f"{PROMPTS}/{draft['id']}", headers=admin_headers)
        ).json()["status"] == "draft"
        assert (
            await client.post(f"{PROMPTS}/{draft['id']}/promote", headers=admin_headers)
        ).status_code == 409

    async def test_promoting_an_already_active_version_conflicts(
        self, client: AsyncClient, admin_headers, monkeypatch
    ):
        _install_pipeline(monkeypatch, _grounded_generate())
        draft = await _create_draft(client, admin_headers, "Good prompt.")
        await _evaluate(client, admin_headers, draft["id"])
        await client.post(f"{PROMPTS}/{draft['id']}/promote", headers=admin_headers)

        resp = await client.post(f"{PROMPTS}/{draft['id']}/promote", headers=admin_headers)
        assert resp.status_code == 409


class TestRollback:
    async def test_rollback_reactivates_a_retired_version_and_audits(
        self, client: AsyncClient, admin_headers, test_db: AsyncSession, monkeypatch
    ):
        _install_pipeline(monkeypatch, _grounded_generate())

        first = await _create_draft(client, admin_headers, "Old reliable prompt.")
        await _evaluate(client, admin_headers, first["id"])
        await client.post(f"{PROMPTS}/{first['id']}/promote", headers=admin_headers)

        second = await _create_draft(client, admin_headers, "Shiny new prompt.")
        await _evaluate(client, admin_headers, second["id"])
        await client.post(f"{PROMPTS}/{second['id']}/promote", headers=admin_headers)

        resp = await client.post(f"{PROMPTS}/{first['id']}/rollback", headers=admin_headers)

        assert resp.status_code == 200
        assert resp.json()["status"] == "active"

        rows = {
            r.id: r.status
            for r in (await test_db.execute(select(PromptVersion))).scalars().all()
        }
        assert rows[first["id"]] == "active"
        assert rows[second["id"]] == "retired"

        assert (await registry.get_active(test_db, "answer")).content == "Old reliable prompt."

        audit = (
            await test_db.execute(
                select(AuditLog).where(
                    AuditLog.action == "prompt.rollback", AuditLog.resource_id == first["id"]
                )
            )
        ).scalar_one()
        assert json.loads(audit.details or "{}")["to_hash"] == registry.compute_hash(
            "Old reliable prompt."
        )

    async def test_cannot_roll_back_a_draft(self, client: AsyncClient, admin_headers):
        draft = await _create_draft(client, admin_headers, "Never promoted.")
        resp = await client.post(f"{PROMPTS}/{draft['id']}/rollback", headers=admin_headers)
        assert resp.status_code == 409


class TestDelete:
    async def test_deleting_a_draft_is_audited(
        self, client: AsyncClient, admin_headers, test_db: AsyncSession
    ):
        draft = await _create_draft(client, admin_headers, "Disposable draft.")

        resp = await client.delete(f"{PROMPTS}/{draft['id']}", headers=admin_headers)

        assert resp.status_code == 204
        assert (
            await test_db.execute(select(PromptVersion).where(PromptVersion.id == draft["id"]))
        ).scalar_one_or_none() is None

        audit = (
            await test_db.execute(
                select(AuditLog).where(
                    AuditLog.action == "prompt.delete", AuditLog.resource_id == draft["id"]
                )
            )
        ).scalar_one()
        assert json.loads(audit.details or "{}")["content_hash"] == registry.compute_hash(
            "Disposable draft."
        )

    async def test_cannot_delete_the_active_version(
        self, client: AsyncClient, admin_headers, monkeypatch
    ):
        _install_pipeline(monkeypatch, _grounded_generate())
        draft = await _create_draft(client, admin_headers, "Live prompt.")
        await _evaluate(client, admin_headers, draft["id"])
        await client.post(f"{PROMPTS}/{draft['id']}/promote", headers=admin_headers)

        resp = await client.delete(f"{PROMPTS}/{draft['id']}", headers=admin_headers)
        assert resp.status_code == 409


class TestEvalRunHistoryContract:
    async def test_history_exposes_the_new_gate_columns(
        self, client: AsyncClient, admin_headers, test_db: AsyncSession
    ):
        test_db.add(
            EvalRun(
                faithfulness=0.8,
                status="failed",
                prompt_version_id="pv-1",
                model_used="served:7b",
                subset="smoke",
                verdict=json.dumps({"passed": False, "failed_metrics": ["trust"], "thresholds": {}}),
            )
        )
        await test_db.commit()

        resp = await client.get("/api/admin/evaluation/history", headers=admin_headers)

        assert resp.status_code == 200
        entry = resp.json()["data"][0]
        assert entry["status"] == "failed"
        assert entry["prompt_version_id"] == "pv-1"
        assert entry["model_used"] == "served:7b"
        assert entry["subset"] == "smoke"
        assert json.loads(entry["verdict"])["failed_metrics"] == ["trust"]
