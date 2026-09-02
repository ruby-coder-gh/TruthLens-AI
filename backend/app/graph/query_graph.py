"""Standard RAG query flow using LangGraph."""

from __future__ import annotations

from typing import Literal

from langgraph.graph import END, StateGraph
from langgraph.graph.state import CompiledStateGraph
from typing_extensions import TypedDict

from app.config import settings
from app.database import async_session_factory
from app.evaluation.trust_score import TrustScoreComponents, compute_trust
from app.generation.generator import GenerationInput, GenerationResult, generate as generate_answer
from app.generation.guardrail import GuardrailResult, check as guardrail_check
from app.query_cache import cached_query_sources, get_workspace_document_version, lookup_cached_query
from app.retrieval.hybrid_search import hybrid_search
from app.retrieval.query_rewrite import rewrite as rewrite_query
from app.retrieval.reranker import rerank
from app.retrieval.sufficiency import (
    ABSTAIN_MODEL_NAME,
    ABSTAIN_TRUST_SCORE,
    EDGE_CASE_INSUFFICIENT_EVIDENCE,
    abstention_trust_components,
    assess_sufficiency,
    build_abstention,
)
from app.utils.logger import logger

# Retrieval passes allowed before the graph gives up and abstains. Without a
# budget the retrieve -> rewrite conditional edge could cycle indefinitely.
MAX_RETRIEVAL_ATTEMPTS = 2


class GraphState(TypedDict):
    """State passed between LangGraph nodes."""

    query: str
    rewritten_query: str | None
    workspace_id: str
    user_id: str | None
    query_id: str
    top_k: int
    filters: dict | None
    force_refresh: bool

    # Cache
    cache_hit: bool
    cached_query_id: str | None
    workspace_document_version: int

    # Retrieval
    retrieval_results: list | None
    reranked_results: list | None
    retrieval_attempts: int

    # Generation
    contexts: list[dict] | None
    response_text: str | None
    cited_spans: list | None
    # None for a normal answer; "insufficient_evidence" when the gate abstained.
    edge_case: str | None

    # Guardrail
    guardrail_result: dict | None
    guardrail_retry_count: int

    # Evaluation
    trust_score: float | None
    trust_components: dict | None

    # Metadata
    model_used: str
    latency_ms: int
    error: str | None


async def _cache_lookup_node(state: GraphState) -> dict:
    """Short-circuit the graph when an unexpired, document-version-matched answer exists."""
    workspace_id = state["workspace_id"]

    async with async_session_factory() as session:
        document_version = await get_workspace_document_version(session, workspace_id)
        if state.get("filters"):
            logger.info("query_cache_bypassed", workspace_id=workspace_id, reason="filtered_query")
            return {
                "cache_hit": False,
                "cached_query_id": None,
                "workspace_document_version": document_version,
            }

        cached_query = await lookup_cached_query(
            session,
            workspace_id=workspace_id,
            query_text=state["query"],
            document_version=document_version,
            force_refresh=state.get("force_refresh", False),
        )
        await session.commit()

    if cached_query is None:
        return {
            "cache_hit": False,
            "cached_query_id": None,
            "workspace_document_version": document_version,
        }

    return {
        "cache_hit": True,
        "cached_query_id": cached_query.id,
        "workspace_document_version": document_version,
        "contexts": cached_query_sources(cached_query),
        "retrieval_results": [],
        "reranked_results": [],
        "response_text": cached_query.response_text,
        "guardrail_result": {
            "passed": cached_query.guardrail_passed if cached_query.guardrail_passed is not None else True,
            "score": cached_query.guardrail_score if cached_query.guardrail_score is not None else 0.0,
            "unsupported_claims": [],
            "details": "Served from cache.",
        },
        "trust_score": cached_query.trust_score,
        "trust_components": {},
        "model_used": cached_query.model_used or "cached",
        "latency_ms": 0,
        "error": None,
    }


def _should_use_cache(state: GraphState) -> Literal["cached", "rewrite"]:
    return "cached" if state.get("cache_hit") else "rewrite"


async def _retrieve_node(state: GraphState) -> dict:
    """Retrieve relevant chunks via hybrid search + rerank."""
    query_text = state.get("rewritten_query") or state["query"]
    workspace_id = state["workspace_id"]
    top_k = state.get("top_k", settings.RETRIEVAL_TOP_K)

    results = await hybrid_search(query_text, workspace_id, top_k=top_k, filters=state.get("filters"))
    reranked = await rerank(query_text, results)

    contexts = [
        {
            "chunk_id": r.chunk_id,
            "document_id": r.document_id,
            "content": r.content,
            "score": r.final_score,
            "rerank_score": r.rerank_score,
            "document_name": r.metadata.get("document_name", "") if hasattr(r, "metadata") else "",
            "metadata": r.metadata if hasattr(r, "metadata") else {},
        }
        for r in reranked
    ]

    return {
        "retrieval_results": [vars(r) if hasattr(r, "__dict__") else r for r in results],
        "reranked_results": [vars(r) if hasattr(r, "__dict__") else r for r in reranked],
        "contexts": contexts,
        "retrieval_attempts": state.get("retrieval_attempts", 0) + 1,
    }


async def _rewrite_node(state: GraphState) -> dict:
    """Rewrite query for better retrieval."""
    rewritten = await rewrite_query(state["query"])
    return {"rewritten_query": rewritten}


async def _generate_node(state: GraphState) -> dict:
    """Generate answer from retrieved contexts."""
    contexts = state.get("contexts", [])
    gen_input = GenerationInput(
        query=state["query"],
        rewritten_query=state.get("rewritten_query"),
        contexts=contexts,
    )

    result: GenerationResult = await generate_answer(gen_input)

    return {
        "response_text": result.text,
        "cited_spans": [vars(s) if hasattr(s, "__dict__") else {"text": s.text, "chunk_id": s.chunk_id, "start_index": s.start_index, "end_index": s.end_index} for s in result.cited_spans],
        "model_used": result.model_used,
        "latency_ms": result.latency_ms,
    }


async def _guardrail_node(state: GraphState) -> dict:
    """Check generated answer for hallucination."""
    answer = state.get("response_text") or ""
    contexts = state.get("contexts") or []

    guardrail_result: GuardrailResult = await guardrail_check(answer, contexts)

    return {
        "guardrail_result": {
            "passed": guardrail_result.passed,
            "score": guardrail_result.score,
            "unsupported_claims": guardrail_result.unsupported_claims,
            "details": guardrail_result.details,
        }
    }


async def _trust_score_node(state: GraphState) -> dict:
    """Compute trust score from all signals."""
    retrieval_results = state.get("reranked_results") or state.get("retrieval_results") or []
    guardrail_dict = state.get("guardrail_result")

    guardrail_result = None
    if guardrail_dict:
        guardrail_result = GuardrailResult(
            passed=guardrail_dict.get("passed", True),
            score=guardrail_dict.get("score", 1.0),
            unsupported_claims=guardrail_dict.get("unsupported_claims", []),
            details=guardrail_dict.get("details", ""),
        )

    trust: TrustScoreComponents = await compute_trust(
        retrieval_results=retrieval_results,
        guardrail_result=guardrail_result,
        query=state["query"],
    )

    return {
        "trust_score": trust.overall,
        "trust_components": {
            "retrieval_quality": trust.retrieval_quality,
            "faithfulness": trust.faithfulness,
            "relevance": trust.relevance,
            "source_authority": trust.source_authority,
        },
    }


async def _abstain_node(state: GraphState) -> dict:
    """Answer "I don't know" without spending a generation call.

    Reached when retrieval never produced evidence above the sufficiency floor.
    The guardrail result is synthesised as a pass (nothing was asserted, so
    there is nothing unsupported to catch) and the trust score is pinned to 0.0
    rather than computed, matching the WebSocket abstain path exactly.
    """
    verdict = assess_sufficiency(state.get("contexts") or [])
    logger.info(
        "query_abstained",
        query_id=state.get("query_id"),
        reason=verdict.reason,
        top_score=verdict.top_score,
        searched=verdict.searched_count,
    )
    return {
        "response_text": build_abstention(verdict),
        "cited_spans": [],
        "model_used": ABSTAIN_MODEL_NAME,
        "latency_ms": 0,
        "edge_case": EDGE_CASE_INSUFFICIENT_EVIDENCE,
        "guardrail_result": {
            "passed": True,
            "score": 1.0,
            "unsupported_claims": [],
            "details": "Abstained before generation: insufficient evidence.",
        },
        # Terminal: routing through _trust_score_node would let compute_trust
        # read the synthesised guardrail pass as faithfulness 1.0 and return
        # ~0.55 for an answer with zero evidence.
        "trust_score": ABSTAIN_TRUST_SCORE,
        "trust_components": abstention_trust_components(verdict),
    }


def _should_continue(state: GraphState) -> Literal["generate", "rewrite", "abstain"]:
    """Route on evidence quality, not just on 'did retrieval return anything'.

    Weak-but-present contexts used to go straight to generation, which is the
    classic hallucination path. Now they get one more retrieval attempt and then
    an explicit abstention.
    """
    contexts = state.get("contexts") or []
    if assess_sufficiency(contexts).sufficient:
        return "generate"
    if not settings.SUFFICIENCY_GATE_ENABLED:
        # Legacy behaviour: any context at all is enough to try generating.
        return "generate" if contexts else "rewrite"
    if state.get("retrieval_attempts", 0) < MAX_RETRIEVAL_ATTEMPTS:
        return "rewrite"
    return "abstain"


def build_query_graph() -> CompiledStateGraph:
    """Build the standard RAG query graph.

    Flow: cache_lookup → (cached | rewrite → retrieve → rerank → generate → guardrail → trust_score)

    Note: All node functions are async for proper non-blocking execution.
    """
    workflow = StateGraph(GraphState)

    # Nodes (async functions work with LangGraph's async execution)
    workflow.add_node("cache_lookup", _cache_lookup_node)
    workflow.add_node("rewrite", _rewrite_node)
    workflow.add_node("retrieve", _retrieve_node)
    workflow.add_node("generate", _generate_node)
    workflow.add_node("abstain", _abstain_node)
    workflow.add_node("guardrail", _guardrail_node)
    workflow.add_node("trust_score", _trust_score_node)

    # Edges
    workflow.set_entry_point("cache_lookup")
    workflow.add_conditional_edges(
        "cache_lookup",
        _should_use_cache,
        {
            "cached": END,
            "rewrite": "rewrite",
        },
    )
    workflow.add_edge("rewrite", "retrieve")
    workflow.add_conditional_edges(
        "retrieve",
        _should_continue,
        {
            "generate": "generate",
            "rewrite": "rewrite",
            "abstain": "abstain",
        },
    )
    workflow.add_edge("generate", "guardrail")
    # Abstention is terminal: it carries its own guardrail result and trust
    # score, so neither downstream node has anything left to decide.
    workflow.add_edge("abstain", END)
    workflow.add_edge("guardrail", "trust_score")
    workflow.add_edge("trust_score", END)

    return workflow.compile()
