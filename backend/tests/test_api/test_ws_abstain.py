"""WebSocket pipeline abstains on thin evidence instead of calling the model.

Drives `_run_query_pipeline` through a `StreamSink`, reusing the `Recorder` and
module-stub helpers from `tests/test_api/test_ws_resume.py` so the abstain path
is exercised on exactly the same harness as every other pipeline frame.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import settings
from app.models.query import Query
from app.models.user import User
from app.models.workspace import Workspace
from tests.test_api.test_ws_resume import Recorder, _install_module

# Index of the first frame the sufficiency gate emits: ack, progress(0.1),
# progress(0.3) precede it.
FIRST_ABSTAIN_FRAME = 3


def _hit(score: float, chunk_id: str = "chunk-1", document_id: str = "doc-1"):
    return SimpleNamespace(
        chunk_id=chunk_id,
        document_id=document_id,
        content="source content",
        score=score,
        final_score=score,
        rerank_score=score,
        metadata={"document_name": "Doc 1"},
    )


def _sink(recorder: Recorder, query_id: str = "query-1"):
    from app.api.stream_registry import StreamBuffer, StreamSink

    buffer = StreamBuffer(query_id=query_id, user_id="user-1", workspace_id="ws-1")
    return StreamSink(buffer, recorder)


@pytest_asyncio.fixture
async def pipeline(monkeypatch):
    """Wire every pipeline dependency to a fake and record what happened."""
    from app.api import ws as ws_api

    state: dict[str, object] = {"stream_called": False, "saved": None, "rerank_scores": [0.02, 0.01]}
    recorder = Recorder()
    sink = _sink(recorder)

    async def fake_rewrite(query: str) -> str:
        return query

    async def fake_hybrid_search(query: str, workspace_id: str, top_k: int, filters=None):
        return [_hit(0.5)]

    async def fake_rerank(query: str, results, top_k: int):
        scores = state["rerank_scores"]
        assert isinstance(scores, list)
        return [_hit(score, chunk_id=f"chunk-{i}") for i, score in enumerate(scores)]

    async def fake_stream_tokens(gen_input, query_id: str, token_sender):
        state["stream_called"] = True
        await token_sender({"type": "token", "payload": {"query_id": query_id, "token": "ok", "index": 0}})
        # 5-tuple since F1: (text, token_count, model_used, prompt_tokens, prompt_version).
        return "final answer", 1, "mock-model", 12, "promptv1hash"

    async def fake_guardrail_check(answer: str, contexts):
        return SimpleNamespace(passed=True, score=0.95, details="ok")

    async def fake_compute_trust(*args, **kwargs):
        return SimpleNamespace(
            overall=0.9, retrieval_quality=0.9, faithfulness=0.95, relevance=0.9, source_authority=0.8
        )

    async def fake_save_query(**kwargs):
        state["saved"] = kwargs

    async def fake_document_version(*args, **kwargs):
        return 0

    async def fake_cache_lookup(*args, **kwargs):
        return None

    _install_module(monkeypatch, "app.retrieval.query_rewrite", rewrite=fake_rewrite)
    _install_module(monkeypatch, "app.retrieval.hybrid_search", hybrid_search=fake_hybrid_search)
    _install_module(monkeypatch, "app.retrieval.reranker", rerank=fake_rerank)
    _install_module(monkeypatch, "app.generation.streamer", stream_tokens=fake_stream_tokens)
    _install_module(monkeypatch, "app.generation.guardrail", check=fake_guardrail_check)
    _install_module(monkeypatch, "app.evaluation.trust_score", compute_trust=fake_compute_trust)

    monkeypatch.setattr(ws_api, "_save_query", fake_save_query)
    monkeypatch.setattr(ws_api, "get_workspace_document_version", fake_document_version)
    monkeypatch.setattr(ws_api, "lookup_cached_query", fake_cache_lookup)

    async def run(**overrides):
        await ws_api._run_query_pipeline(
            query_text=overrides.pop("query_text", "What is the parental leave policy?"),
            workspace_id="ws-1",
            user_id="user-1",
            query_id="query-1",
            top_k=5,
            filters=None,
            sink=sink,
            **overrides,
        )

    return SimpleNamespace(run=run, sent=recorder.frames, recorder=recorder, sink=sink, state=state)


@pytest.mark.asyncio
async def test_thin_evidence_abstains_without_calling_the_model(pipeline):
    """Below the rerank floor: no generation, no sources, an abstain frame set."""
    await pipeline.run()

    assert pipeline.state["stream_called"] is False
    types_sent = [message["type"] for message in pipeline.sent]
    assert types_sent == ["ack", "progress", "progress", "progress", "token", "guardrail", "trust_score", "complete"]
    assert "sources" not in types_sent
    assert pipeline.sent[FIRST_ABSTAIN_FRAME]["payload"]["phase"] == "abstain"


@pytest.mark.asyncio
async def test_abstention_frames_carry_increasing_seq_through_the_sink(pipeline):
    """Abstention frames go through the sink, so they are seq-stamped and resumable."""
    await pipeline.run()

    seqs = pipeline.recorder.seqs
    assert seqs == list(range(1, len(pipeline.sent) + 1)), "every frame needs a gapless top-level seq"

    abstain_frames = pipeline.sent[FIRST_ABSTAIN_FRAME:]
    assert [frame["type"] for frame in abstain_frames] == [
        "progress",
        "token",
        "guardrail",
        "trust_score",
        "complete",
    ]
    abstain_seqs = [frame["seq"] for frame in abstain_frames]
    assert abstain_seqs == sorted(abstain_seqs)
    assert len(set(abstain_seqs)) == len(abstain_seqs)
    # Buffered means a client that dropped mid-abstention can resume it.
    assert pipeline.sink.buffer.frames == pipeline.sent


@pytest.mark.asyncio
async def test_abstention_answer_is_the_recognised_refusal_string(pipeline):
    await pipeline.run()

    token = pipeline.sent[FIRST_ABSTAIN_FRAME + 1]["payload"]
    assert token["content"].startswith("I cannot find this information in your documents.")
    assert "best evidence score 0.02" in token["content"]
    assert token["index"] == 0


@pytest.mark.asyncio
async def test_complete_frame_reports_the_edge_case_and_what_was_searched(pipeline):
    await pipeline.run()

    complete = pipeline.sent[-1]["payload"]
    assert complete["edge_case"] == "insufficient_evidence"
    assert complete["model_used"] == "abstain"
    assert complete["token_count"] == 0
    assert complete["from_cache"] is False
    assert complete["sufficiency"]["reason"] == "low_relevance"
    assert complete["sufficiency"]["searched_count"] == 2
    assert complete["sufficiency"]["document_count"] == 1


@pytest.mark.asyncio
async def test_abstention_is_persisted_with_no_sources_and_an_edge_case(pipeline):
    await pipeline.run()

    saved = pipeline.state["saved"]
    assert isinstance(saved, dict)
    assert saved["edge_case"] == "insufficient_evidence"
    assert saved["model_used"] == "abstain"
    assert saved["response_sources"] == []
    assert saved["trust_score"] == 0.0
    assert saved["query_text"] == "What is the parental leave policy?"
    assert saved["normalized_query"]
    assert saved["response_text"].startswith("I cannot find this information in your documents.")


@pytest.mark.asyncio
async def test_strong_evidence_still_generates_normally(pipeline):
    pipeline.state["rerank_scores"] = [0.93, 0.71]

    await pipeline.run()

    assert pipeline.state["stream_called"] is True
    types_sent = [message["type"] for message in pipeline.sent]
    assert "sources" in types_sent
    assert pipeline.sent[-1]["payload"].get("edge_case") is None
    saved = pipeline.state["saved"]
    assert isinstance(saved, dict)
    assert saved.get("edge_case") is None


@pytest.mark.asyncio
async def test_disabling_the_gate_restores_the_ungated_pipeline(pipeline, monkeypatch):
    monkeypatch.setattr(settings, "SUFFICIENCY_GATE_ENABLED", False)

    await pipeline.run()

    assert pipeline.state["stream_called"] is True
    assert "sources" in [message["type"] for message in pipeline.sent]


@pytest.mark.asyncio
async def test_save_query_writes_edge_case_to_the_queries_table(monkeypatch, test_engine, test_db: AsyncSession):
    """The persisted abstention is queryable — F7b can promote it as unanswerable."""
    from app.api import ws as ws_api

    monkeypatch.setattr(
        ws_api,
        "async_session_factory",
        async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False),
    )
    user = User(email="abstain@example.com", username="abstain", password_hash="h", role="user", is_active=True)
    test_db.add(user)
    await test_db.commit()
    workspace = Workspace(name="Abstain workspace", owner_id=user.id)
    test_db.add(workspace)
    await test_db.commit()

    await ws_api._save_query(
        query_id="query-abstain-1",
        workspace_id=workspace.id,
        user_id=user.id,
        query_text="What is the parental leave policy?",
        rewritten_query=None,
        response_text="I cannot find this information in your documents.",
        response_sources=[],
        trust_score=0.0,
        trust_components={"retrieval_quality": 0.02},
        guardrail_score=1.0,
        guardrail_passed=True,
        model_used="abstain",
        latency_ms=12,
        token_count=0,
        normalized_query="what is the parental leave policy",
        document_version=0,
        edge_case="insufficient_evidence",
    )

    row = (await test_db.execute(select(Query).where(Query.id == "query-abstain-1"))).scalar_one()
    assert row.edge_case == "insufficient_evidence"
    assert row.model_used == "abstain"


@pytest.mark.asyncio
async def test_cached_replay_of_an_abstention_still_reports_the_edge_case():
    """A persisted abstention is cacheable (response_text is not NULL), so the
    replay path must not present it as a normal answer."""
    from app.api import ws as ws_api

    recorder = Recorder()
    cached = Query(
        id="cached-abstain",
        workspace_id="ws-1",
        query_text="Who signed the 1994 lease?",
        response_text="I cannot find this information in your documents. Searched 5 chunks across 2 documents; best evidence score 0.04.",
        response_sources="[]",
        trust_score=0.0,
        guardrail_score=1.0,
        guardrail_passed=True,
        model_used="abstain",
        token_count=0,
        edge_case="insufficient_evidence",
    )

    await ws_api._send_cached_query(cached, _sink(recorder, "cached-abstain"), 3)

    complete = recorder.frames[-1]["payload"]
    assert complete["from_cache"] is True
    assert complete["edge_case"] == "insufficient_evidence"
    assert recorder.seqs == list(range(1, len(recorder.frames) + 1))


@pytest.mark.asyncio
async def test_cached_replay_of_a_normal_answer_has_no_edge_case():
    from app.api import ws as ws_api

    recorder = Recorder()
    cached = Query(
        id="cached-normal",
        workspace_id="ws-1",
        query_text="What is RAG?",
        response_text="Retrieval Augmented Generation.",
        response_sources="[]",
        trust_score=0.9,
        model_used="qwen3:4b",
        token_count=4,
    )

    await ws_api._send_cached_query(cached, _sink(recorder, "cached-normal"), 3)

    assert recorder.frames[-1]["payload"]["edge_case"] is None


@pytest.mark.asyncio
async def test_save_query_leaves_edge_case_null_for_normal_answers(monkeypatch, test_engine, test_db: AsyncSession):
    from app.api import ws as ws_api

    monkeypatch.setattr(
        ws_api,
        "async_session_factory",
        async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False),
    )
    user = User(email="normal@example.com", username="normal", password_hash="h", role="user", is_active=True)
    test_db.add(user)
    await test_db.commit()
    workspace = Workspace(name="Normal workspace", owner_id=user.id)
    test_db.add(workspace)
    await test_db.commit()

    await ws_api._save_query(
        query_id="query-normal-1",
        workspace_id=workspace.id,
        user_id=user.id,
        query_text="What is the parental leave policy?",
        rewritten_query=None,
        response_text="Twelve weeks.",
        response_sources=[],
        trust_score=0.8,
        trust_components={},
        guardrail_score=0.9,
        guardrail_passed=True,
        model_used="qwen3:4b",
        latency_ms=12,
        token_count=3,
        normalized_query="what is the parental leave policy",
        document_version=0,
    )

    row = (await test_db.execute(select(Query).where(Query.id == "query-normal-1"))).scalar_one()
    assert row.edge_case is None


@pytest.mark.asyncio
async def test_abstention_records_the_prompt_that_was_active(pipeline, monkeypatch):
    """An abstention still stamps the active prompt, with no prompt tokens.

    Without this the abstention row has `prompt_version IS NULL`, and
    `lookup_cached_query` (which now filters on the active hash) can never
    replay it — nor can it ever be invalidated by a promotion.
    """
    from app.api import ws as ws_api
    from app.prompts.registry import ResolvedPrompt

    async def fake_get_active(db, name="answer"):
        return ResolvedPrompt(content="pinned text", hash="activehash01", is_default=False)

    monkeypatch.setattr(ws_api, "get_active_prompt", fake_get_active)

    await pipeline.run()

    saved = pipeline.state["saved"]
    assert isinstance(saved, dict)
    assert saved["edge_case"] == "insufficient_evidence"
    assert saved["prompt_version"] == "activehash01"
    # No LLM ran, so there is nothing to charge for.
    assert saved["prompt_tokens"] is None


@pytest.mark.asyncio
async def test_cached_replay_reports_the_prompt_version_that_wrote_the_row():
    """Cache hits are keyed on the active prompt, so the replay can echo it."""
    from app.api import ws as ws_api

    recorder = Recorder()
    cached = Query(
        id="cached-pinned",
        workspace_id="ws-1",
        query_text="What is RAG?",
        response_text="Retrieval Augmented Generation.",
        response_sources="[]",
        trust_score=0.9,
        model_used="qwen3:4b",
        token_count=4,
        prompt_version="activehash01",
    )

    await ws_api._send_cached_query(cached, _sink(recorder, "cached-pinned"), 3)

    complete = recorder.frames[-1]["payload"]
    assert complete["from_cache"] is True
    assert complete["prompt_version"] == "activehash01"
