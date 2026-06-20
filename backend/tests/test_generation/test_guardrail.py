"""Tests for guardrail."""

from __future__ import annotations

import pytest

from app.generation.guardrail import _extract_claims, GuardrailResult


def test_extract_claims_empty():
    """Test extracting claims from empty text."""
    claims = _extract_claims("")
    assert claims == []


def test_extract_claims_simple():
    """Test extracting claims from simple text."""
    text = "The sky is blue. Grass is green."
    claims = _extract_claims(text)
    assert len(claims) >= 1


def test_extract_claims_short():
    """Test filtering of very short fragments."""
    text = "Yes. No. The sky is blue."
    claims = _extract_claims(text)
    assert all(len(c) > 15 for c in claims)


def test_guardrail_result_defaults():
    """Test GuardrailResult default values."""
    result = GuardrailResult()
    assert result.passed is True
    assert result.score == 1.0
    assert result.unsupported_claims == []


@pytest.mark.asyncio
async def test_check_no_context():
    """Test guardrail check with no context."""
    from app.generation.guardrail import check

    result = await check("This is a test answer.", [])
    assert result.passed is True
    assert result.score == 1.0


@pytest.mark.asyncio
async def test_check_no_answer():
    """Test guardrail check with no answer."""
    from app.generation.guardrail import check

    result = await check("", [{"content": "Some context.", "chunk_id": "c1"}])
    assert result.passed is True
    assert result.score == 1.0
