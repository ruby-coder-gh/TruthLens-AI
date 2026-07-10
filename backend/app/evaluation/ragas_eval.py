"""RAGAS evaluation interface for quality metrics."""

from __future__ import annotations


from app.utils.logger import logger


class RagasScores:
    """RAGAS evaluation scores."""

    def __init__(
        self,
        faithfulness: float | None = None,
        answer_relevance: float | None = None,
        context_precision: float | None = None,
        context_recall: float | None = None,
        answer_correctness: float | None = None,
    ) -> None:
        self.faithfulness = faithfulness
        self.answer_relevance = answer_relevance
        self.context_precision = context_precision
        self.context_recall = context_recall
        self.answer_correctness = answer_correctness


async def ragas_evaluate(
    queries: list[str],
    answers: list[str],
    contexts: list[list[str]],
    ground_truth: list[str] | None = None,
) -> RagasScores:
    """Evaluate RAG pipeline quality using RAGAS metrics.

    Args:
        queries: List of query strings.
        answers: List of generated answer strings.
        contexts: List of lists of context strings.
        ground_truth: Optional list of ground truth answer strings.

    Returns:
        RagasScores object.
    """
    try:
        from ragas import evaluate
        from ragas.metrics import (
            faithfulness,
            answer_relevancy,
            context_precision,
            context_recall,
        )
        from datasets import Dataset

        data = {
            "question": queries,
            "answer": answers,
            "contexts": contexts,
        }
        if ground_truth:
            data["ground_truth"] = ground_truth

        dataset = Dataset.from_dict(data)

        metrics = [
            faithfulness,
            answer_relevancy,
            context_precision,
            context_recall,
        ]

        result = evaluate(dataset, metrics=metrics)

        scores = RagasScores(
            faithfulness=result.get("faithfulness"),
            answer_relevance=result.get("answer_relevancy"),
            context_precision=result.get("context_precision"),
            context_recall=result.get("context_recall"),
        )

        logger.info("ragas_evaluation_complete", scores=vars(scores))
        return scores

    except ImportError:
        logger.warning("ragas_evaluate_failed", error="ragas package not installed — returning None scores")
        return RagasScores()
    except Exception as e:
        logger.error("ragas_evaluate_failed", error=str(e))
        return RagasScores()


async def evaluate_single(
    query: str,
    answer: str,
    contexts: list[str],
    ground_truth: str | None = None,
) -> RagasScores:
    """Evaluate a single query-answer pair.

    Args:
        query: User query.
        answer: Generated answer.
        contexts: Retrieved context strings.
        ground_truth: Optional ground truth.

    Returns:
        RagasScores for this pair.
    """
    return await ragas_evaluate(
        queries=[query],
        answers=[answer],
        contexts=[contexts],
        ground_truth=[ground_truth] if ground_truth else None,
    )
