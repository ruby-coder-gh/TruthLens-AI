"""Tests for the in-memory investigation progress registry (BUG-10).

Pure unit tests — no LLM/DB/network calls. `test_investigation.py` covers the
graph itself (and makes real Ollama calls); this file only exercises the
registry module the graph and API report into/read from.
"""

from __future__ import annotations

from app.graph import investigation_progress as ip


def teardown_function(_fn) -> None:
    # Each test uses its own id, but be tidy — the registry is a module-level
    # dict shared across the whole test process.
    ip._registry.clear()  # noqa: SLF001 — test-only reach into internal state


class TestStartAndGet:
    def test_start_initializes_running_state(self):
        ip.start("inv-1")
        snapshot = ip.get("inv-1")
        assert snapshot["status"] == "running"
        assert snapshot["step"] == "decompose"
        assert snapshot["done_steps"] == 0
        assert snapshot["total_steps"] == 3
        assert snapshot["sub_questions"] == []
        assert snapshot["error"] is None
        assert snapshot["elapsed_ms"] >= 0

    def test_get_unknown_id_returns_none(self):
        assert ip.get("does-not-exist") is None


class TestSetSubQuestions:
    def test_sets_total_steps_and_marks_decompose_done(self):
        ip.start("inv-2")
        ip.set_sub_questions("inv-2", ["Q1?", "Q2?", "Q3?"])
        snapshot = ip.get("inv-2")
        assert snapshot["step"] == "investigate"
        assert snapshot["done_steps"] == 1
        assert snapshot["total_steps"] == 6  # 3 sub-questions + decompose/synthesize/trust
        assert snapshot["sub_questions"] == [
            {"text": "Q1?", "status": "pending"},
            {"text": "Q2?", "status": "pending"},
            {"text": "Q3?", "status": "pending"},
        ]

    def test_unknown_id_is_a_noop(self):
        ip.set_sub_questions("ghost", ["Q1?"])
        assert ip.get("ghost") is None


class TestMarkSubQuestion:
    def test_running_does_not_change_done_steps(self):
        ip.start("inv-3")
        ip.set_sub_questions("inv-3", ["Q1?", "Q2?"])
        ip.mark_sub_question("inv-3", 0, "running")
        snapshot = ip.get("inv-3")
        assert snapshot["done_steps"] == 1
        assert snapshot["sub_questions"][0]["status"] == "running"
        assert snapshot["sub_questions"][1]["status"] == "pending"

    def test_done_increments_done_steps(self):
        ip.start("inv-4")
        ip.set_sub_questions("inv-4", ["Q1?", "Q2?"])
        ip.mark_sub_question("inv-4", 0, "running")
        ip.mark_sub_question("inv-4", 0, "done")
        snapshot = ip.get("inv-4")
        assert snapshot["done_steps"] == 2
        assert snapshot["sub_questions"][0]["status"] == "done"

    def test_out_of_range_index_is_a_noop(self):
        ip.start("inv-5")
        ip.set_sub_questions("inv-5", ["Q1?"])
        ip.mark_sub_question("inv-5", 5, "done")
        snapshot = ip.get("inv-5")
        assert snapshot["done_steps"] == 1  # unchanged


class TestStepTransitions:
    def test_set_step_changes_label_without_bumping_done_steps(self):
        ip.start("inv-6")
        ip.set_sub_questions("inv-6", ["Q1?"])
        ip.mark_sub_question("inv-6", 0, "done")
        ip.set_step("inv-6", "synthesize")
        snapshot = ip.get("inv-6")
        assert snapshot["step"] == "synthesize"
        assert snapshot["done_steps"] == 2  # unchanged by set_step

    def test_advance_step_bumps_done_steps_and_caps_at_total(self):
        ip.start("inv-7")
        ip.set_sub_questions("inv-7", [])  # decompose fallback: no sub-questions
        for _ in range(5):
            ip.advance_step("inv-7", "trust_score")
        snapshot = ip.get("inv-7")
        assert snapshot["done_steps"] == snapshot["total_steps"]
        assert snapshot["step"] == "trust_score"


class TestFinish:
    def test_finish_done_sets_status_and_full_progress(self):
        ip.start("inv-8")
        ip.set_sub_questions("inv-8", ["Q1?"])
        ip.finish("inv-8", status="done", latency_ms=4200)
        snapshot = ip.get("inv-8")
        assert snapshot["status"] == "done"
        assert snapshot["done_steps"] == snapshot["total_steps"]
        assert snapshot["elapsed_ms"] == 4200
        assert snapshot["error"] is None

    def test_finish_failed_carries_the_error(self):
        ip.start("inv-9")
        ip.finish("inv-9", status="failed", latency_ms=100, error="Ollama timed out")
        snapshot = ip.get("inv-9")
        assert snapshot["status"] == "failed"
        assert snapshot["error"] == "Ollama timed out"

    def test_elapsed_ms_freezes_after_finish(self):
        import time

        ip.start("inv-10")
        time.sleep(0.02)
        ip.finish("inv-10", status="done", latency_ms=20)
        first = ip.get("inv-10")["elapsed_ms"]
        time.sleep(0.02)
        second = ip.get("inv-10")["elapsed_ms"]
        assert first == second == 20
