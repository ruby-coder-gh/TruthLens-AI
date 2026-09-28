"""Tests for guardrail.nli_batch — batched NLI over premise/hypothesis pairs."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from app.generation.guardrail import nli_batch


class TestNliBatch:
    def test_empty_input_returns_empty_list(self):
        """No pairs -> no model call, empty result."""
        with patch("app.generation.guardrail._load_nli_model") as mock_load:
            result = nli_batch([])
        assert result == []
        mock_load.assert_not_called()

    def test_orders_each_result_entailment_neutral_contradiction(self):
        """Each row's raw logits [contradiction, entailment, neutral] softmax
        and reorder to (entailment, neutral, contradiction), same as _nli_infer."""
        mock_model = MagicMock()
        # Two pairs: first entailment-dominant, second contradiction-dominant.
        mock_model.predict.return_value = np.array(
            [
                [0.0, 2.0, 1.0],  # contradiction, entailment, neutral
                [2.0, 0.0, 1.0],
            ]
        )

        with patch("app.generation.guardrail._load_nli_model", return_value=mock_model):
            result = nli_batch([("premise a", "hyp a"), ("premise b", "hyp b")])

        assert len(result) == 2
        entail_0, neutral_0, contra_0 = result[0]
        assert entail_0 > contra_0 and entail_0 > neutral_0
        entail_1, neutral_1, contra_1 = result[1]
        assert contra_1 > entail_1 and contra_1 > neutral_1
        for triple in result:
            assert sum(triple) == pytest.approx(1.0, abs=1e-6)

    def test_calls_predict_exactly_once_for_whole_batch(self):
        """One model.predict call covers every pair — not one call per pair."""
        mock_model = MagicMock()
        mock_model.predict.return_value = np.array([[0.0, 2.0, 1.0]] * 5)

        with patch("app.generation.guardrail._load_nli_model", return_value=mock_model):
            result = nli_batch([(f"p{i}", f"h{i}") for i in range(5)])

        assert len(result) == 5
        assert mock_model.predict.call_count == 1
        # The batch call receives all 5 pairs at once.
        call_args = mock_model.predict.call_args[0][0]
        assert len(call_args) == 5

    def test_model_none_returns_uniform_fallback(self):
        """_load_nli_model() -> None falls back to uniform scores per pair, no crash."""
        with patch("app.generation.guardrail._load_nli_model", return_value=None):
            result = nli_batch([("p1", "h1"), ("p2", "h2")])

        assert result == [(0.33, 0.34, 0.33), (0.33, 0.34, 0.33)]

    def test_wrong_row_count_returns_uniform_fallback(self):
        """A malformed predict() (rows != pairs) must not misalign scores with pairs."""
        mock_model = MagicMock()
        mock_model.predict.return_value = np.array([[0.0, 2.0, 1.0]])

        with patch("app.generation.guardrail._load_nli_model", return_value=mock_model):
            result = nli_batch([("p1", "h1"), ("p2", "h2")])

        assert result == [(0.33, 0.34, 0.33)] * 2

    def test_predict_error_returns_uniform_fallback(self):
        """predict() raising falls back to uniform scores per pair, no crash."""
        mock_model = MagicMock()
        mock_model.predict.side_effect = RuntimeError("boom")

        with patch("app.generation.guardrail._load_nli_model", return_value=mock_model):
            result = nli_batch([("p1", "h1"), ("p2", "h2"), ("p3", "h3")])

        assert result == [(0.33, 0.34, 0.33)] * 3
