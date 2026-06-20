"""Tests for trust score computation."""

from __future__ import annotations

import pytest

from app.evaluation.trust_score import TrustScoreComponents, compute_trust
from app.generation.guardrail import GuardrailResult


@pytest.mark.asyncio
async def test_compute_empty():
    """Test trust score with no inputs."""
    trust = await compute_trust([])
    assert isinstance(trust, TrustScoreComponents)
    assert 0 <= trust.overall <= 1


@pytest.mark.asyncio
async def test_compute_with_guardrail():
    """Test trust score with guardrail result."""
    guardrail = GuardrailResult(passed=True, score=0.9)
    trust = await compute_trust(
        retrieval_results=[],
        guardrail_result=guardrail,
    )
    assert trust.faithfulness == 0.9
    assert 0 <= trust.overall <= 1


@pytest.mark.asyncio
async def test_compute_with_retrieval():
    """Test trust score with retrieval results."""
    trust = await compute_trust(
        retrieval_results=[
            {"chunk_id": "c1", "document_id": "d1", "score": 0.9},
            {"chunk_id": "c2", "document_id": "d2", "score": 0.8},
        ],
    )
    assert trust.retrieval_quality > 0
    assert 0 <= trust.overall <= 1


@pytest.mark.asyncio
async def test_compute_full():
    """Test trust score with all inputs."""
    guardrail = GuardrailResult(passed=True, score=0.95)
    trust = await compute_trust(
        retrieval_results=[
            {"chunk_id": "c1", "document_id": "d1", "score": 0.9},
            {"chunk_id": "c2", "document_id": "d2", "score": 0.85},
        ],
        guardrail_result=guardrail,
        generation_result=None,
        query="What is RAG?",
    )
    assert 0 <= trust.overall <= 1
    assert trust.faithfulness == 0.95
    assert trust.retrieval_quality > 0


def test_trust_score_components():
    """Test TrustScoreComponents initialization."""
    comp = TrustScoreComponents(
        retrieval_quality=0.8,
        faithfulness=0.9,
        relevance=0.7,
        source_authority=0.6,
        overall=0.75,
    )
    assert comp.retrieval_quality == 0.8
    assert comp.overall == 0.75
