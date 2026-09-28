# Progress — Truth Suite + Demo sprint (recovery map)

Branch: `feat/truth-suite-demo` (worktree `.claude/worktrees/user-agent-reach-improve-fd209b`), cut from main @ 8ea173a.
Plan: `plan.md` (same folder) / `~/.claude/plans/deep-spinning-sparkle.md`.

| Step | Status | Notes |
|---|---|---|
| Research (agent-reach) | done | Exa rate-limited after 3 queries; GitHub channel used after |
| Plan | done | user picked Truth Lens, Receipt, Radar, Source viewer; laptop + Ollama |
| Scaffold BE | done | baseline full suite 841 passed / 1 skipped (~15 min) |
| Scaffold FE | done | tsc/eslint clean, vitest 125 passed, build ok |
| Scaffold commit | done | a99693a |
| L1–L10 | dispatched | all parallel, isolated worktrees, briefs in `briefs/` (graft rule added to COMMON.md) |
| L6 Radar FE | merged | f3a5e84; note flaky vitest timeouts under CPU contention (ChatPage, AdminPrompts) — pass alone |
| L10 Demo FE | merged | c21c9ea; also touched test/utils.tsx + test/setup.ts (IntersectionObserver polyfill) |
| L4 Receipt FE | merged | 36134f8; adds @media print block in index.css |
| L8 Viewer FE | merged | e613940; touched ChatPage.test.tsx (provider wrap) — watch conflict with L2 |
| L7 Viewer BE | merged | 10f0c16; file endpoint Cache-Control overwritten to no-cache by SecurityHeadersMiddleware (acceptable) |
| L3 Receipt BE | merged | f1adbee; edited core/security.py no-store allowlist to include /api/receipts |
| ENV incident | noted | mid-run, venv/homebrew python briefly became a self-exec loop; now venv python → homebrew 3.13.6 (pyvenv.cfg says anaconda 3.13.5), works. Ask L9 if run.sh venv logic touched it |
| L2 Truth Lens FE | merged | + INT fix 5e2d6ca (ChatPage.test mocks); FE gate: 186 tests, tsc/lint/build clean. Lens-ON view = plain text (markdown lost while lens on — ponytail) |
| L5 Radar BE | merged | 180b205; real-model check flags €412M/€398M at 0.855; 6/7 planted caught, 0/7 FP; sentence sim ≥0.6, sentences must end .!?; tests conftest RADAR_AUTO_SCAN=false. CAUSED python incident: overwrote Homebrew python3.13 binary via symlink, rebuilt from python@3.11 launcher + install_name_tool + codesign → user should `brew reinstall python@3.13` |
| ENV fix | done | user ran `brew reinstall python@3.13` → 3.13.15; unversioned /opt/homebrew/bin/python3 gone → repointed main venv `bin/python3 -> /opt/homebrew/bin/python3.13`; imports verified |
| INT smoke BE (L3+L5+L7) | pass | api+radar+receipts+ingestion: 540 passed, ruff clean |
| L9 Demo BE | merged | e2cac20; 567 passed; also fixed loader NFKC ligatures, <think> strip (reasoning kwarg omitted — qwen3 still thinks silently → check latency live; `/no_think` is the fallback), abstain usage rows. run.sh --demo untested live |
| Seed fix | done | 3e5885f — seed builds schema before seeding (run.sh --demo crashed "no such table: users") |
| Live demo boot | up | run.sh --demo works after fix; seed 6 docs; warmup ~10s; Try-demo + suggestions work |
| LIVE BUGS | open | S1: qwen3 thinks until OLLAMA_MAX_TOKENS=2048 → answer EMPTY after strip, 84–106s (fix: `/no_think`); S1: empty answer shown VERIFIED 86% (fix: empty answer = error + Retry); S2: rerank 6s on CPU (bge-reranker-v2-m3) → swap bge-reranker-base for 16GB; S2: radar FPs from PDF run-on text (fix agent running); S2: evidence panel overlaps chat at 800px |
| 16GB RAM | rule | user: Mac has 16GB → max 2 model-loading processes, no parallel pytest, Ollama 1 model/1 parallel/4K ctx |
| Chat redesign | prototypes | user dislikes chat UI → 3 HTML prototypes (A desk, B focused reading, C claim ledger) in artifacts/ui-prototypes/chat-redesign/, brief DESIGN-chat-redesign.md |
| Merge + gates | in progress | waiting L1, radar-fix |
| Security + review | pending | |
| Playwright full sweep | pending | user explicit ask |
| PR (merge commit) | pending | |
