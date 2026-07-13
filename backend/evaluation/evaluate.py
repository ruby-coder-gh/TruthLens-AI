"""Golden dataset evaluation runner.

Evaluates the RAG pipeline against a golden dataset using custom quality metrics.
Supports single-model eval, multi-model comparison, and structured report output.

Usage:
    Single model:
        python -m evaluation.evaluate --model qwen3:4b

    Multi-model comparison:
        python -m evaluation.evaluate --compare qwen3:4b,qwen3:8b

    Full suite:
        python -m evaluation.evaluate --all --output results.json
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any


def _golden_set_version() -> str | None:
    """Short content hash of the golden dataset source file (stamps EvalRun)."""
    try:
        dataset_path = Path(__file__).resolve().parent / "golden_dataset.py"
        return hashlib.sha1(dataset_path.read_bytes()).hexdigest()[:12]
    except Exception:
        return None


def _mean(values: list[float]) -> float | None:
    """Mean of a list, or None when empty (never divide by zero)."""
    return sum(values) / len(values) if values else None


def _per_category_breakdown(results: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate count + mean faithfulness/relevance + refusal rate per category.

    ``category`` (answerable / unanswerable / ambiguous) is stamped onto each
    per-entry result by ``evaluate_pipeline``. Entries that errored (no
    ``metrics``) are counted but excluded from the metric means.

    Key names (``faithfulness``, ``answer_relevance``, ``refusal_accuracy``)
    match the frontend's ``EvalCategoryBreakdown`` contract (see
    frontend/src/api/types.ts + AdminAnalyticsPage.tsx's
    ``CATEGORY_METRIC_LABELS``) so the per-category table renders friendly
    labels instead of falling back to raw key names.
    """
    buckets: dict[str, dict[str, Any]] = {}
    for r in results:
        category = r.get("category") or "unknown"
        bucket = buckets.setdefault(
            category,
            {"count": 0, "word_f1": [], "guardrail_score": [], "unanswerable_total": 0, "refused_total": 0},
        )
        bucket["count"] += 1

        metrics = r.get("metrics")
        if metrics:
            bucket["word_f1"].append(metrics.get("word_f1", 0.0))
            bucket["guardrail_score"].append(metrics.get("guardrail_score", 0.0))

        if r.get("expected_grounding") is False:
            bucket["unanswerable_total"] += 1
            if r.get("guardrail_passed") is False or "cannot" in (r.get("answer", "") or "").lower():
                bucket["refused_total"] += 1

    summary: dict[str, Any] = {}
    for category, bucket in buckets.items():
        unanswerable_total = bucket["unanswerable_total"]
        summary[category] = {
            "count": bucket["count"],
            "faithfulness": _mean(bucket["guardrail_score"]),
            "answer_relevance": _mean(bucket["word_f1"]),
            "refusal_accuracy": (
                bucket["refused_total"] / unanswerable_total if unanswerable_total else None
            ),
        }
    return summary


async def _persist_eval_run(summary: dict[str, Any]) -> str | None:
    """Insert one EvalRun row from a pipeline summary.

    Self-contained and best-effort: reuses the app's async session factory,
    maps the pipeline's aggregate metrics onto the six EvalRun columns, and
    never raises into the caller (a persistence failure must not fail a run
    that already produced its JSON output). Returns the new row id or None.
    """
    try:
        from app.config import settings
        from app.database import async_session_factory, engine
        from app.models.eval_run import EvalRun

        # Ensure the eval_runs table exists (self-contained; no Alembic needed
        # for a standalone eval run against a fresh DB).
        async with engine.begin() as conn:
            await conn.run_sync(EvalRun.__table__.create, checkfirst=True)

        results = summary.get("results", [])
        # Refusal accuracy: over unanswerable entries (empty source_documents /
        # a "cannot be answered" reference), did the guardrail flag the answer
        # as unsupported? Recomputed here from per-entry data.
        unanswerable = [r for r in results if r.get("expected_grounding") is False]
        refused = sum(
            1
            for r in unanswerable
            if r.get("guardrail_passed") is False
            or "cannot" in (r.get("answer", "") or "").lower()
        )
        refusal_accuracy = refused / len(unanswerable) if unanswerable else None

        ragas_scores = summary.get("ragas_scores") or {}

        breakdown = {
            "model": summary.get("model"),
            "total": summary.get("total_entries"),
            "completed": summary.get("completed"),
            "failed": summary.get("failed"),
            "avg_word_f1": summary.get("avg_word_f1"),
            "guardrail_pass_rate": summary.get("guardrail_pass_rate"),
            "unanswerable_total": len(unanswerable),
            "refused_total": refused,
            "ragas_scores": ragas_scores,
            "per_category": _per_category_breakdown(results),
            "thresholds": {
                "min_faithfulness": settings.EVAL_MIN_FAITHFULNESS,
                "min_trust": settings.EVAL_MIN_TRUST,
                "min_context_precision": settings.EVAL_MIN_CONTEXT_PRECISION,
                "refusal_accuracy_min": settings.EVAL_REFUSAL_ACCURACY_MIN,
            },
        }

        # Ragas faithfulness supersedes the guardrail-derived value when present
        # (a "better" signal per the eval contract); fall back to the
        # word-F1/guardrail metrics otherwise (graceful degradation when the
        # `ragas` package is absent).
        faithfulness = ragas_scores.get("faithfulness")
        if faithfulness is None:
            faithfulness = summary.get("avg_guardrail_score")

        answer_relevance = ragas_scores.get("answer_relevance")
        if answer_relevance is None:
            answer_relevance = summary.get("avg_word_f1")

        async with async_session_factory() as session:
            row = EvalRun(
                faithfulness=faithfulness,
                context_precision=ragas_scores.get("context_precision"),
                context_recall=ragas_scores.get("context_recall"),
                answer_relevance=answer_relevance,
                answer_correctness=ragas_scores.get("answer_correctness"),
                refusal_accuracy=refusal_accuracy,
                golden_set_version=_golden_set_version(),
                notes=json.dumps(breakdown, default=str),
            )
            session.add(row)
            await session.commit()
            await session.refresh(row)
            print(f"  💾 EvalRun persisted: id={row.id} (version={row.golden_set_version})")
            return row.id
    except Exception as e:  # noqa: BLE001 — best-effort persistence
        print(f"  ⚠ EvalRun persistence skipped: {e}")
        return None


def _generate_html_report(all_results: list[dict[str, Any]]) -> str:
    """Generate an HTML report from benchmark results."""
    rows = ""
    for r in all_results:
        model = r.get("model", "?")
        entries = r.get("completed", 0)
        f1 = r.get("avg_word_f1", 0)
        guardrail = r.get("avg_guardrail_score", 0)
        pass_rate = r.get("guardrail_pass_rate", 0)
        time_s = r.get("total_time_s", 0)
        per_entry = r.get("avg_time_per_entry_s", 0)

        # Per-entry breakdown
        detail_rows = ""
        for entry in r.get("results", []):
            m = entry.get("metrics", {})
            status = "✅" if entry.get("guardrail_passed") else "⚠️"
            err = entry.get("error")
            if err:
                detail_rows += f"""<tr><td>{entry['id']}</td><td colspan="5" style="color:red">ERROR: {err}</td></tr>"""
            else:
                detail_rows += f"""<tr>
                    <td>{entry['id']}</td>
                    <td>{status}</td>
                    <td>{m.get('word_f1', 0):.4f}</td>
                    <td>{m.get('word_precision', 0):.4f}</td>
                    <td>{m.get('word_recall', 0):.4f}</td>
                    <td>{m.get('guardrail_score', 0):.4f}</td>
                </tr>"""

        rows += f"""
        <div class="model-section">
            <h2>{model}</h2>
            <table class="summary">
                <tr><th>Entries</th><th>Avg F1</th><th>Avg Guardrail</th><th>Pass Rate</th><th>Total Time</th><th>Per Entry</th></tr>
                <tr>
                    <td>{entries}/{r.get('total_entries', 0)}</td>
                    <td class="{'good' if f1 > 0.5 else 'warn' if f1 > 0.3 else 'bad'}">{f1:.4f}</td>
                    <td class="{'good' if guardrail > 0.7 else 'warn' if guardrail > 0.5 else 'bad'}">{guardrail:.4f}</td>
                    <td class="{'good' if pass_rate > 0.8 else 'warn'}">{pass_rate:.1%}</td>
                    <td>{time_s:.1f}s</td>
                    <td>{per_entry:.2f}s</td>
                </tr>
            </table>
            <table class="details">
                <tr><th>ID</th><th>Status</th><th>F1</th><th>Precision</th><th>Recall</th><th>Guardrail</th></tr>
                {detail_rows}
            </table>
        </div>"""

    # Comparison table (multi-model)
    comparison_rows = ""
    if len(all_results) > 1:
        for r in all_results:
            comparison_rows += f"""<tr>
                <td>{r.get('model', '?')}</td>
                <td>{r.get('avg_word_f1', 0):.4f}</td>
                <td>{r.get('avg_guardrail_score', 0):.4f}</td>
                <td>{r.get('guardrail_pass_rate', 0):.1%}</td>
                <td>{r.get('avg_time_per_entry_s', 0):.2f}s</td>
            </tr>"""

        comparison = f"""
        <div class="model-section">
            <h2>Model Comparison</h2>
            <table class="summary">
                <tr><th>Model</th><th>Avg F1</th><th>Avg Guardrail</th><th>Pass Rate</th><th>Per Entry</th></tr>
                {comparison_rows}
            </table>
        </div>"""
    else:
        comparison = ""

    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>VeritasRAG Benchmark Report</title>
<style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 1000px; margin: 0 auto; padding: 20px; background: #f5f5f5; }}
    h1 {{ color: #333; }}
    .model-section {{ background: white; border-radius: 8px; padding: 20px; margin: 20px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
    table {{ width: 100%; border-collapse: collapse; margin: 10px 0; }}
    th, td {{ padding: 8px 12px; text-align: left; border-bottom: 1px solid #eee; }}
    th {{ background: #f8f9fa; font-weight: 600; }}
    .good {{ color: #2e7d32; font-weight: 600; }}
    .warn {{ color: #e65100; font-weight: 600; }}
    .bad {{ color: #c62828; font-weight: 600; }}
    .timestamp {{ color: #666; font-size: 0.9em; }}
    .summary td {{ font-size: 1.1em; }}
</style>
</head>
<body>
    <h1>VeritasRAG Benchmark Report</h1>
    <p class="timestamp">Generated: {datetime.now().isoformat()}</p>
    {comparison}
    {rows}
</body>
</html>"""


def _print_terminal_report(summary: dict[str, Any]) -> None:
    """Print a formatted terminal report."""
    print(f"\n{'='*55}")
    print(f"  Benchmark: {summary['model']}")
    print(f"{'='*55}")
    print(f"  Entries:     {summary['completed']}/{summary['total_entries']} completed")
    print(f"  Failures:    {summary['failed']}")
    print(f"  Avg Word F1: {summary['avg_word_f1']:.4f}")
    print(f"  Avg Guardrail: {summary['avg_guardrail_score']:.4f}")
    print(f"  Pass Rate:   {summary['guardrail_pass_rate']:.1%}")
    print(f"  Total Time:  {summary['total_time_s']:.1f}s")
    print(f"  Per Entry:   {summary['avg_time_per_entry_s']:.2f}s")
    print(f"{'='*55}")

    print("\n  Per-Entry Results:")
    print(f"  {'ID':<10} {'Status':<8} {'F1':<8} {'Prec':<8} {'Recall':<8} {'Guard':<8}")
    print(f"  {'-'*50}")
    for entry in summary.get("results", []):
        m = entry.get("metrics", {})
        status = "✅" if entry.get("guardrail_passed") else "⚠"
        err = entry.get("error")
        if err:
            print(f"  {entry['id']:<10} {'❌':<8} ERROR: {err}")
        else:
            print(f"  {entry['id']:<10} {status:<8} {m.get('word_f1', 0):<8.4f} {m.get('word_precision', 0):<8.4f} {m.get('word_recall', 0):<8.4f} {m.get('guardrail_score', 0):<8.4f}")


async def evaluate_pipeline(
    ollama_url: str = "http://localhost:11434",
    model: str = "qwen3:4b",
    limit: int | None = None,
) -> dict[str, Any]:
    """Run golden dataset evaluation against the RAG pipeline.

    Args:
        ollama_url: Ollama server URL.
        model: LLM model name.
        limit: Max number of golden entries to evaluate.

    Returns:
        Dict with scores and per-entry results.
    """
    from app.config import settings
    from app.generation.generator import GenerationInput, generate as generate_answer
    from app.generation.guardrail import check as guardrail_check

    settings.OLLAMA_BASE_URL = ollama_url
    settings.OLLAMA_PRIMARY_MODEL = model

    # Import inside function to avoid import-order issues
    import sys
    from pathlib import Path as _Path
    eval_dir = _Path(__file__).parent
    if str(eval_dir) not in sys.path:
        sys.path.insert(0, str(eval_dir))

    from golden_dataset import get_golden_dataset
    dataset = get_golden_dataset()
    if limit:
        dataset = dataset[:limit]

    results: list[dict[str, Any]] = []
    total_start = time.time()

    print(f"\nEvaluating {len(dataset)} queries against {model}...\n")

    for entry in dataset:
        entry_start = time.time()
        query = entry.question
        ground_truth = entry.reference_answer
        entry_id = entry.notes.split("]")[0].lstrip("[").strip() if "]" in entry.notes else "??"

        print(f"  [{entry_id}] {query[:60]}...", end=" ")

        try:
            gen_input = GenerationInput(
                query=query,
                contexts=[{"content": ground_truth, "chunk_id": "gd-ref", "score": 1.0}],
            )
            gen_result = await generate_answer(gen_input)

            guardrail = await guardrail_check(
                gen_result.text,
                [{"content": ground_truth}],
            )

            entry_time = time.time() - entry_start

            answer_words = set(gen_result.text.lower().split())
            gt_words = set(ground_truth.lower().split())
            overlap = len(answer_words & gt_words)
            precision = overlap / len(answer_words) if answer_words else 0
            recall = overlap / len(gt_words) if gt_words else 0
            f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

            results.append({
                "id": entry_id,
                "query": query,
                "answer": gen_result.text[:500],
                "guardrail_passed": guardrail.passed,
                "expected_grounding": entry.expected_grounding,
                "category": entry.category,
                "ground_truth": ground_truth,
                "full_answer": gen_result.text,
                "metrics": {
                    "word_f1": round(f1, 4),
                    "word_precision": round(precision, 4),
                    "word_recall": round(recall, 4),
                    "guardrail_score": round(guardrail.score, 4),
                },
                "latency_s": round(entry_time, 2),
                "error": None,
            })

            status = "✓" if guardrail.passed else "⚠"
            print(f"{status} f1={f1:.3f} guardrail={guardrail.score:.3f} ({entry_time:.1f}s)")

        except Exception as e:
            results.append({
                "id": entry_id,
                "query": query,
                "category": entry.category,
                "expected_grounding": entry.expected_grounding,
                "error": str(e),
            })
            print(f"✗ ERROR: {e}")

    total_time = time.time() - total_start

    valid_results = [r for r in results if r.get("metrics")]
    n = len(valid_results) or 1
    avg_f1 = sum(r["metrics"]["word_f1"] for r in valid_results) / n
    avg_guardrail = sum(r["metrics"]["guardrail_score"] for r in valid_results) / n
    pass_rate = sum(1 for r in valid_results if r["guardrail_passed"]) / n

    # RAGAS metrics: computed once over the answerable entries that produced
    # an answer (unanswerable entries have no meaningful "ground truth
    # context" to score context precision/recall against). Degrades to all
    # None when the `ragas` package is missing or errors — never raises.
    ragas_scores: dict[str, float | None] = {}
    answerable_valid = [r for r in valid_results if r.get("category") == "answerable"]
    if answerable_valid:
        from app.evaluation.ragas_eval import ragas_evaluate

        ragas_result = await ragas_evaluate(
            queries=[r["query"] for r in answerable_valid],
            answers=[r.get("full_answer", r["answer"]) for r in answerable_valid],
            contexts=[[r.get("ground_truth", "")] for r in answerable_valid],
            ground_truth=[r.get("ground_truth", "") for r in answerable_valid],
        )
        ragas_scores = {
            "faithfulness": ragas_result.faithfulness,
            "answer_relevance": ragas_result.answer_relevance,
            "context_precision": ragas_result.context_precision,
            "context_recall": ragas_result.context_recall,
            "answer_correctness": ragas_result.answer_correctness,
        }

    summary = {
        "model": model,
        "total_entries": len(dataset),
        "completed": len(valid_results),
        "failed": len(dataset) - len(valid_results),
        "avg_word_f1": round(avg_f1, 4),
        "avg_guardrail_score": round(avg_guardrail, 4),
        "guardrail_pass_rate": round(pass_rate, 4),
        "total_time_s": round(total_time, 2),
        "avg_time_per_entry_s": round(total_time / len(dataset), 2) if dataset else 0,
        "results": results,
        "ragas_scores": ragas_scores,
        "timestamp": datetime.now().isoformat(),
    }

    _print_terminal_report(summary)

    # Persist an EvalRun row alongside the JSON output (best-effort).
    await _persist_eval_run(summary)

    return summary


def main():
    parser = argparse.ArgumentParser(description="Evaluate RAG pipeline against golden dataset")
    parser.add_argument("--ollama-url", default="http://localhost:11434", help="Ollama URL")
    parser.add_argument("--model", default="qwen3:4b", help="Model to test")
    parser.add_argument("--compare", default=None, help="Comma-separated models to compare")
    parser.add_argument("--all", action="store_true", help="Run all available models")
    parser.add_argument("--limit", type=int, default=None, help="Limit entries")
    parser.add_argument("--output", default=None, help="Output JSON/HTML file path")

    args = parser.parse_args()

    # Determine models to run
    models_to_test = []
    if args.all:
        models_to_test = ["qwen3:4b", "qwen3:8b", "llama3.1:8b"]
    elif args.compare:
        models_to_test = [m.strip() for m in args.compare.split(",")]
    elif args.model:
        models_to_test = [args.model]

    all_results = []
    for model in models_to_test:
        summary = asyncio.run(evaluate_pipeline(
            ollama_url=args.ollama_url,
            model=model,
            limit=args.limit,
        ))
        all_results.append(summary)

    # Output handling
    if args.output and all_results:
        ext = Path(args.output).suffix.lower()

        if ext == ".html":
            html = _generate_html_report(all_results)
            Path(args.output).write_text(html)
            print(f"\n📄 HTML report saved to {args.output}")
        else:
            data = all_results[0] if len(all_results) == 1 else all_results
            with open(args.output, "w") as f:
                json.dump(data, f, indent=2, default=str)
            print(f"\n📄 JSON saved to {args.output}")


if __name__ == "__main__":
    main()
