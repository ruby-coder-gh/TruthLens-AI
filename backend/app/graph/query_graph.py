"""Standard RAG query flow using LangGraph."""

from __future__ import annotations

from typing import Literal

from langgraph.graph import END, StateGraph
from langgraph.graph.state import CompiledStateGraph
from typing_extensions import TypedDict

from app.config import settings
from app.evaluation.trust_score import TrustScoreComponents, compute_trust
from app.generation.generator import GenerationInput, GenerationResult, generate as generate_answer
from app.generation.guardrail import GuardrailResult, check as guardrail_check
from app.retrieval.hybrid_search import hybrid_search
from app.retrieval.query_rewrite import rewrite as rewrite_query
from app.retrieval.reranker import rerank


class GraphState(TypedDict):
    """State passed between LangGraph nodes."""

    query: str
    rewritten_query: str | None
    workspace_id: str
    user_id: str | None
    query_id: str
    top_k: int
    filters: dict | None

    # Retrieval
    retrieval_results: list | None
    reranked_results: list | None

    # Generation
    contexts: list[dict] | None
    response_text: str | None
    cited_spans: list | None

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


def _retrieve_node(state: GraphState) -> dict:
    """Retrieve relevant chunks via hybrid search + rerank."""
    query_text = state.get("rewritten_query") or state["query"]
    workspace_id = state["workspace_id"]
    top_k = state.get("top_k", settings.RETRIEVAL_TOP_K)

    import asyncio

    loop = asyncio.get_event_loop()

    results = loop.run_until_complete(
        hybrid_search(query_text, workspace_id, top_k=top_k, filters=state.get("filters"))
    )

    reranked = loop.run_until_complete(rerank(query_text, results))

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
    }


def _rewrite_node(state: GraphState) -> dict:
    """Rewrite query for better retrieval."""
    import asyncio

    loop = asyncio.get_event_loop()
    rewritten = loop.run_until_complete(rewrite_query(state["query"]))
    return {"rewritten_query": rewritten}


def _generate_node(state: GraphState) -> dict:
    """Generate answer from retrieved contexts."""
    import asyncio

    loop = asyncio.get_event_loop()

    contexts = state.get("contexts", [])
    gen_input = GenerationInput(
        query=state["query"],
        rewritten_query=state.get("rewritten_query"),
        contexts=contexts,
    )

    result: GenerationResult = loop.run_until_complete(generate_answer(gen_input))

    return {
        "response_text": result.text,
        "cited_spans": [vars(s) if hasattr(s, "__dict__") else {"text": s.text, "chunk_id": s.chunk_id, "start_index": s.start_index, "end_index": s.end_index} for s in result.cited_spans],
        "model_used": result.model_used,
        "latency_ms": result.latency_ms,
    }


def _guardrail_node(state: GraphState) -> dict:
    """Check generated answer for hallucination."""
    import asyncio

    loop = asyncio.get_event_loop()

    answer = state.get("response_text") or ""
    contexts = state.get("contexts") or []

    guardrail_result: GuardrailResult = loop.run_until_complete(
        guardrail_check(answer, contexts)
    )

    return {
        "guardrail_result": {
            "passed": guardrail_result.passed,
            "score": guardrail_result.score,
            "unsupported_claims": guardrail_result.unsupported_claims,
            "details": guardrail_result.details,
        }
    }


def _trust_score_node(state: GraphState) -> dict:
    """Compute trust score from all signals."""
    import asyncio

    loop = asyncio.get_event_loop()

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

    trust: TrustScoreComponents = loop.run_until_complete(
        compute_trust(
            retrieval_results=retrieval_results,
            guardrail_result=guardrail_result,
            query=state["query"],
        )
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


def _should_continue(state: GraphState) -> Literal["generate", "rewrite"]:
    """Check if retrieval results are sufficient."""
    contexts = state.get("contexts")
    if contexts and len(contexts) > 0:
        return "generate"
    return "rewrite"


def build_query_graph() -> CompiledStateGraph:
    """Build the standard RAG query graph.

    Flow: rewrite → retrieve → rerank → generate → guardrail → trust_score
    """
    workflow = StateGraph(GraphState)

    # Nodes
    workflow.add_node("rewrite", _rewrite_node)
    workflow.add_node("retrieve", _retrieve_node)
    workflow.add_node("generate", _generate_node)
    workflow.add_node("guardrail", _guardrail_node)
    workflow.add_node("trust_score", _trust_score_node)

    # Edges
    workflow.set_entry_point("rewrite")
    workflow.add_edge("rewrite", "retrieve")
    workflow.add_conditional_edges(
        "retrieve",
        _should_continue,
        {
            "generate": "generate",
            "rewrite": "rewrite",
        },
    )
    workflow.add_edge("generate", "guardrail")
    workflow.add_edge("guardrail", "trust_score")
    workflow.add_edge("trust_score", END)

    return workflow.compile()
