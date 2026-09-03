"""Evidence-sufficiency gate: verdicts, abstention text, and threshold calibration."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.config import settings


def _result(rerank_score=None, final_score=0.0, document_id="doc-1", **extra):
    return SimpleNamespace(
        chunk_id="chunk",
        document_id=document_id,
        content="text",
        score=final_score,
        final_score=final_score,
        rerank_score=rerank_score,
        metadata={},
        **extra,
    )


class TestAssessSufficiency:
    def test_empty_results_are_never_sufficient(self):
        from app.retrieval.sufficiency import assess_sufficiency

        verdict = assess_sufficiency([], min_score=0.35, min_supporting=1)

        assert verdict.sufficient is False
        assert verdict.reason == "no_results"
        assert verdict.top_score == 0.0
        assert verdict.searched_count == 0
        assert verdict.document_count == 0
        assert verdict.supporting_count == 0

    def test_a_strong_rerank_hit_is_sufficient(self):
        from app.retrieval.sufficiency import assess_sufficiency

        verdict = assess_sufficiency(
            [_result(rerank_score=0.91), _result(rerank_score=0.02)],
            min_score=0.35,
            min_supporting=1,
        )

        assert verdict.sufficient is True
        assert verdict.reason == "sufficient"
        assert verdict.top_score == 0.91
        assert verdict.supporting_count == 1
        assert verdict.searched_count == 2

    def test_scores_below_the_floor_abstain(self):
        from app.retrieval.sufficiency import assess_sufficiency

        verdict = assess_sufficiency(
            [_result(rerank_score=0.12), _result(rerank_score=0.03)],
            min_score=0.35,
            min_supporting=1,
        )

        assert verdict.sufficient is False
        assert verdict.reason == "low_relevance"
        assert verdict.top_score == 0.12
        assert verdict.supporting_count == 0

    def test_a_score_exactly_on_the_floor_counts_as_supporting(self):
        from app.retrieval.sufficiency import assess_sufficiency

        verdict = assess_sufficiency([_result(rerank_score=0.35)], min_score=0.35, min_supporting=1)

        assert verdict.sufficient is True

    def test_requiring_more_supporting_chunks_than_available_abstains(self):
        from app.retrieval.sufficiency import assess_sufficiency

        verdict = assess_sufficiency(
            [_result(rerank_score=0.90), _result(rerank_score=0.05)],
            min_score=0.35,
            min_supporting=2,
        )

        assert verdict.sufficient is False
        assert verdict.reason == "too_few_supporting"
        assert verdict.supporting_count == 1

    def test_falls_back_to_final_score_when_the_reranker_gave_none(self):
        """rerank() copies the hybrid score into rerank_score on failure, but a
        cached/context dict may carry only final_score."""
        from app.retrieval.sufficiency import assess_sufficiency

        verdict = assess_sufficiency([_result(rerank_score=None, final_score=0.80)], min_score=0.35, min_supporting=1)

        assert verdict.sufficient is True
        assert verdict.top_score == 0.80

    def test_accepts_context_dicts_as_well_as_result_objects(self):
        from app.retrieval.sufficiency import assess_sufficiency

        verdict = assess_sufficiency(
            [{"document_id": "doc-1", "rerank_score": 0.7}, {"document_id": "doc-2", "score": 0.9}],
            min_score=0.35,
            min_supporting=1,
        )

        assert verdict.sufficient is True
        assert verdict.document_count == 2

    def test_document_count_deduplicates_chunks_from_the_same_file(self):
        from app.retrieval.sufficiency import assess_sufficiency

        verdict = assess_sufficiency(
            [
                _result(rerank_score=0.9, document_id="doc-1"),
                _result(rerank_score=0.8, document_id="doc-1"),
                _result(rerank_score=0.7, document_id="doc-2"),
            ],
            min_score=0.35,
            min_supporting=1,
        )

        assert verdict.searched_count == 3
        assert verdict.document_count == 2

    def test_defaults_come_from_settings(self):
        from app.retrieval.sufficiency import assess_sufficiency

        just_under = assess_sufficiency([_result(rerank_score=settings.SUFFICIENCY_MIN_RERANK_SCORE - 0.01)])
        just_over = assess_sufficiency([_result(rerank_score=settings.SUFFICIENCY_MIN_RERANK_SCORE + 0.01)])

        assert just_under.sufficient is False
        assert just_over.sufficient is True


class TestBuildAbstention:
    def test_abstention_opens_with_the_generator_refusal_string(self):
        """`_did_refuse` in the golden regression test keys off this exact phrase,
        so a gated abstention counts toward refusal_accuracy."""
        from app.generation.generator import DEFAULT_SYSTEM_PROMPT
        from app.retrieval.sufficiency import assess_sufficiency, build_abstention

        text = build_abstention(assess_sufficiency([_result(rerank_score=0.02)]))

        assert text.startswith("I cannot find this information in your documents.")
        assert "I cannot find this information in your documents." in DEFAULT_SYSTEM_PROMPT

    def test_abstention_is_recognised_by_the_golden_refusal_markers(self):
        # The markers moved out of the test module and into the extracted
        # production harness (F1); this now reads the real predicate's source.
        from app.evaluation.golden_runner import _REFUSAL_MARKERS
        from app.retrieval.sufficiency import assess_sufficiency, build_abstention

        text = build_abstention(assess_sufficiency([])).lower()

        assert any(marker in text for marker in _REFUSAL_MARKERS)

    def test_abstention_reports_what_was_searched(self):
        from app.retrieval.sufficiency import assess_sufficiency, build_abstention

        text = build_abstention(assess_sufficiency([
            _result(rerank_score=0.08, document_id="doc-1"),
            _result(rerank_score=0.04, document_id="doc-2"),
        ]))

        assert "2 chunks" in text
        assert "2 documents" in text
        assert "0.08" in text

    def test_abstention_uses_singular_wording_for_a_single_chunk(self):
        from app.retrieval.sufficiency import assess_sufficiency, build_abstention

        text = build_abstention(assess_sufficiency([_result(rerank_score=0.08)]))

        assert "1 chunk across 1 document" in text


class TestMaybeAbstain:
    def test_returns_none_when_the_evidence_is_sufficient(self):
        from app.retrieval.sufficiency import maybe_abstain

        assert maybe_abstain("q-1", [_result(rerank_score=0.9)], elapsed_ms=10) is None

    def test_returns_none_when_the_gate_is_disabled(self, monkeypatch):
        from app.retrieval.sufficiency import maybe_abstain

        monkeypatch.setattr(settings, "SUFFICIENCY_GATE_ENABLED", False)

        assert maybe_abstain("q-1", [], elapsed_ms=10) is None

    def test_emits_the_websocket_frames_in_protocol_order(self):
        from app.retrieval.sufficiency import maybe_abstain

        abstention = maybe_abstain("q-1", [_result(rerank_score=0.01)], elapsed_ms=42)

        assert abstention is not None
        assert [frame["type"] for frame in abstention.frames] == [
            "progress",
            "token",
            "guardrail",
            "trust_score",
            "complete",
        ]
        assert {frame["payload"]["query_id"] for frame in abstention.frames} == {"q-1"}

    def test_complete_frame_carries_the_edge_case_and_sufficiency_detail(self):
        from app.retrieval.sufficiency import maybe_abstain

        abstention = maybe_abstain("q-1", [_result(rerank_score=0.01)], elapsed_ms=42)

        assert abstention is not None
        complete = abstention.frames[-1]["payload"]
        assert complete["edge_case"] == "insufficient_evidence"
        assert complete["model_used"] == "abstain"
        assert complete["token_count"] == 0
        assert complete["from_cache"] is False
        assert complete["latency_ms"] == 42
        assert complete["sufficiency"] == {
            "sufficient": False,
            "reason": "low_relevance",
            "top_score": 0.01,
            "supporting_count": 0,
            "searched_count": 1,
            "document_count": 1,
        }

    def test_token_frame_carries_the_whole_abstention_text_at_once(self):
        from app.retrieval.sufficiency import maybe_abstain

        abstention = maybe_abstain("q-1", [], elapsed_ms=5)

        assert abstention is not None
        token = abstention.frames[1]["payload"]
        assert token["content"] == abstention.answer
        assert token["index"] == 0

    def test_guardrail_frame_marks_the_answer_as_abstained_and_passing(self):
        from app.retrieval.sufficiency import maybe_abstain

        abstention = maybe_abstain("q-1", [], elapsed_ms=5)

        assert abstention is not None
        guardrail = abstention.frames[2]["payload"]
        assert guardrail["passed"] is True
        assert guardrail["score"] == 1.0
        assert guardrail["abstained"] is True

    def test_save_fields_persist_the_abstention_without_sources_or_a_model(self):
        from app.retrieval.sufficiency import maybe_abstain

        abstention = maybe_abstain("q-1", [_result(rerank_score=0.01)], elapsed_ms=42)

        assert abstention is not None
        assert abstention.save_fields == {
            "response_text": abstention.answer,
            "response_sources": [],
            "trust_score": 0.0,
            "trust_components": {
                "retrieval_quality": 0.01,
                "faithfulness": 0.0,
                "relevance": 0.0,
                "source_authority": 0.0,
            },
            "guardrail_score": 1.0,
            "guardrail_passed": True,
            "model_used": "abstain",
            "latency_ms": 42,
            "token_count": 0,
            "edge_case": "insufficient_evidence",
            # Persisted so a cache hit can replay the evidence-count line.
            "sufficiency": abstention.verdict.as_payload(),
        }


# ─── Threshold calibration ───────────────────────────────────────────
# BAAI/bge-reranker-v2-m3 is a cross-encoder with num_labels == 1, so
# sentence-transformers applies a Sigmoid by default (CrossEncoder
# .get_default_activation_fn) and rerank_score is a calibrated relevance
# probability in (0, 1), not a raw logit. BGE rerankers are strongly bimodal:
# a real match lands near 1.0, an unrelated chunk near 0.0. These synthetic
# distributions stand in for that shape.

ANSWERABLE_DISTRIBUTIONS = [
    [0.99, 0.97, 0.93, 0.41, 0.08],   # obvious hit
    [0.88, 0.34, 0.12, 0.04, 0.01],   # single relevant chunk
    [0.71, 0.66, 0.09, 0.03, 0.01],   # two-source answer
    [0.52, 0.18, 0.07, 0.02, 0.01],   # weak but real match
    [0.44, 0.40, 0.31, 0.10, 0.02],   # diffuse evidence
]

UNANSWERABLE_DISTRIBUTIONS = [
    [0.09, 0.06, 0.04, 0.02, 0.01],   # topically adjacent, no answer
    [0.21, 0.11, 0.05, 0.03, 0.01],   # shared vocabulary, wrong subject
    [0.03, 0.02, 0.01, 0.01, 0.00],   # out of corpus
    [0.14, 0.08, 0.07, 0.02, 0.01],   # keyword collision
    [],                               # retrieval returned nothing
]


def _abstains(scores: list[float], threshold: float) -> bool:
    from app.retrieval.sufficiency import assess_sufficiency

    verdict = assess_sufficiency([_result(rerank_score=s) for s in scores], min_score=threshold, min_supporting=1)
    return not verdict.sufficient


class TestThresholdCalibration:
    def test_the_shipped_default_is_0_35(self):
        """Below the reranker's own 0.5 decision boundary, so marginal matches
        still get answered; well above the irrelevant cluster."""
        assert settings.SUFFICIENCY_MIN_RERANK_SCORE == 0.35
        assert settings.SUFFICIENCY_MIN_SUPPORTING == 1
        assert settings.SUFFICIENCY_GATE_ENABLED is True

    def test_default_abstains_on_every_unanswerable_distribution(self):
        threshold = settings.SUFFICIENCY_MIN_RERANK_SCORE

        assert all(_abstains(scores, threshold) for scores in UNANSWERABLE_DISTRIBUTIONS)

    def test_default_answers_every_answerable_distribution(self):
        threshold = settings.SUFFICIENCY_MIN_RERANK_SCORE

        assert not any(_abstains(scores, threshold) for scores in ANSWERABLE_DISTRIBUTIONS)

    @pytest.mark.parametrize("threshold", [0.25, 0.30, 0.35, 0.40])
    def test_the_whole_usable_band_separates_the_two_populations(self, threshold):
        """Nothing is special about 0.35 — the bimodal score distribution makes
        0.25-0.40 behave identically. 0.35 sits mid-band for headroom."""
        assert all(_abstains(scores, threshold) for scores in UNANSWERABLE_DISTRIBUTIONS)
        assert not any(_abstains(scores, threshold) for scores in ANSWERABLE_DISTRIBUTIONS)

    def test_raising_the_floor_to_the_model_boundary_starts_refusing_real_answers(self):
        """Why not 0.5+: the diffuse-evidence answer gets silenced."""
        false_abstentions = [scores for scores in ANSWERABLE_DISTRIBUTIONS if _abstains(scores, 0.5)]

        assert false_abstentions == [[0.44, 0.40, 0.31, 0.10, 0.02]]

    def test_lowering_the_floor_lets_hallucination_bait_through(self):
        """Why not 0.1: keyword-collision retrievals would be generated on."""
        leaked = [scores for scores in UNANSWERABLE_DISTRIBUTIONS if scores and not _abstains(scores, 0.1)]

        assert leaked == [
            [0.21, 0.11, 0.05, 0.03, 0.01],
            [0.14, 0.08, 0.07, 0.02, 0.01],
        ]
