"""Agentic investigation graph: multi-step research across documents.

The investigation agent decomposes a complex user question into sub-questions,
retrieves evidence for each, synthesizes findings, and produces a structured
report with citations and a reasoning trace.

Flow: decompose → investigate (parallel sub-questions) → synthesize → trust_score
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from dataclasses import dataclass, field, asdict
from typing import Any

from langgraph.graph import END, StateGraph
from langgraph.graph.state import CompiledStateGraph
from typing_extensions import TypedDict

from app.config import settings
from app.evaluation.trust_score import TrustScoreComponents, compute_trust
from app.generation.citer import cite
from app.generation.generator import GenerationInput, GenerationResult, generate as generate_answer
from app.generation.provider import get_chat_llm
from app.generation.guardrail import GuardrailResult, check as guardrail_check
from app.retrieval.hybrid_search import hybrid_search
from app.retrieval.reranker import rerank
from app.utils.logger import logger


# ─── Dataclasses ──────────────────────────────────────────────────────────────

@dataclass
class SubQuestion:
    """A single sub-question in an investigation."""
    id: str
    question: str
    purpose: str
    retrieved_chunks: list[dict[str, Any]] = field(default_factory=list)
    partial_answer: str = ""
    citations: list[dict[str, Any]] = field(default_factory=list)
    trust_score: float | None = None
    guardrail_passed: bool = True
    latency_ms: int = 0


@dataclass
class ReasoningStep:
    """One step in the reasoning trace."""
    phase: str
    title: str
    description: str
    details: dict[str, Any] = field(default_factory=dict)
    timestamp_ms: int = 0


# ─── Graph State ──────────────────────────────────────────────────────────────

class InvestigationState(TypedDict):
    """State for the investigation graph."""

    query: str
    workspace_id: str
    user_id: str | None
    query_id: str
    top_k: int
    filters: dict | None

    # Decomposition
    sub_questions: list[dict[str, Any]]  # Serialized SubQuestion dicts
    reasoning_trace: list[dict[str, Any]]  # Serialized ReasoningStep dicts

    # Synthesis
    final_report: str | None
    cited_spans: list[dict[str, Any]] | None

    # Trust
    trust_score: float | None
    trust_components: dict | None

    # Metadata
    model_used: str
    latency_ms: int
    error: str | None


# ─── Prompt Templates ─────────────────────────────────────────────────────────

DECOMPOSITION_PROMPT = """You are a research question decomposition assistant.

Given a complex user question, break it down into 3-6 specific sub-questions
that together cover all aspects needed to answer the original question thoroughly.

For each sub-question, provide:
1. A clear, standalone question optimized for document search
2. The purpose of this sub-question (what aspect it investigates)

Return your response as a JSON array of objects with keys "question" and "purpose".

User question: {query}"""

SYNTHESIS_PROMPT = """You are a research report synthesizer.

You have investigated a complex question by breaking it into sub-questions and
researching each one. Below are the sub-questions and their findings.

Original question: {query}

Sub-question findings:
{sub_findings}

Your task: Synthesize these findings into a comprehensive, well-structured report.
Organize it with:
1. **Executive Summary** — 2-3 sentence overview of the answer
2. **Detailed Findings** — Organized by theme, with evidence from each sub-question
3. **Key Sources** — List the most important documents or sources referenced
4. **Confidence Assessment** — Based on the strength of evidence found

Use clear section headings. Cite sources as [source:N] where N corresponds
to the source number. Be factual and grounded in the evidence provided."""


# ─── Helper: run LLM call ─────────────────────────────────────────────────────

def _run_llm(system_prompt: str, user_prompt: str, temperature: float = 0.3, max_tokens: int = 1024) -> str:
    """Synchronous LLM call via provider."""
    from langchain_core.messages import HumanMessage, SystemMessage

    llm = get_chat_llm(
        temperature=temperature,
        max_tokens=max_tokens,
        timeout=30,
    )
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt),
    ]
    response = llm.invoke(messages)
    return response.content.strip()


def _try_parse_json(text: str) -> list[dict[str, str]] | None:
    """Try to extract JSON array from LLM output."""
    import re

    # Try direct parse — must be a list
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return parsed
    except json.JSONDecodeError:
        pass

    # Try extracting from markdown code block
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    if match:
        try:
            parsed = json.loads(match.group(1))
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            pass

    # Try finding array brackets
    start = text.find("[")
    end = text.rfind("]")
    if start >= 0 and end > start:
        try:
            parsed = json.loads(text[start:end + 1])
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            pass

    logger.debug("json_array_parse_failed", text_preview=text[:200])
    return None


# ─── Graph Nodes ──────────────────────────────────────────────────────────────

def _decompose_node(state: InvestigationState) -> dict:
    """Decompose the complex question into sub-questions."""
    start_time = time.time()
    query = state["query"]

    trace_step = ReasoningStep(
        phase="decompose",
        title="Question Decomposition",
        description=f"Breaking down: '{query[:100]}...'",
        timestamp_ms=int(time.time() * 1000),
    )

    try:
        prompt = DECOMPOSITION_PROMPT.format(query=query)
        response = _run_llm(
            "You are a precise question decomposition assistant. Always return valid JSON.",
            prompt,
            temperature=0.3,
            max_tokens=1536,
        )

        parsed = _try_parse_json(response)
        if not parsed or not isinstance(parsed, list) or len(parsed) == 0:
            logger.warning("decomposition_failed_to_parse", response=response[:200])
            # Fallback: create a single sub-question from the original query
            parsed = [{"question": query, "purpose": "Answer the original question directly"}]

        sub_questions = []
        for i, sq in enumerate(parsed):
            sub_questions.append(asdict(SubQuestion(
                id=str(uuid.uuid4()),
                question=sq.get("question", query),
                purpose=sq.get("purpose", f"Sub-question {i + 1}"),
            )))

        trace_step.details = {
            "sub_question_count": len(sub_questions),
            "sub_questions": [sq["question"] for sq in sub_questions],
        }

        logger.info(
            "investigation_decomposed",
            original_query=query[:100],
            sub_questions=len(sub_questions),
        )

        elapsed = int((time.time() - start_time) * 1000)
        trace_step.details["latency_ms"] = elapsed
        return {
            "sub_questions": sub_questions,
            "reasoning_trace": [asdict(trace_step)],
        }

    except Exception as e:
        logger.error("decomposition_failed", error=str(e), query=query[:100])
        trace_step.details = {"error": str(e)}
        # Fallback: use original query as single sub-question
        sub_questions = [asdict(SubQuestion(
            id=str(uuid.uuid4()),
            question=query,
            purpose="Answer the original question directly",
        ))]
        return {
            "sub_questions": sub_questions,
            "reasoning_trace": [asdict(trace_step)],
        }


async def _investigate_sub_question(
    sq: dict[str, Any],
    workspace_id: str,
    top_k: int,
    filters: dict | None,
) -> dict[str, Any]:
    """Investigate a single sub-question: retrieve → rerank → generate → guardrail."""
    start_time = time.time()
    sq_id = sq["id"]
    question = sq["question"]

    step = ReasoningStep(
        phase="investigate",
        title=f"Investigating: {question[:80]}",
        description=sq.get("purpose", ""),
        timestamp_ms=int(time.time() * 1000),
    )

    try:
        # 1. Hybrid search
        results = await hybrid_search(question, workspace_id, top_k=top_k, filters=filters)
        step.details["retrieval_count"] = len(results)

        if not results:
            step.details["outcome"] = "no_results"
            elapsed = int((time.time() - start_time) * 1000)
            return {
                "id": sq_id,
                "partial_answer": "No relevant documents found for this sub-question.",
                "citations": [],
                "trust_score": 0.0,
                "guardrail_passed": True,
                "latency_ms": elapsed,
                "retrieved_chunks": [],
                "trace_step": asdict(step),
            }

        # 2. Rerank
        reranked = await rerank(question, results, top_k=settings.RETRIEVAL_RERANK_K)
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
        step.details["reranked_count"] = len(contexts)

        # 3. Generate partial answer
        gen_input = GenerationInput(
            query=question,
            contexts=contexts,
        )
        gen_result: GenerationResult = await generate_answer(gen_input)

        # 4. Guardrail check
        guardrail_result: GuardrailResult = await guardrail_check(
            gen_result.text, contexts
        )

        # Build citations
        cited = await cite(gen_result.text, contexts)
        cited_dicts = [
            {"text": c.text, "chunk_id": c.chunk_id, "start_index": c.start_index, "end_index": c.end_index}
            for c in cited
        ]

        elapsed = int((time.time() - start_time) * 1000)
        step.details.update({
            "outcome": "completed",
            "answer_length": len(gen_result.text),
            "citations": len(cited),
            "guardrail_passed": guardrail_result.passed,
            "guardrail_score": guardrail_result.score,
            "latency_ms": elapsed,
        })

        return {
            "id": sq_id,
            "partial_answer": gen_result.text,
            "citations": cited_dicts,
            "trust_score": guardrail_result.score,
            "guardrail_passed": guardrail_result.passed,
            "latency_ms": elapsed,
            "retrieved_chunks": contexts,
            "trace_step": asdict(step),
        }

    except Exception as e:
        logger.error(
            "sub_question_failed",
            error=str(e),
            question=question[:80],
            sq_id=sq_id,
        )
        elapsed = int((time.time() - start_time) * 1000)
        step.details["outcome"] = "error"
        step.details["error"] = str(e)
        return {
            "id": sq_id,
            "partial_answer": f"Error investigating this sub-question: {e}",
            "citations": [],
            "trust_score": 0.0,
            "guardrail_passed": False,
            "latency_ms": elapsed,
            "retrieved_chunks": [],
            "trace_step": asdict(step),
        }


def _investigate_node(state: InvestigationState) -> dict:
    """Investigate all sub-questions in parallel (within event loop)."""
    start_time = time.time()
    sub_questions = state.get("sub_questions", [])
    workspace_id = state["workspace_id"]
    top_k = state.get("top_k", settings.RETRIEVAL_TOP_K)
    filters = state.get("filters")

    if not sub_questions:
        return {"error": "No sub-questions to investigate"}

    # The graph runs in FastAPI's worker thread. That thread has no implicit
    # event loop on modern Python, so own a short-lived loop for the concurrent
    # retrieval/generation work instead of relying on get_event_loop().
    async def run_sub_questions() -> list[dict[str, Any]]:
        return await asyncio.gather(*[
            _investigate_sub_question(sq, workspace_id, top_k, filters)
            for sq in sub_questions
        ])

    results = asyncio.run(run_sub_questions())

    # Update sub_questions with results
    result_map = {r["id"]: r for r in results}
    updated_sub_questions = []
    trace_steps = []

    for sq in sub_questions:
        sq_id = sq["id"]
        result = result_map.get(sq_id, {})
        updated = dict(sq)
        updated["partial_answer"] = result.get("partial_answer", "")
        updated["citations"] = result.get("citations", [])
        updated["trust_score"] = result.get("trust_score")
        updated["guardrail_passed"] = result.get("guardrail_passed", True)
        updated["latency_ms"] = result.get("latency_ms", 0)
        updated["retrieved_chunks"] = result.get("retrieved_chunks", [])
        updated_sub_questions.append(updated)

        trace_step = result.get("trace_step")
        if trace_step:
            trace_steps.append(trace_step)

    total_latency = int((time.time() - start_time) * 1000)

    logger.info(
        "investigation_sub_questions_complete",
        count=len(results),
        total_latency_ms=total_latency,
    )

    existing_trace = state.get("reasoning_trace", [])
    return {
        "sub_questions": updated_sub_questions,
        "reasoning_trace": existing_trace + trace_steps,
    }


def _synthesize_node(state: InvestigationState) -> dict:
    """Synthesize all sub-question findings into a structured report."""
    start_time = time.time()
    query = state["query"]
    sub_questions = state.get("sub_questions", [])

    trace_step = ReasoningStep(
        phase="synthesize",
        title="Report Synthesis",
        description=f"Synthesizing {len(sub_questions)} sub-question findings into report",
        timestamp_ms=int(time.time() * 1000),
    )

    # Build findings text for LLM
    findings_parts = []
    for i, sq in enumerate(sub_questions):
        findings_parts.append(
            f"### Sub-question {i + 1}: {sq['question']}\n"
            f"Purpose: {sq.get('purpose', 'N/A')}\n"
            f"Finding: {sq.get('partial_answer', 'No finding available.')}\n"
        )

    sub_findings = "\n".join(findings_parts)

    try:
        prompt = SYNTHESIS_PROMPT.format(query=query, sub_findings=sub_findings)
        report = _run_llm(
            "You are a precise research report synthesizer. Be factual, well-structured, and grounded in evidence.",
            prompt,
            temperature=0.3,
            max_tokens=2048,
        )

        # Extract citations from the report and map them
        all_citations = []
        citation_map = {}
        citation_idx = 0
        for sq in sub_questions:
            for cit in sq.get("citations", []):
                citation_idx += 1
                citation_map[citation_idx] = cit
                all_citations.append(cit)

        trace_step.details = {
            "report_length": len(report),
            "total_citations": len(all_citations),
            "sub_questions_synthesized": len(sub_questions),
        }

        logger.info(
            "investigation_synthesized",
            report_length=len(report),
            citations=len(all_citations),
        )

        elapsed = int((time.time() - start_time) * 1000)
        trace_step.details["latency_ms"] = elapsed
        existing_trace = state.get("reasoning_trace", [])
        return {
            "final_report": report,
            "reasoning_trace": existing_trace + [asdict(trace_step)],
        }

    except Exception as e:
        logger.error("synthesis_failed", error=str(e))
        trace_step.details = {"error": str(e)}

        # Fallback: concatenate sub-answers
        fallback_parts = ["# Investigation Report\n"]
        for i, sq in enumerate(sub_questions):
            fallback_parts.append(f"## {sq['question']}\n")
            fallback_parts.append(f"{sq.get('partial_answer', 'No answer available.')}\n")

        report = "\n".join(fallback_parts)

        existing_trace = state.get("reasoning_trace", [])
        return {
            "final_report": report,
            "reasoning_trace": existing_trace + [asdict(trace_step)],
        }


def _trust_score_node(state: InvestigationState) -> dict:
    """Compute overall trust score from all sub-question signals."""
    start_time = time.time()
    sub_questions = state.get("sub_questions", [])

    trace_step = ReasoningStep(
        phase="evaluate",
        title="Trust Score Calculation",
        description="Computing overall trust score from all sub-question guardrail scores",
        timestamp_ms=int(time.time() * 1000),
    )

    # Aggregate retrieval results and guardrail scores from all sub-questions
    all_retrieval_results = []
    guardrail_passed_count = 0
    guardrail_scores = []

    for sq in sub_questions:
        chunks = sq.get("retrieved_chunks", [])
        for chunk in chunks:
            all_retrieval_results.append(chunk)
        if sq.get("guardrail_passed", False):
            guardrail_passed_count += 1
        sq_trust = sq.get("trust_score")
        if sq_trust is not None:
            guardrail_scores.append(sq_trust)

    # Build aggregate guardrail result
    avg_guardrail_score = sum(guardrail_scores) / len(guardrail_scores) if guardrail_scores else 0.5
    agg_guardrail = GuardrailResult(
        passed=guardrail_passed_count == len(sub_questions) if sub_questions else True,
        score=avg_guardrail_score,
        details=f"Aggregate across {len(sub_questions)} sub-questions: {guardrail_passed_count}/{len(sub_questions)} passed",
    )

    trust: TrustScoreComponents = asyncio.run(
        compute_trust(
            retrieval_results=all_retrieval_results,
            guardrail_result=agg_guardrail,
            query=state["query"],
        )
    )

    trace_step.details = {
        "overall": trust.overall,
        "retrieval_quality": trust.retrieval_quality,
        "faithfulness": trust.faithfulness,
        "relevance": trust.relevance,
        "source_authority": trust.source_authority,
        "sub_question_count": len(sub_questions),
        "guardrail_pass_rate": f"{guardrail_passed_count}/{len(sub_questions)}" if sub_questions else "N/A",
        "latency_ms": int((time.time() - start_time) * 1000),
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
        "reasoning_trace": existing_trace + [asdict(trace_step)],
    }


# ─── Graph Builder ────────────────────────────────────────────────────────────

def build_investigation_graph() -> CompiledStateGraph:
    """Build the agentic investigation graph.

    Flow:
        decompose → investigate (all sub-questions in parallel)
        → synthesize → compute_trust → END
    """
    workflow = StateGraph(InvestigationState)

    # Nodes
    workflow.add_node("decompose", _decompose_node)
    workflow.add_node("investigate", _investigate_node)
    workflow.add_node("synthesize", _synthesize_node)
    workflow.add_node("compute_trust", _trust_score_node)

    # Edges
    workflow.set_entry_point("decompose")
    workflow.add_edge("decompose", "investigate")
    workflow.add_edge("investigate", "synthesize")
    workflow.add_edge("synthesize", "compute_trust")
    workflow.add_edge("compute_trust", END)

    return workflow.compile()


# ─── Convenience Runner ───────────────────────────────────────────────────────

def run_investigation(
    query: str,
    workspace_id: str,
    user_id: str | None = None,
    query_id: str | None = None,
    top_k: int | None = None,
    filters: dict | None = None,
) -> dict[str, Any]:
    """Run the full investigation pipeline and return results.

    Args:
        query: Complex user question to investigate.
        workspace_id: Workspace ID to search within.
        user_id: Optional user ID.
        query_id: Optional query ID for tracking.
        top_k: Number of chunks to retrieve per sub-question.
        filters: Optional metadata filters.

    Returns:
        Dict with keys: final_report, trust_score, trust_components,
        reasoning_trace, sub_questions, error
    """
    start_time = time.time()

    graph = build_investigation_graph()

    initial_state: InvestigationState = {
        "query": query,
        "workspace_id": workspace_id,
        "user_id": user_id,
        "query_id": query_id or str(uuid.uuid4()),
        "top_k": top_k or settings.RETRIEVAL_TOP_K,
        "filters": filters,
        "sub_questions": [],
        "reasoning_trace": [],
        "final_report": None,
        "cited_spans": None,
        "trust_score": None,
        "trust_components": None,
        "model_used": settings.OLLAMA_PRIMARY_MODEL,
        "latency_ms": 0,
        "error": None,
    }

    try:
        result = graph.invoke(initial_state)

        total_latency = int((time.time() - start_time) * 1000)

        logger.info(
            "investigation_complete",
            query=query[:100],
            sub_questions=len(result.get("sub_questions", [])),
            trust_score=result.get("trust_score"),
            latency_ms=total_latency,
        )

        return {
            "final_report": result.get("final_report", ""),
            "trust_score": result.get("trust_score"),
            "trust_components": result.get("trust_components", {}),
            "reasoning_trace": result.get("reasoning_trace", []),
            "sub_questions": result.get("sub_questions", []),
            "latency_ms": total_latency,
            "error": result.get("error"),
        }

    except Exception as e:
        logger.error("investigation_failed", error=str(e), query=query[:100])
        total_latency = int((time.time() - start_time) * 1000)
        return {
            "final_report": f"Investigation failed: {e}",
            "trust_score": 0.0,
            "trust_components": {},
            "reasoning_trace": [],
            "sub_questions": [],
            "latency_ms": total_latency,
            "error": str(e),
        }
