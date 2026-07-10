"""CRAG self-correction loop using LangGraph."""

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
from app.retrieval.query_rewrite import rewrite as rewrite_query, expand
from app.retrieval.reranker import rerank


class CRAGState(TypedDict):
    """State for CRAG self-correction loop."""

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
    guardrail_max_retries: int

    # Evaluation
    trust_score: float | None
    trust_components: dict | None

    # CRAG
    retrieval_attempts: int
    max_retrieval_attempts: int
    edge_case: str | None  # 'normal' | 'fallback'

    # Metadata
    model_used: str
    latency_ms: int
    error: str | None


def _retrieve_node(state: CRAGState) -> dict:
    """Retrieve relevant chunks via hybrid search."""
    import asyncio

    loop = asyncio.get_event_loop()
    query_text = state.get("rewritten_query") or state["query"]
    workspace_id = state["workspace_id"]
    top_k = state.get("top_k", settings.RETRIEVAL_TOP_K)

    results = loop.run_until_complete(
        hybrid_search(query_text, workspace_id, top_k=top_k * 2, filters=state.get("filters"))
    )
    reranked = loop.run_until_complete(rerank(query_text, results))

    contexts = [
        {
            "chunk_id": r.chunk_id,
            "document_id": r.document_id,
            "content": r.content,
            "score": r.final_score,
            "rerank_score": r.rerank_score,
        }
        for r in reranked
    ]

    return {
        "retrieval_results": [vars(r) if hasattr(r, "__dict__") else r for r in results],
        "reranked_results": [vars(r) if hasattr(r, "__dict__") else r for r in reranked],
        "contexts": contexts,
        "retrieval_attempts": state.get("retrieval_attempts", 0) + 1,
    }


def _rewrite_node(state: CRAGState) -> dict:
    """Rewrite query for better retrieval."""
    import asyncio

    loop = asyncio.get_event_loop()
    rewritten = loop.run_until_complete(rewrite_query(state["query"]))
    return {"rewritten_query": rewritten}


def _expand_node(state: CRAGState) -> dict:
    """Expand query with variations and re-retrieve."""
    import asyncio

    loop = asyncio.get_event_loop()

    query_text = state.get("rewritten_query") or state["query"]
    variations = loop.run_until_complete(expand(query_text, n_variations=3))

    # Use first variation as the new query
    if len(variations) > 1:
        new_query = variations[1]  # First variation after original
    else:
        new_query = query_text

    return {"rewritten_query": new_query, "retrieval_attempts": state.get("retrieval_attempts", 0) + 1}


def _relevance_check(state: CRAGState) -> Literal["generate", "expand_query", "fallback"]:
    """Check if retrieved contexts are relevant enough."""
    contexts = state.get("contexts")

    if not contexts:
        retrieval_attempts = state.get("retrieval_attempts", 0)
        max_attempts = state.get("max_retrieval_attempts", 3)

        if retrieval_attempts >= max_attempts:
            return "fallback"
        return "expand_query"

    # Check if any context has a good score
    high_score = any(ctx.get("score", 0) > settings.RETRIEVAL_MIN_SCORE for ctx in contexts)
    if high_score:
        return "generate"

    retrieval_attempts = state.get("retrieval_attempts", 0)
    max_attempts = state.get("max_retrieval_attempts", 3)

    if retrieval_attempts >= max_attempts:
        return "fallback"
    return "expand_query"


def _generate_primary_node(state: CRAGState) -> dict:
    """Generate answer using primary LLM."""
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
        "model_used": result.model_used,
        "latency_ms": result.latency_ms,
        "edge_case": "normal",
    }


def _generate_fallback_node(state: CRAGState) -> dict:
    """Generate answer using fallback LLM with relaxed constraints."""
    from langchain_core.messages import HumanMessage, SystemMessage
    from app.generation.provider import get_chat_llm

    contexts = state.get("contexts") or []
    context_text = "\n".join(ctx.get("content", "") for ctx in contexts)

    system_prompt = (
        "You are a helpful assistant. Answer the user's question based on the provided context. "
        "If you're not sure, say so. Be concise."
    )

    llm = get_chat_llm(
        temperature=0.5,
        _fallback=True,
    )

    messages = [
        SystemMessage(content=f"{system_prompt}\n\nContext:\n{context_text}"),
        HumanMessage(content=state["query"]),
    ]

    try:
        response = llm.invoke(messages)
        answer = response.content.strip()
    except Exception as e:
        answer = f"I apologize, but I encountered an error: {e}"

    return {
        "response_text": answer,
        "model_used": settings.OLLAMA_FALLBACK_MODEL,
        "edge_case": "fallback",
    }


def _guardrail_node(state: CRAGState) -> dict:
    """Check answer for hallucination."""
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
        },
        "guardrail_retry_count": state.get("guardrail_retry_count", 0) + 1,
    }


def _guardrail_decision(state: CRAGState) -> Literal["trust_score", "expand_query", "fallback"]:
    """Decide next step based on guardrail result."""
    guardrail = state.get("guardrail_result") or {}
    passed = guardrail.get("passed", False)
    retry_count = state.get("guardrail_retry_count", 0)
    max_retries = state.get("guardrail_max_retries", settings.GUARDRAIL_MAX_RETRIES)

    if passed:
        return "trust_score"

    if retry_count < max_retries:
        # Try expanding query and re-retrieving
        return "expand_query"

    # Max retries exceeded — use fallback
    return "fallback"


def _trust_score_node(state: CRAGState) -> dict:
    """Compute trust score."""
    import asyncio

    loop = asyncio.get_event_loop()

    retrieval_results = state.get("reranked_results") or state.get("retrieval_results") or []
    guardrail_dict = state.get("guardrail_result")

    guardrail_result = None
    if guardrail_dict:
        guardrail_result = GuardrailResult(
            passed=guardrail_dict.get("passed", True),
            score=guardrail_dict.get("score", 1.0),
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


def build_crag_graph() -> CompiledStateGraph:
    """Build the CRAG self-correction graph.

    Flow: rewrite → retrieve → relevance_check
      ├─ relevant → generate_primary → guardrail → pass? → trust_score → END
      │                                            → fail? → expand → retrieve (loop)
      └─ not relevant → expand_query → retrieve (loop, max 3)
                        → still not relevant → fallback → trust_score → END
    """
    workflow = StateGraph(CRAGState)

    # Nodes
    workflow.add_node("rewrite", _rewrite_node)
    workflow.add_node("retrieve", _retrieve_node)
    workflow.add_node("expand_query", _expand_node)
    workflow.add_node("generate_primary", _generate_primary_node)
    workflow.add_node("generate_fallback", _generate_fallback_node)
    workflow.add_node("guardrail", _guardrail_node)
    workflow.add_node("trust_score", _trust_score_node)

    # Edges
    workflow.set_entry_point("rewrite")
    workflow.add_edge("rewrite", "retrieve")

    workflow.add_conditional_edges(
        "retrieve",
        _relevance_check,
        {
            "generate": "generate_primary",
            "expand_query": "expand_query",
            "fallback": "generate_fallback",
        },
    )

    workflow.add_conditional_edges(
        "expand_query",
        lambda s: "retrieve",
        {"retrieve": "retrieve"},
    )

    workflow.add_edge("generate_primary", "guardrail")
    workflow.add_edge("generate_fallback", "trust_score")

    workflow.add_conditional_edges(
        "guardrail",
        _guardrail_decision,
        {
            "trust_score": "trust_score",
            "expand_query": "expand_query",
            "fallback": "generate_fallback",
        },
    )

    workflow.add_edge("trust_score", END)

    return workflow.compile()
