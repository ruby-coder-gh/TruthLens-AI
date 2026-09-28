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
| L1 Truth Lens BE | merged | 318 passed; sentence-window premises + number rule |
| Radar precision | merged | 4/4 planted, 0 FP on live seed |
| CEO fixes | done | b7f378a EMPTY_ANSWER + progress counts; e628be4 citation split; 080b5dc qwen3:4b-instruct default (user approved 2.5GB pull; 8.7s answers); 4dc5c12 NLI premise doc-title prefix (e .000→.998); 4921abc compound hyphen |
| Design pick | C Claim Ledger | D1 (chat ledger, frontend-engineer) + D2 (tokens/fonts/shell, ux-designer, no Bash → CEO runs gate + commits) dispatched from 6cd4890; D2 worktree was reset by CEO from main |
| Security audit | done | 0C/0H/1M/3L: M demo-login admin from LAN (0.0.0.0); L viewer publishes receipts; L receipts survive doc delete; L locate full-PDF scan. SEC-FIX agent dispatched from 4921abc (+ guardrail unchecked_claims count). Out of scope noted: delete_query lets viewers delete |
| D2 shell/tokens | merged | 5492a91 (CEO ran gate: tsc/lint clean, 193 tests, build ok; deleted CursorGlow). Live check OK. QA notes: /health/ready burst ~21 calls; Demo tour pill overlaps sidebar account row; workspace stats "AI Queries —", "Storage —" |
| SEC-FIX | merged | demo-login loopback-only + run.sh --demo binds 127.0.0.1; receipts editor-only + editors revoke; doc delete revokes citing receipts; locate bounded; guardrail unchecked_claims. + d80233b test model name. Live demo still on old process (0.0.0.0) — restart before QA |
| D1 Claim Ledger | merged | 7f8440e; FE gate 228 → aaba770 deleted dead AnswerBody/EvidenceSidebar/ReportBuilderWizard/ComparisonMatrix (225 tests, green). Live check OK; 8 known issues added to QA brief |
| Full backend suite | pass | 1053 passed + 1 env-dependent fixed (68ccdfb) → effectively all green, 2 skipped; ruff clean |
| User 2026-09-28 | directive | "fix all bugs and merge on main, test also admin panel" → QA told to cover every /admin route deeply |
| Playwright QA round 1 | FAIL | 43 routes (34 pass), 62 bugs S1 3 / S2 22 / S3 37; admin: Settings + Collections fail. reports committed 0359436 |
| Fix round 1 | running | brief FIX-round1.md (contracts C1–C8), base 4ed2a08; lanes B, F1a, F1b, F2, F3 in worktrees; demo stopped for RAM |
| Fix F1b | merged | 742122c — BUG-1,2,4,9,17,47 (231 tests) |
| Fix F3 admin | merged | 62cb38a — BUG-11,18(edit/delete),23,35,36,37,38,39(role/rollback),40,42,44,57 (239 tests). DEFERRED → follow-up lane: BUG-18 add-docs-to-collection (needs BE endpoint), BUG-39 restore built-in default prompt (needs BE endpoint), BUG-43 pricing footnote (.env.example ships gpt-4o-mini pricing → set {} + local $0 copy) |
| Fix F1a chat | merged | 0e52696 — BUG-4,5,6,8,9(chat),22,26,27,28,29,31,32,50(part),52,C1; SourceViewerContext conflict resolved; FE gate 280 green. FOLLOW-UP: cached replay trust components {} in ws.py _send_cached_query (BUG-50 BE); detail-page Regenerate = comparison re-run (product note) |
| Fix B backend | merged | d2b5033 — 468 passed. BUG-7,9,11,15,16(partial),17,19,24,34,35,59,60 fixed; BUG-1 FE-only; BUG-10 async progress deferred (feature); BUG-16 residual synonym gap → next sprint |
| Follow-up G | merged | c2342b5 — BUG-18, 39, 43, 50(BE) fixed; local backend/.env pricing set {} |
| Fix F2 shell/pages | merged | 27 bugs; integrated FE gate: 319 tests, tsc/lint/build green |
| Investigation async (BUG-10) | merged | lane H + 5a210ca (G's cached-trust test fake). FE gate 321 green; full BE suite running |
| Full gates | pass | BE 1113 passed / 2 skipped, ruff clean; FE 321 passed, tsc/lint/build clean |
| Playwright QA round 2 | FAIL | 46/62 fixed, 3 broken (7,16,53), 12 partial, 21 new (S1 1: viewer deletes others' chats; S2 6). Admin: all 14 routes load, most flows work |
| Fix round 2 | running | brief FIX-round2.md (K1–K6), base 1de316f; lanes B2, F2a, F2b; demo stopped |
| B2 merged | done | 5de6c7a — 14 commits (agent stalled at final cleanup, work complete, 632 passed in lane); local .env APP_NAME=TruthLens AI. FE gate 380 green; full BE suite running |
| F2a merged | done | 6e49931 — R2-3/29 conflict pairing+figures, 8, 10, 17, 53, R2-1 UI, R2-6, 8, 16, 17, 20, 21, 50 residual; FE gate 380 green |
| F2b merged | done | R2-2/33 tour → top bar, 15/R2-9 member roles, 36/38/R2-18 names, 39 confirms, 50 /100, R2-10/11/13/14/15/19 (343 tests). BUG-40 missed by lane → CEO 6be2967 sentence diff |
| Gates after round 2 | pass | BE 1170 passed / 2 skipped, ruff clean; FE 380 passed, tsc/lint/build clean; fresh seed radar = exactly 4 planted, 0 FP |
| QA round 3 | running | ws ceb28089-…; verify open items + all-route smoke (1280/375) + admin deep + demo path; report reports/QA3-report.md |
| Next | — | QA3 PASS → PR + merge to main (merge commit); else fix round 3 |
| Playwright QA round 1 (detail) | done | fresh demo seed ws ae7efa84-…; backend bound to localhost (sec fix confirmed); reports → reports/QA-playwright-{bugs,report}.md |
| Merge + gates | in progress | next: full suite → restart demo → Playwright QA → fix → re-sweep → PR+merge; then full suite (stop live demo first for RAM), security + review, Playwright sweep, then PR → merge to main (user: "after all perfectly tested, raise PR and merge") |
| Security + review | pending | |
| Playwright full sweep | pending | user explicit ask |
| PR (merge commit) | pending | |
