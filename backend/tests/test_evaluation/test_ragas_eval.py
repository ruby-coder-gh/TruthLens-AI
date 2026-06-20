"""Tests for RAGAS evaluation."""

from __future__ import annotations

import pytest

from app.evaluation.ragas_eval import RagasScores, ragas_evaluate, evaluate_single


@pytest.mark.asyncio
async def test_ragas_evaluate_empty():
    """Test RAGAS evaluation with empty data."""
    scores = await ragas_evaluate([], [], [])
    assert isinstance(scores, RagasScores)


@pytest.mark.asyncio
async def test_evaluate_single():
    """Test single query evaluation."""
    scores = await evaluate_single(
        query="What is RAG?",
        answer="RAG stands for Retrieval Augmented Generation.",
        contexts=["RAG is a technique for augmenting LLMs with retrieval."],
    )
    assert isinstance(scores, RagasScores)


def test_ragas_scores_defaults():
    """Test RagasScores default values."""
    scores = RagasScores()
    assert scores.faithfulness is None
    assert scores.answer_relevance is None


def test_ragas_scores_custom():
    """Test RagasScores with values."""
    scores = RagasScores(
        faithfulness=0.8,
        answer_relevance=0.7,
        context_precision=0.9,
        context_recall=0.85,
        answer_correctness=0.75,
    )
    assert scores.faithfulness == 0.8
    assert scores.answer_correctness == 0.75
