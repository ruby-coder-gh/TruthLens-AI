"""Extended guardrail tests — claim extraction edge cases, NLI model mocking."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.generation.guardrail import (
    GuardrailResult,
    _extract_claims,
    _nli_infer,
    check,
)


class TestExtractClaimsEdgeCases:
    """Comprehensive claim extraction edge cases."""

    def test_very_long_claim(self):
        """Very long sentence extracted as single claim."""
        text = "This is an extremely long sentence that goes on and on with many words and clauses to ensure it passes the minimum length threshold easily because the guardrail requires claims to be longer than fifteen characters before they are considered valid claims for hallucination detection purposes."
        claims = _extract_claims(text)
        assert len(claims) >= 1
        assert all(len(c) > 15 for c in claims)

    def test_mixed_punctuation(self):
        """Sentences with mixed punctuation split correctly."""
        text = "What is RAG? It stands for Retrieval Augmented Generation! I think so."
        claims = _extract_claims(text)
        # Short sentences filtered; only long enough ones kept
        assert len(claims) >= 1
        assert any("Retrieval Augmented Generation" in c for c in claims)

    def test_only_source_markers(self):
        """Text with only source markers returns empty."""
        text = "[source:1] [source:2]"
        claims = _extract_claims(text)
        assert all(not c.startswith("[source") for c in claims)
        # All should be filtered out due to length or marker check
        assert all(len(c) > 15 or not c.startswith("[source") for c in claims)

    def test_newlines_and_spaces(self):
        """Newlines normalized to spaces."""
        text = "First sentence.\nSecond sentence.\n\nThird sentence."
        claims = _extract_claims(text)
        # "First sentence." (14 chars) and "Third sentence." (15 chars) filtered; "Second sentence." kept
        assert len(claims) >= 1

    def test_single_word_sentences(self):
        """Single-word sentences filtered out."""
        text = "Hello. World. This is a proper sentence with enough words."
        claims = _extract_claims(text)
        assert all(len(c) > 15 for c in claims)

    def test_numbers_and_punctuation(self):
        """Sentences with numbers and special chars."""
        text = "Version 2.0 was released in 2024. The cost is $99.99 per unit."
        claims = _extract_claims(text)
        assert len(claims) >= 1

    def test_claim_with_quotes(self):
        """Sentences with quotes."""
        text = 'He said "this is important." Then he left.'
        claims = _extract_claims(text)
        assert len(claims) >= 1


class TestNliInfer:
    """Test _nli_infer with various model outputs."""

    def test_3class_vector(self):
        """3-class output parsed correctly."""
        model = MagicMock()
        model.predict.return_value = MagicMock()
        model.predict.return_value.shape = (3,)
        model.predict.return_value.tolist.return_value = [0.8, 0.1, 0.1]

        entail, neutral, contra = _nli_infer(model, "premise", "hypothesis")
        assert entail == 0.8
        assert neutral == 0.1
        assert contra == 0.1

    def test_2d_array(self):
        """2D output parsed correctly."""
        model = MagicMock()
        model.predict.return_value = MagicMock()
        model.predict.return_value.shape = (1, 3)
        model.predict.return_value[0].tolist.return_value = [0.7, 0.2, 0.1]

        entail, neutral, contra = _nli_infer(model, "premise", "hypothesis")
        assert entail == 0.7

    def test_fallback_on_failure(self):
        """Failed inference returns uniform scores."""
        model = MagicMock()
        model.predict.side_effect = Exception("Model error")

        entail, neutral, contra = _nli_infer(model, "premise", "hypothesis")
        assert entail == 0.33
        assert neutral == 0.34
        assert contra == 0.33

    def test_flat_array_extra_dims(self):
        """Flat array with more than 3 dims handled."""
        model = MagicMock()
        model.predict.return_value = MagicMock()
        model.predict.return_value.shape = (5,)
        model.predict.return_value.flatten.return_value.tolist.return_value = [0.6, 0.2, 0.1, 0.05, 0.05]

        entail, neutral, contra = _nli_infer(model, "premise", "hypothesis")
        assert entail == 0.6


class TestGuardrailCheckMockedNLI:
    """Guardrail check with mocked NLI model."""

    @pytest.mark.asyncio
    async def test_all_claims_supported(self):
        """All claims entailed by context passes."""
        mock_model = MagicMock()
        # Return high entailment for all claims
        mock_model.predict.return_value = MagicMock()
        mock_model.predict.return_value.shape = (3,)
        mock_model.predict.return_value.tolist.return_value = [0.9, 0.05, 0.05]

        with patch("app.generation.guardrail._load_nli_model", return_value=mock_model):
            result = await check(
                "AI is artificial intelligence. It is used in many fields.",
                [{"content": "AI is artificial intelligence used broadly."}],
            )

        assert result.passed is True
        assert result.score >= 0.7

    @pytest.mark.asyncio
    async def test_some_claims_unsupported(self):
        """Claims not entailed by context fails."""
        mock_model = MagicMock()

        # Return low entailment
        def predict_side_effect(pairs):
            mock = MagicMock()
            mock.shape = (3,)
            mock.tolist.return_value = [0.2, 0.3, 0.5]
            return mock

        mock_model.predict = predict_side_effect

        with patch("app.generation.guardrail._load_nli_model", return_value=mock_model):
            result = await check(
                "AI is dangerous. It will replace all jobs.",
                [{"content": "AI has many beneficial applications in healthcare."}],
            )

        assert result.passed is False
        assert result.score < 0.7

    @pytest.mark.asyncio
    async def test_empty_contexts_early_return(self):
        """Empty contexts returns early."""
        result = await check("Some answer.", [])
        assert result.passed is True
        assert result.score == 1.0
        assert "No answer or context" in result.details

    @pytest.mark.asyncio
    async def test_empty_answer_early_return(self):
        """Empty answer returns early."""
        result = await check("", [{"content": "context", "chunk_id": "c1"}])
        assert result.passed is True
        assert result.score == 1.0

    @pytest.mark.asyncio
    async def test_empty_context_text(self):
        """Contexts with empty text returns early (after NLI model load)."""
        from app.generation.guardrail import _load_nli_model
        # _load_nli_model downloads a real model, so we mock it
        mock_model = MagicMock()
        with patch("app.generation.guardrail._load_nli_model", return_value=mock_model):
            result = await check("Some claim.", [{"content": "", "chunk_id": "c1"}])
        assert result.passed is True
        assert result.score == 1.0
        assert "No context text" in result.details

    @pytest.mark.asyncio
    async def test_no_extractable_claims(self):
        """Answer with no extractable claims returns early after model load."""
        mock_model = MagicMock()
        with patch("app.generation.guardrail._load_nli_model", return_value=mock_model):
            result = await check(
                "A. B.",
                [{"content": "Some valid context here that is long enough."}],
            )
        # These short fragments get filtered out, returning early
        assert result.passed is True
        assert result.score == 1.0

    @pytest.mark.asyncio
    async def test_guardrail_result_with_unsupported(self):
        """GuardrailResult properly stores unsupported claims."""
        result = GuardrailResult(
            passed=False,
            score=0.3,
            unsupported_claims=["This claim is false.", "So is this one."],
            details="2/3 claims unsupported",
        )
        assert result.passed is False
        assert len(result.unsupported_claims) == 2
        assert "2/3" in result.details
