"""Multi-document comparison graph using LangGraph.

Flow:
  1. For each document_id, run a scoped RAG query (retrieve → rerank → generate → guardrail)
  2. Run all document queries in parallel
  3. Synthesize: compare answers, detect agreements/contradictions, produce synthesis
  4. Compute agreement score and overall trust score
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any, Literal

from langgraph.graph import END, StateGraph
from typing_extensions import TypedDict

from app.config import settings
from app.evaluation.trust_score import TrustScoreComponents, compute_trust
from app.generation.citer import CitedSpan, cite
from app.generation.generator import GenerationInput, GenerationResult, generate as generate_answer
from app.generation.guardrail import GuardrailResult, check as guardrail_check
from app.retrieval.hybrid_search import RetrievalResult, hybrid_search
from app.retrieval.query_rewrite import rewrite as rewrite_query
from app.retrieval.reranker import RerankedResult, rerank
from app.utils.logger import logger


# ─── Dataclasses ──────────────────────────────────────────────────────────────

@dataclass
class DocResult:
    """Result for a single document in the comparison."""
    document_id: str
    document_name: str
    answer_text: str
    sources: list[dict[str, Any]] = field(default_factory=list)
    trust_score: float | None = None
    guardrail_passed: bool = True
    guardrail_score: float = 1.0
    latency_ms: int = 0
    error: str | None = None


@dataclass
class ReasoningStep:
    """One step in the comparison reasoning trace."""
    phase: str
    title: str
    description: str
    details: dict[str, Any] = field(default_factory=dict)
    timestamp_ms: int = 0


# ─── Graph State ──────────────────────────────────────────────────────────────

class ComparisonState(TypedDict):
    """State passed between LangGraph nodes."""

    query: str
    rewritten_query: str | None
    workspace_id: str
    user_id: str | None
    query_id: str
    document_ids: list[str]
    top_k: int
    filters: dict | None

    # Per-document results (filled in parallel)
    doc_results: list[dict[str, Any]]

    # Synthesis
    synthesis_text: str | None
    agreement_score: float | None
    per_doc_stances: dict[str, str]  # document_id -> "supports" | "contradicts" | "silent"

    # Trust
    trust_score: float | None
    trust_components: dict | None

    # Metadata
    model_used: str
    latency_ms: int
    error: str | None
    reasoning_trace: list[dict[str, Any]]


# ─── Prompt Templates ─────────────────────────────────────────────────────────

SYNTHESIS_PROMPT = """You are a document comparison synthesizer.

Given a user question and answers from multiple documents, analyze where the documents agree, contradict, or remain silent.

User Question: {query}

Document Answers:
{doc_answers}

Your task:
1. Identify points of AGREEMENT — where documents say the same thing (quote each)
2. Identify points of CONTRADICTION — where documents give conflicting answers (quote each)
3. Identify GAPS — topics covered by some documents but not others
4. Provide an overall SYNTHESIS summarizing the comparative landscape
5. Assign each document a STANCE relative to the synthesis:
   - "supports" — document's answer aligns with the consensus/main finding
   - "contradicts" — document's answer conflicts with the consensus/main finding
   - "silent" — document does not address the question

Return JSON with this exact structure:
{{
  "synthesis": "string - comprehensive synthesis text",
  "agreements": [
    {{"point": "string", "documents": ["doc_id1", "doc_id2"], "quotes": {{"doc_id1": "quote", "doc_id2": "quote"}}}}
  ],
  "contradictions": [
    {{"point": "string", "documents": ["doc_id1", "doc_id2"], "quotes": {{"doc_id1": "quote", "doc_id2": "quote"}}}}
  ],
  "gaps": [
    {{"topic": "string", "covered_by": ["doc_id1"], "missing_from": ["doc_id2", "doc_id3"]}}
  ],
  "stances": {{"doc_id1": "supports", "doc_id2": "contradicts", "doc_id3": "silent"}},
  "agreement_score": 0.0-1.0
}}

Be precise about which document says what. Use the document IDs provided.
"""


# ─── Helper: LLM Call ─────────────────────────────────────────────────────────

def _run_llm(system_prompt: str, user_prompt: str, temperature: float = 0.2, max_tokens: int = 2048) -> str:
    """Synchronous LLM call via provider."""
    from langchain_core.messages import HumanMessage, SystemMessage
    from app.generation.provider import get_chat_llm

    llm = get_chat_llm(temperature=temperature, max_tokens=max_tokens, timeout=60)
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt),
    ]
    response = llm.invoke(messages)
    return response.content.strip()


def _try_parse_json(text: str) -> dict | None:
    """Try to extract JSON from LLM output."""
    import re

    # Try direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try markdown code block
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # Try finding JSON object
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            pass

    return None


# ─── Graph Nodes ──────────────────────────────────────────────────────────────

async def _query_single_doc(
    query: str,
    rewritten_query: str | None,
    workspace_id: str,
    document_id: str,
    top_k: int,
    filters: dict | None,
) -> DocResult:
    """Run the full RAG pipeline for a single document."""
    start_time = time.time()
    query_text = rewritten_query or query

    try:
        # 1. Hybrid search scoped to this document
        doc_filters = {**filters} if filters else {}
        doc_filters["document_id"] = document_id

        results = await hybrid_search(query_text, workspace_id, top_k=top_k * 2, filters=doc_filters)

        if not results:
            return DocResult(
                document_id=document_id,
                document_name="",
                answer_text="No relevant content found in this document.",
                trust_score=0.0,
                guardrail_passed=True,
                latency_ms=int((time.time() - start_time) * 1000),
            )

        # 2. Rerank
        reranked = await rerank(query_text, results, top_k=top_k)

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

        doc_name = contexts[0].get("document_name", "") if contexts else ""

        # 3. Generate answer
        gen_input = GenerationInput(
            query=query,
            rewritten_query=rewritten_query,
            contexts=contexts,
        )
        gen_result: GenerationResult = await generate_answer(gen_input)

        # 4. Guardrail check
        guardrail_result: GuardrailResult = await guardrail_check(gen_result.text, contexts)

        # 5. Cite sources
        cited_spans = await cite(gen_result.text, contexts)
        sources = [
            {
                "text": c.text,
                "chunk_id": c.chunk_id,
                "start_index": c.start_index,
                "end_index": c.end_index,
            }
            for c in cited_spans
        ]

        elapsed_ms = int((time.time() - start_time) * 1000)
        return DocResult(
            document_id=document_id,
            document_name=doc_name,
            answer_text=gen_result.text,
            sources=sources,
            trust_score=guardrail_result.score,
            guardrail_passed=guardrail_result.passed,
            guardrail_score=guardrail_result.score,
            latency_ms=elapsed_ms,
        )

    except Exception as e:
        logger.error("doc_query_failed", document_id=document_id, error=str(e))
        elapsed_ms = int((time.time() - start_time) * 1000)
        return DocResult(
            document_id=document_id,
            document_name="",
            answer_text=f"Error processing this document: {e}",
            trust_score=0.0,
            guardrail_passed=False,
            latency_ms=elapsed_ms,
            error=str(e),
        )


def _rewrite_node(state: ComparisonState) -> dict:
    """Rewrite the query for better retrieval."""
    import asyncio

    loop = asyncio.get_event_loop()
    rewritten = loop.run_until_complete(rewrite_query(state["query"]))

    return {
        "rewritten_query": rewritten,
        "reasoning_trace": [asdict(ReasoningStep(
            phase="rewrite",
            title="Query Rewriting",
            description=f"Original: '{state['query'][:80]}...' → Rewritten: '{rewritten[:80]}...'",
            timestamp_ms=int(time.time() * 1000),
        ))],
    }


def _parallel_docs_node(state: ComparisonState) -> dict:
    """Run RAG pipeline for each document in parallel."""
    import asyncio

    loop = asyncio.get_event_loop()

    tasks = [
        _query_single_doc(
            query=state["query"],
            rewritten_query=state.get("rewritten_query"),
            workspace_id=state["workspace_id"],
            document_id=doc_id,
            top_k=state.get("top_k", settings.RETRIEVAL_TOP_K),
            filters=state.get("filters"),
        )
        for doc_id in state["document_ids"]
    ]

    results = loop.run_until_complete(asyncio.gather(*tasks))

    # Convert to dicts for state
    doc_results = [asdict(r) for r in results]

    trace = ReasoningStep(
        phase="parallel_docs",
        title="Per-Document Retrieval & Generation",
        description=f"Queried {len(doc_results)} documents in parallel",
        details={"document_ids": state["document_ids"], "results": len(doc_results)},
        timestamp_ms=int(time.time() * 1000),
    )

    existing_trace = state.get("reasoning_trace", [])
    return {
        "doc_results": doc_results,
        "reasoning_trace": existing_trace + [asdict(trace)],
    }


def _synthesize_node(state: ComparisonState) -> dict:
    """Synthesize per-document answers into comparison."""
    query = state["query"]
    doc_results = state.get("doc_results", [])

    # Build document answers text for prompt
    doc_answers_parts = []
    for dr in doc_results:
        doc_answers_parts.append(
            f"=== Document: {dr['document_id']} ({dr['document_name']}) ===\n"
            f"Answer: {dr['answer_text']}\n"
            f"Trust Score: {dr['trust_score']}\n"
        )
    doc_answers = "\n".join(doc_answers_parts)

    trace = ReasoningStep(
        phase="synthesize",
        title="Cross-Document Synthesis",
        description=f"Synthesizing {len(doc_results)} document answers",
        timestamp_ms=int(time.time() * 1000),
    )

    try:
        prompt = SYNTHESIS_PROMPT.format(query=query, doc_answers=doc_answers)
        response = _run_llm(
            "You are a precise document comparison synthesizer. Always return valid JSON.",
            prompt,
            temperature=0.2,
            max_tokens=3072,
        )

        parsed = _try_parse_json(response)
        if not parsed:
            raise ValueError("Failed to parse synthesis JSON")

        synthesis_text = parsed.get("synthesis", "")
        agreements = parsed.get("agreements", [])
        contradictions = parsed.get("contradictions", [])
        gaps = parsed.get("gaps", [])
        stances = parsed.get("stances", {})
        agreement_score = float(parsed.get("agreement_score", 0.5))

        trace.details = {
            "agreements_count": len(agreements),
            "contradictions_count": len(contradictions),
            "gaps_count": len(gaps),
            "stances": stances,
            "agreement_score": agreement_score,
        }

    except Exception as e:
        logger.error("synthesis_failed", error=str(e), query=query[:100])
        trace.details = {"error": str(e)}
        # Fallback
        synthesis_text = "Synthesis failed. Individual document answers available above."
        agreements = []
        contradictions = []
        gaps = []
        stances = {dr["document_id"]: "silent" for dr in doc_results}
        agreement_score = 0.0

    existing_trace = state.get("reasoning_trace", [])
    return {
        "synthesis_text": synthesis_text,
        "agreement_score": agreement_score,
        "per_doc_stances": stances,
        "reasoning_trace": existing_trace + [asdict(trace)],
    }


def _trust_score_node(state: ComparisonState) -> dict:
    """Compute overall trust score from all signals."""
    doc_results = state.get("doc_results", [])

    trace = ReasoningStep(
        phase="trust",
        title="Trust Score Calculation",
        description=f"Aggregating trust from {len(doc_results)} document results",
        timestamp_ms=int(time.time() * 1000),
    )

    # Aggregate retrieval results and guardrail scores
    all_retrieval_results = []
    guardrail_scores = []
    guardrail_passed_count = 0

    for dr in doc_results:
        if dr.get("trust_score") is not None:
            guardrail_scores.append(dr["trust_score"])
        if dr.get("guardrail_passed"):
            guardrail_passed_count += 1

    avg_guardrail = sum(guardrail_scores) / len(guardrail_scores) if guardrail_scores else 0.5

    agg_guardrail = GuardrailResult(
        passed=guardrail_passed_count == len(doc_results) if doc_results else True,
        score=avg_guardrail,
        details=f"Aggregate across {len(doc_results)} documents: {guardrail_passed_count}/{len(doc_results)} passed",
    )

    import asyncio
    loop = asyncio.get_event_loop()

    trust: TrustScoreComponents = loop.run_until_complete(
        compute_trust(
            retrieval_results=all_retrieval_results,
            guardrail_result=agg_guardrail,
            query=state["query"],
        )
    )

    trace.details = {
        "overall": trust.overall,
        "retrieval_quality": trust.retrieval_quality,
        "faithfulness": trust.faithfulness,
        "relevance": trust.relevance,
        "source_authority": trust.source_authority,
        "doc_count": len(doc_results),
    }

    existing_trace = state.get("reasoning_trace", [])
    return {
        "trust_score": trust.overall,
        "trust_components": {
            "retrieval_quality": trust.retrieval_quality,
            "faithfulness": trust.faithfulness,
            "relevance": trust.relevance,
            "source_authority": trust.source_authority,
        },
        "reasoning_trace": existing_trace + [asdict(trace)],
    }


# ─── Graph Builder ────────────────────────────────────────────────────────────

def build_comparison_graph() -> StateGraph:
    """Build the multi-document comparison graph.

    Flow:
        rewrite → parallel_docs → synthesize → trust_score → END
    """
    workflow = StateGraph(ComparisonState)

    workflow.add_node("rewrite", _rewrite_node)
    workflow.add_node("parallel_docs", _parallel_docs_node)
    workflow.add_node("synthesize", _synthesize_node)
    workflow.add_node("trust_score", _trust_score_node)

    workflow.set_entry_point("rewrite")
    workflow.add_edge("rewrite", "parallel_docs")
    workflow.add_edge("parallel_docs", "synthesize")
    workflow.add_edge("synthesize", "trust_score")
    workflow.add_edge("trust_score", END)

    return workflow.compile()


# ─── Convenience Runner ───────────────────────────────────────────────────────

async def run_comparison(
    query: str,
    workspace_id: str,
    document_ids: list[str],
    user_id: str | None = None,
    query_id: str | None = None,
    top_k: int | None = None,
    filters: dict | None = None,
) -> dict[str, Any]:
    """Run the full comparison pipeline and return results.

    Returns:
        Dict with keys: synthesis_text, agreement_score, trust_score,
        trust_components, doc_results, per_doc_stances, reasoning_trace,
        latency_ms, error
    """
    start_time = time.time()
    qid = query_id or str(uuid.uuid4())

    graph = build_comparison_graph()

    initial_state: ComparisonState = {
        "query": query,
        "rewritten_query": None,
        "workspace_id": workspace_id,
        "user_id": user_id,
        "query_id": qid,
        "document_ids": document_ids,
        "top_k": top_k or settings.RETRIEVAL_TOP_K,
        "filters": filters,
        "doc_results": [],
        "synthesis_text": None,
        "agreement_score": None,
        "per_doc_stances": {},
        "trust_score": None,
        "trust_components": None,
        "model_used": settings.OLLAMA_PRIMARY_MODEL,
        "latency_ms": 0,
        "error": None,
        "reasoning_trace": [],
    }

    try:
        result = await graph.ainvoke(initial_state)

        total_latency = int((time.time() - start_time) * 1000)

        logger.info(
            "comparison_complete",
            query=query[:100],
            workspace_id=workspace_id,
            doc_count=len(document_ids),
            agreement_score=result.get("agreement_score"),
            trust_score=result.get("trust_score"),
            latency_ms=total_latency,
        )

        return {
            "synthesis_text": result.get("synthesis_text"),
            "agreement_score": result.get("agreement_score"),
            "trust_score": result.get("trust_score"),
            "trust_components": result.get("trust_components"),
            "doc_results": result.get("doc_results", []),
            "per_doc_stances": result.get("per_doc_stances", {}),
            "reasoning_trace": result.get("reasoning_trace", []),
            "latency_ms": total_latency,
            "error": result.get("error"),
        }

    except Exception as e:
        logger.error("comparison_failed", error=str(e), query=query[:100])
        total_latency = int((time.time() - start_time) * 1000)
        return {
            "synthesis_text": f"Comparison failed: {e}",
            "agreement_score": 0.0,
            "trust_score": 0.0,
            "trust_components": {},
            "doc_results": [],
            "per_doc_stances": {},
            "reasoning_trace": [],
            "latency_ms": total_latency,
            "error": str(e),
        }