"""Extended tests for guardrail — result classes, claim extraction, edge cases."""

from __future__ import annotations

import pytest

from app.generation.guardrail import GuardrailResult, _extract_claims


class TestGuardrailResult:
    """Test GuardrailResult edge cases."""

    def test_with_unsupported_claims(self):
        result = GuardrailResult(
            passed=False,
            score=0.3,
            unsupported_claims=["This claim is false."],
            details="1/3 claims unsupported",
        )
        assert result.passed is False
        assert result.score == 0.3
        assert len(result.unsupported_claims) == 1
        assert "1/3" in result.details

    def test_passed_true_with_high_score(self):
        result = GuardrailResult(passed=True, score=0.95)
        assert result.passed is True
        assert result.score == 0.95


class TestExtractClaims:
    """Test claim extraction edge cases."""

    def test_single_long_sentence(self):
        text = "This is a single very long sentence that should be extracted as one claim because it continues long enough to pass the minimum length threshold."
        claims = _extract_claims(text)
        assert len(claims) >= 1

    def test_multiple_sentences(self):
        text = "First claim about something. Second claim about something else. Third claim here."
        claims = _extract_claims(text)
        assert len(claims) >= 3

    def test_claims_with_source_markers(self):
        text = "[source:1] First claim. [source:2] Second claim."
        claims = _extract_claims(text)
        # Source markers shouldn't be claims themselves
        assert all(not c.startswith("[source") for c in claims)

    def test_newline_separated(self):
        text = "Line one is the first line. Line two is the second line. Line three is the third line."
        claims = _extract_claims(text)
        assert len(claims) >= 3

    def test_claims_short_fragments_filtered(self):
        text = "A. B. C. This is a sufficiently long claim here."
        claims = _extract_claims(text)
        assert all(len(c) > 15 for c in claims)

    def test_empty_after_filter(self):
        text = "A. B. C."
        claims = _extract_claims(text)
        # Empty or very short should return empty
        assert isinstance(claims, list)
        if claims:
            assert all(len(c) > 15 for c in claims)


class TestGuardrailCheck:
    """Test guardrail check edge cases.

    Note: Tests that load the NLI model (deberta-v3-base) require
    the model to be cached and compatible transformers version.
    """

    @pytest.mark.asyncio
    async def test_check_no_context_early_return(self):
        """Empty contexts list returns early (no model load)."""
        from app.generation.guardrail import check

        result = await check("Some answer.", [])
        assert result.passed is True
        assert result.score == 1.0
        assert "No answer or context" in result.details

    @pytest.mark.asyncio
    async def test_check_no_answer_early_return(self):
        """Empty answer returns early (no model load)."""
        from app.generation.guardrail import check

        result = await check("", [{"content": "test", "chunk_id": "c1"}])
        assert result.passed is True
        assert result.score == 1.0
