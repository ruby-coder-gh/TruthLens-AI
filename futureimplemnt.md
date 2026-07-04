# Future Implementation — Analysis Dump

Date: 2026-06-28. Scope: A (RAG eval loop), B (Streaming UX), C (Test coverage).
Goal: capture enough context that any agent can start work without re-investigating.

---

## A. RAG Eval Loop

### What exists today

| Asset | Location | Notes |
|---|---|---|
| Golden dataset (80 Q&A) | `backend/evaluation/golden_dataset.py` L25-1170 | 3 categories: answerable (50), unanswerable (15), ambiguous (15). Difficulty 1-3. Fields: `question`, `reference_answer`, `source_documents`, `expected_grounding`, `category`, `difficulty`, `notes`. Accessors at L1185-1198. |
| RAGAS wrapper | `backend/app/evaluation/ragas_eval.py` (115 LOC) | Metrics: faithfulness, answer_relevancy, context_precision, context_recall. Returns `None` when ragas missing (L84-89). `evaluate_single` per-entry helper. |
| Trust score | `backend/app/evaluation/trust_score.py` L30-116 | Components: retrieval_quality (0.3), faithfulness (0.4), relevance (0.2), source_authority (0.1). Weights in `app/config.py` L74-92. |
| Feedback loop | `backend/app/evaluation/feedback_loop.py` | Persists to `Feedback` model, returns rating distribution. |
| Eval run CLI | `backend/evaluation/evaluate.py` L155-268 | Standalone runner. Writes JSON to `data/evaluation_results.json`. HTML report at L29-125. |
| EvalRuns table | `backend/app/models/eval_run.py` L8-19 | UUID pk + 6 metric floats + `golden_set_version` + `notes`. Migration `003` L46-58. |
| Eval schemas | `app/schemas/analytics.py` L46-56, `app/schemas/common.py` L54-61 | `EvalRunResponse`, `EvaluationResponse`. |
| Admin endpoints | `backend/app/api/admin.py` L155-222, L565-597 | `GET /admin/evaluation`, `POST /admin/evaluation/run` (samples 20 random past queries, NOT golden set), `GET /admin/evaluation/history` (paginated `EvalRun` rows). |
| Existing eval tests | `tests/test_evaluation/test_ragas_eval.py` (45 LOC), `test_trust_score.py` (73 LOC), `test_feedback_loop.py` (185 LOC) | Unit tests only. No golden-set assertion. |
| Frontend widget | `frontend/src/pages/AdminDashboard.tsx` L828-1282 | "Evaluation" tab exists, calls `adminApi.evaluation` / `adminApi.runEvaluation` (client.ts L355-395). Lights up when rows exist. |
| Config thresholds | `app/config.py` L74-92 | `GUARDRAIL_THRESHOLD = 0.7`, `GUARDRAIL_NLI_MODEL = "cross-encoder/nli-deberta-v3-base"`, trust weights. |

### Gaps

| Gap | Impact |
|---|---|
| No pytest runner over golden dataset | `evaluation/evaluate.py` is a CLI, not importable as a test. Golden set not used in CI. |
| No threshold gating | No `MIN_FAITHFULNESS`, `MIN_TRUST`, `MIN_CONTEXT_PRECISION`. Silent regressions. |
| `POST /admin/evaluation/run` never writes `EvalRun` row | Dashboard widget stays empty. `golden_set_version` column unused. |
| Admin endpoint samples live queries (random 20 from DB) | Real query quality varies. Golden set is the regression baseline. |
| Refusal accuracy column exists, no code populates it | Column defined in `eval_run.py` but no metric code. |
| Per-category / per-difficulty breakdown | Dataset is labeled, runner aggregates one mean. |
| No CI hook | `.github/workflows/ci.yml` L14-54 runs only `pytest tests/`. No eval step. |
| No fast/slow split | 80 entries × full Ollama call = minutes. Default CI would slow to a crawl. |

### Proposed work

**1. Pytest runner over golden dataset** (~150 LOC, 0.5 day)
- New file: `backend/tests/test_evaluation/test_golden_regression.py`
- Async pytest using existing `test_engine` / `test_db` / `admin_headers` fixtures from `tests/conftest.py`
- Per entry: load `get_golden_dataset()`, build `GenerationInput`, call `generate()`, call `guardrail.check()`, call `compute_trust()`, assert `metrics.faithfulness >= MIN_FAITHFULNESS` and `trust.overall >= MIN_TRUST`
- Mark full set `@pytest.mark.slow`. Smoke subset (5 entries) for default CI

**2. RAGAS integration on golden set** (~50 LOC, 0.25 day)
- Feed `(queries, answers, contexts, ground_truths)` into existing `ragas_evaluate()`
- Assert `RagasScores.context_precision >= MIN_CONTEXT_PRECISION`

**3. Persist EvalRun row + golden_set_version** (~40 LOC, 0.25 day)
- After test loop, `INSERT INTO eval_runs (...)` via `test_db`
- `golden_set_version = hashlib.sha1(open("backend/evaluation/golden_dataset.py","rb").read()).hexdigest()[:12]`
- Also patch `backend/evaluation/evaluate.py` `evaluate_pipeline()` to write the same row (it currently writes JSON only)

**4. Thresholds in config** (~30 LOC, 0.1 day)
- Add to `app/config.py`:
  - `EVAL_MIN_FAITHFULNESS = 0.6`
  - `EVAL_MIN_TRUST = 0.5`
  - `EVAL_MIN_CONTEXT_PRECISION = 0.5`
  - `EVAL_REFUSAL_ACCURACY_MIN = 0.7`

**5. CI hook** (~20 LOC yaml, 0.25 day)
- `.github/workflows/ci.yml` — add separate job `eval-regression`:
  - Runs `pytest -m slow tests/test_evaluation/test_golden_regression.py`
  - Ollama sidecar service
  - Gate on `EVAL_SKIP != 1` env so devs can skip locally
  - Nightly cron job for full eval

**6. Refusal accuracy metric** (~50 LOC, 0.1 day, optional)
- Compute in test loop: `% of unanswerable entries where system refused`
- Write to `eval_runs.refusal_accuracy`

**7. Per-category aggregation** (~30 LOC, optional)
- Aggregate faithfulness/precision per `category` and `difficulty`
- Store in `eval_runs.notes` as JSON blob, surfaced in dashboard

### Files to touch

| Path | Change |
|---|---|
| `backend/tests/test_evaluation/test_golden_regression.py` | NEW ~150 LOC |
| `backend/app/config.py` | ADD thresholds L74-92 |
| `backend/evaluation/evaluate.py` | PATCH `evaluate_pipeline()` to write EvalRun row |
| `backend/tests/conftest.py` | MAYBE add `golden_set_version` fixture |
| `.github/workflows/ci.yml` | ADD eval-regression job |
| `backend/pyproject.toml` | ADD `markers = ["slow: full golden set eval"]` |

### Effort

- Minimal (1, 2, 3, 4, 5): **1-1.5 days**
- With refusal + per-category (6, 7): **1.75 days**

### Acceptance criteria

- `pytest -m slow tests/test_evaluation/test_golden_regression.py` exits 0 on current code
- `EvalRun` row written with all 6 metrics + `golden_set_version`
- `AdminDashboard` "Evaluation" tab shows latest run
- CI job runs on PR, fails if metrics regress below threshold

---

## B. Streaming UX

### What exists today

| Asset | Location | Notes |
|---|---|---|
| Main query page | `frontend/src/pages/ChatPage.tsx` (2328 LOC) | Reads `:id` as `workspaceId`. Full streaming UI + evidence sidebar mount. |
| `startQuery` | `ChatPage.tsx:240-388` | Creates `QueryWebSocket`, wires callbacks. |
| Token render loop | `ChatPage.tsx:299-307` | Per-token `setMessages(prev.map(...))` — full array re-render each frame. |
| `handleNewConversation` | `ChatPage.tsx:414-431` | Only cancel path (`wsRef.current?.disconnect()`). |
| `handleSubmit` / `handleKeyDown` | `ChatPage.tsx:391-411` | Disabled while `isStreaming`. |
| `ChatMessageBubble` | `ChatPage.tsx:963-1186` | Renders pending/streaming/complete/error. |
| Streaming caret | `ChatPage.tsx:1033-1042` | Blinking 3px cursor. |
| Citation rendering | `ChatPage.tsx:1305-1344` | `renderMessageWithCitations` regex `/(\[\d+\])/g`. **Gated on `isComplete`** at L1045. |
| Dead inline tabs | `ChatPage.tsx:1465-2196` | `SourcesTab / WhyThisAnswerTab / ConversationHistoryTab` — not mounted (replaced by `EvidenceSidebar`). |
| `TraceBeamOverlay` | `ChatPage.tsx:2265-2327` | SVG beam from citation marker → source card. |
| WS client | `frontend/src/api/websocket.ts` (193 LOC) | `QueryWebSocket` class. URL `ws(s)://<host>/api/ws/query` (Vite-proxied). |
| `connect()` | `websocket.ts:44-83` | On open sends `{type: 'auth', token}`. On `auth_success` sends `{type: 'query', payload: {...}}`. |
| `onmessage` | `websocket.ts:67-74` | `JSON.parse(event.data)` per frame. No batching. |
| `handleMessage` | `websocket.ts:100-187` | Switches on `msg.type`: token, sources, guardrail, trust_score, complete, error, progress, ack. |
| `disconnect()` | `websocket.ts:85-92` | Closes WS, **clears `onclose` to suppress reconnect**. |
| Error handling | `websocket.ts:76-78` | `onerror` emits `connection_error`. **No retry, no exponential backoff.** |
| Evidence sidebar | `frontend/src/components/EvidenceSidebar.tsx` (984 LOC) | "Premium" replacement for old tabs. |
| Sidebar tabs | `EvidenceSidebar.tsx:894-896` | **Only `reasoning` tab mounted.** Sources/history/trust-detail gone from sidebar. |
| Pipeline timeline | `EvidenceSidebar.tsx:519-585` | Maps backend `phase` to 5 visual steps (query/search/rank/gen/verify). |
| Sidebar mount | `ChatPage.tsx:722-732` | Props: `guardrail / trustScore / trustComponents / isLoading={isStreaming && !pipelinePhase} / isStreaming / sidebarOpen / onToggleSidebar / pipelinePhase / isMobile`. |
| WAAPI workaround | `ChatPage.tsx` (26 occurrences), `EvidenceSidebar.tsx` (6 occurrences) | `initial={{ opacity: 0.99 }}` + `animate={{ opacity: 1 }}` — dodges WAAPI stuck-opacity bug. |
| `isMobile` | `ChatPage.tsx:515` | `window.innerWidth < 1024`. **No resize listener.** |
| `loadQueryDetail` | `ChatPage.tsx:472-492` | Fetches on demand, no caching/dedup. |

### Gaps (with file:line)

| Gap | Detail |
|---|---|
| No cancel button mid-stream | Only abort via "New chat" (`ChatPage.tsx:414-431`, `:669`). Textarea disabled but no in-flight UI. |
| No retry on stream failure | `onError` (`ChatPage.tsx:362-377`) sets `status:'error'`, shows alert with "Try reconnecting" hint but **no retry button**. |
| No progress indicator | Binary thinking/streaming. No byte/token counter, ETA, percent. |
| No reconnect | `disconnect()` (`websocket.ts:88`) nukes `onclose`. `onerror` fires `connection_error` once. Dropped mid-stream = dead message. |
| Per-token React re-render | `setMessages(prev.map(...))` (`ChatPage.tsx:299-307`) fires on every WS frame. No `requestAnimationFrame` batching. Long responses jank. |
| `AnimatePresence mode="popLayout"` compounds cost | `ChatPage.tsx:620` — every state update can trigger layout-measured exit/enter transitions. |
| Citation flicker | `renderMessageWithCitations` (`ChatPage.tsx:1305-1344`) gated on `isComplete` at L1045. `[1]` markers invisible during stream, suddenly clickable at end. |
| No error boundary on stream | `try/catch` (`websocket.ts:68-73`) catches JSON parse only. Downstream callbacks can throw silently. |
| Sidebar tabs stripped | `EvidenceSidebar.tsx:894-896` — only `reasoning` mounted. Sources/history/trust panels gone. |
| Lost-stream sources invisible in sidebar | Sources arrive via `onSource` (`ChatPage.tsx:309-317`) but only legacy `SourcesTab`/`Sources` modal consumes them. |
| `isMobile` evaluated once | `ChatPage.tsx:515` — no resize listener. |
| `chatApi.get` race | `loadQueryDetail` (`ChatPage.tsx:472-492`) — no caching. Opening multiple history items = N parallel requests. |
| Scroll-position re-calc per frame | `messagesEndRef` (`ChatPage.tsx:220-226`) recomputed every token (messages array replaced each frame). |

### Proposed work (ordered by impact/effort)

**B1. `isMobile` responsive** (~10 LOC, 15 min)
- Wrap in `useEffect` listening to `resize`. Clean up on unmount.
- File: `frontend/src/pages/ChatPage.tsx:515`

**B2. Token batching via rAF** (~30 LOC, 0.25 day)
- `ChatPage.tsx:299-307` — replace direct `setMessages` with `requestAnimationFrame`-coalesced flush
- Tokens queue in `useRef<string[]>()`, flush once per frame
- Removes O(n) string-concat per frame + O(messages) map per frame
- File: `frontend/src/pages/ChatPage.tsx`

**B3. Cancel + retry buttons** (~80 LOC, 0.5 day)
- "Stop" button while `isStreaming` — calls `wsRef.current?.disconnect()`, sets `status: 'cancelled'`
- "Retry" button on error/cancelled — re-runs `startQuery` with last user message
- Files: `ChatPage.tsx:362-431`, `:1057-1081`

**B4. Live citations during stream** (~40 LOC, 0.25 day)
- Remove `isComplete` gate at `ChatPage.tsx:1045`. Invoke `renderMessageWithCitations` while streaming too
- `[1]` chips appear as soon as stream reveals them — no flicker at end
- File: `ChatPage.tsx:1033-1054`, `:1305-1344`

**B5. Reconnect on transient drop** (~60 LOC, 0.5 day)
- `websocket.ts:76-92` — on `onclose` mid-stream (not user-initiated), schedule one reconnect attempt, replay in-flight query
- Add `wasUserInitiatedDisconnect` flag
- File: `frontend/src/api/websocket.ts`

**B6. Restore Sources tab to sidebar** (~120 LOC, 0.5 day)
- `EvidenceSidebar.tsx:894-896` — re-add Sources tab. Consumes sources already populated by `onSource` callback (`ChatPage.tsx:309-317`)
- Delete dead `SourcesTab/WhyThisAnswerTab/ConversationHistoryTab` from `ChatPage.tsx:1465-2196`
- Files: `EvidenceSidebar.tsx`, `ChatPage.tsx`

**B7. Error boundary on stream** (~30 LOC, 0.25 day, optional)
- Add React error boundary around `ChatMessageBubble`. On throw, mark message as `status: 'error'` with reason
- File: `frontend/src/pages/ChatPage.tsx` (new wrapper component)

**B8. `loadQueryDetail` cache** (~20 LOC, 0.1 day, optional)
- Add `useRef` keyed by `queryId` for dedup
- File: `ChatPage.tsx:472-492`

### Files to touch

| Path | Change |
|---|---|
| `frontend/src/pages/ChatPage.tsx` | B1, B2, B3, B4, B6 (delete dead code), B7, B8 |
| `frontend/src/components/EvidenceSidebar.tsx` | B6 (re-add Sources tab) |
| `frontend/src/api/websocket.ts` | B5 |

### Effort

- Recommended (B1, B2, B3, B4, B5, B6): **1.75-2 days**
- With B7, B8: **2.1 days**

### Acceptance criteria

- Long responses (>500 tokens) render at 60fps (verify via DevTools Performance tab)
- Citations appear during stream, not only at `complete`
- User can stop mid-stream and retry without losing state
- WS drops mid-stream trigger one reconnect attempt, then surface error
- Sidebar shows Sources tab populated by stream sources
- Mobile viewport resize toggles sidebar correctly

---

## C. Test Coverage

### What exists today

38 test files, ~350 tests. `.coverage` artifact from June 20 (stale — code changed since).

| File | Scope | # Tests |
|---|---|---|
| `tests/conftest.py` | Fixtures | 0 |
| `tests/test_main.py` | App factory, health, security headers, CORS, request-id | ~5 |
| `tests/test_database.py` | Engine, session factory, `get_db` | ~3 |
| `tests/test_chroma.py` | ChromaDB client (skips on failure) | 2 |
| `tests/test_api/test_auth.py` | Register, login, refresh, me, password validation | ~16 |
| `tests/test_api/test_documents.py` | Document no-auth negative tests | 10 |
| `tests/test_api/test_documents_api.py` | Document upload/list/get/status/delete with auth | ~23 |
| `tests/test_api/test_queries.py` | Query list/get/delete no-auth negative tests | 8 |
| `tests/test_api/test_queries_api.py` | Query list/get/sources/delete with auth | ~21 |
| `tests/test_api/test_feedback_api.py` | Submit/list feedback, ratings, access control | ~19 |
| `tests/test_api/test_workspaces_api.py` | Workspace CRUD + member management | ~34 |
| `tests/test_api/test_ws.py` | WebSocket protocol — **STUB, skipped** | 1 stub |
| `tests/test_ingestion/test_loader.py` | TXT/CSV loader, error cases | ~5 |
| `tests/test_ingestion/test_chunker.py` | Chunk size, overlap, empty pages | ~5 |
| `tests/test_ingestion/test_embedder.py` | Single/batch embedding, metadata | ~3 |
| `tests/test_ingestion/test_indexer.py` | Empty store, delete noop | 2 |
| `tests/test_ingestion/test_multimodal.py` | LLaVA, image encoding (mostly stubs) | ~11 |
| `tests/test_retrieval/test_hybrid_search.py` | RRF, dedup, empty search | ~5 |
| `tests/test_retrieval/test_parent_retrieval.py` | Sibling expansion, ordering, dedup | ~7 |
| `tests/test_retrieval/test_reranker.py` | Rerank empty/single/metadata | 3 |
| `tests/test_retrieval/test_query_rewrite.py` | Rewrite + expand (live Ollama) | 3 |
| `tests/test_retrieval/test_query_rewrite_mock.py` | Rewrite + expand with mocked LLM | ~9 |
| `tests/test_generation/test_citer.py` | Citation marker matching | 3 |
| `tests/test_generation/test_generator.py` | Context builder, prompt defaults (live) | ~5 |
| `tests/test_generation/test_generator_mock.py` | Generator with mocked ChatOllama | ~8 |
| `tests/test_generation/test_generator_extras.py` | Result/Span classes, streamer | ~10 |
| `tests/test_generation/test_guardrail.py` | Claim extraction (live) | 6 |
| `tests/test_generation/test_guardrail_mock.py` | NLI mocked, claim edge cases | ~11 |
| `tests/test_generation/test_guardrail_extras.py` | Result class, claim edge cases | ~9 |
| `tests/test_generation/test_safety.py` | Prompt injection detection | ~17 |
| `tests/test_generation/test_streamer.py` | Streamer fallback | 1 |
| `tests/test_graph/test_graphs.py` | query_graph, crag_graph, ingestion_graph | ~17 |
| `tests/test_graph/test_investigation.py` | Investigation graph + runner | ~30 |
| `tests/test_evaluation/test_trust_score.py` | Trust score computation | ~5 |
| `tests/test_evaluation/test_feedback_loop.py` | Feedback ingest + stats | ~7 |
| `tests/test_evaluation/test_ragas_eval.py` | RAGAS evaluation | 4 |
| `tests/test_utils/test_deps.py` | Auth deps + workspace access | ~17 |
| `tests/test_utils/test_pii_redactor.py` | PII redactor | ~17 |
| `tests/test_utils/test_retry.py` | async_retry decorator | 5 |

### Coverage by critical path

| Path | Status | Notes |
|---|---|---|
| Auth: register, login, refresh, me (GET) | COVERED | `test_auth.py` |
| Auth: forgot-password, reset-password, change-password, logout | **MISSING** | Endpoints exist in `app/api/auth.py:54-90` |
| Auth: PUT /api/auth/me, DELETE /api/auth/me | **MISSING** | |
| Ingestion: upload, chunk, embed | COVERED (chunk, embed-partial) | `test_documents_api.py`, `test_chunker.py`, `test_embedder.py` |
| Ingestion: index (Chroma store) | WEAK | `test_indexer.py` — empty list + delete-noop only |
| Ingestion: multimodal (LLaVA) | STUB-ONLY | |
| Ingestion: reindex endpoint, list_all_documents | **MISSING** | Endpoints exist, no tests |
| Retrieval: hybrid search | PARTIAL | Only RRF math. Real `hybrid_search()` untested against live Chroma |
| Retrieval: reranker | PARTIAL | Empty/single/metadata. Real CrossEncoder untested |
| Retrieval: query rewrite | COVERED (live + mocked) | |
| Generation: generator (Ollama) | COVERED (mocked) | `test_generator_mock.py` |
| Generation: guardrail | COVERED (mocked NLI) | Real NLI integration untested |
| Generation: citations | COVERED | `test_citer.py` |
| Generation: safety | COVERED | `test_safety.py` — 17 tests |
| Generation: streamer | WEAK | Fallback only |
| Graph: query_graph, CRAG | COVERED | Structure + decision paths |
| Graph: ingestion_graph | PARTIAL | Tests missing file + unsupported mime + happy path |
| Graph: investigation | PARTIAL | Tests JSON parsing + state structure. Live invocation always errors |
| **WebSocket streaming** | **STUB** | `test_ws.py` — single skipped placeholder |
| **Admin endpoints** (15+ routes) | **MISSING** | No test file for `app/api/admin.py` |
| **Collections API** (8 routes) | **MISSING** | No test file for `app/api/collections.py` |
| **Users API** | **MISSING** | No test file for `app/api/users.py` |
| **Investigations HTTP endpoint** | **MISSING** | `/api/investigations/investigate` untested |
| **No CI coverage gate** | **MISSING** | `pyproject.toml` lacks `--cov-fail-under` |

### Mocking strategy

- **Ollama / ChatOllama** — `sys.modules` injection (since `langchain-ollama` 0.1.0 has real version conflict). See `test_generator_mock.py:37-68`, `test_query_rewrite_mock.py:23-42`.
- **ChromaDB** — not mocked at unit level. Integration tests use `pytest.skip` or mock only `indexer.delete_*` functions.
- **Sentence-Transformers** — not mocked. Tests hit real model (SBERT downloads at first run).
- **NLI model (deberta-v3-base)** — `unittest.mock.patch("app.generation.guardrail._load_nli_model", ...)`.
- **Database** — real SQLite via `aiosqlite` with `NullPool`, schema created/dropped per session.

### Pytest config

`backend/pyproject.toml` L37-46:
```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
asyncio_mode = "auto"
markers = ["asyncio: mark test as async"]

[tool.coverage.run]
source = ["app"]
```

Dev deps (`requirements-dev.txt`): pytest 8.2.0, pytest-asyncio 0.23.0, pytest-cov 5.0.0, pytest-mock 3.14.0, respx 0.21.0, asgi-lifespan 2.1.0, aiosqlite 0.20.0.

### Highest-risk gaps (with effort)

| # | Gap | Risk | Effort |
|---|------|------|---|
| 1 | **WebSocket streaming untested** | Highest. Core user-facing UX. Token ordering, cancel, partial save — all untested. Bug = silent data corruption. | L (3-5 days) |
| 2 | **Guardrail with real NLI model** | High. Claim extraction covered. Real `check()` with deberta — regression ships hallucinations with green badge. | M (1-2 days) |
| 3 | **Auth: forgot/reset/change + logout + me PUT/DELETE** | High. All 6 endpoints exposed (`app/api/auth.py:54-90`), untested. Common breach vectors. | M (1-2 days) |
| 4 | **Admin endpoints (15+)** | Medium-High. Stats, audit, users, eval — admin-only. Role escalation, mass-delete bugs undetected. | L (2-3 days) |
| 5 | **Collections API (8)** | Medium. CRUD + access control. Regression = data leak. | M (1-2 days) |
| 6 | **Real Chroma indexer flow** | Medium. Vector upsert, metadata filter, collection isolation — untested. | M (1-2 days) |
| 7 | **Ingestion reindex + processing** | Medium. `reindex_document`, `process_document_background` — no tests. | S-M (0.5-1 day) |
| 8 | **Hybrid search with real Chroma + BM25** | Medium. RRF math only. No test seeds real store. | M (1-2 days) |
| 9 | **Investigations HTTP endpoint** | Medium. Runner unit-tested. FastAPI wrapper untested. | S (0.5 day) |
| 10 | **Users API** | Low-Medium. | S (0.5 day) |
| 11 | **Multimodal (LLaVA)** | Low. Stub acceptable in CI. | L (3+ days) |
| 12 | **No CI coverage gate** | Process risk. 30% regression slips through. | XS (10 min) |
| 13 | **Stale `.coverage` artifact** | Process risk. 8 days old, code changed. | XS — re-run |
| 14 | **Reranker with real CrossEncoder** | Low. | S (0.5 day) |

### Proposed work (ordered by ROI)

**C1. CI coverage gate + re-baseline** (~10 LOC, 15 min, biggest ROI)
- Add `--cov-fail-under=40` to `pyproject.toml` `addopts` (current estimate; bump over time)
- Re-run `pytest --cov` to refresh stale June 20 data
- File: `backend/pyproject.toml`

**C2. Auth password-recovery + logout + me PUT/DELETE** (~120 LOC, 1-1.5 days)
- New: `backend/tests/test_api/test_auth_recovery.py`
- Cover: `/forgot-password`, `/reset-password`, `/change-password`, `/logout`, `PUT /api/auth/me`, `DELETE /api/auth/me`
- Reuse existing `test_auth.py` fixtures (`auth_headers`, `test_db`)
- Files: new test file, possibly `app/api/auth.py` if test reveals bugs

**C3. Reranker + guardrail real-model integration** (~150 LOC, 1-2 days)
- New: `tests/test_generation/test_reranker_integration.py` (real CrossEncoder, cached)
- Extend `tests/test_generation/test_guardrail.py` with deterministic NLI sentences
- Model cache in `backend/test_data/`
- Files: 1-2 new test files

**C4. Admin endpoints** (~250 LOC, 2-3 days)
- New: `backend/tests/test_api/test_admin.py`
- Stats, audit log, user management (invite, role, status, activity), eval runs trigger/history, settings, document listing, reindex
- Need new `admin_headers` fixture in `tests/conftest.py`
- Files: new test file, `tests/conftest.py`

**C5. Collections API** (~150 LOC, 1-2 days)
- New: `backend/tests/test_api/test_collections.py`
- Mirror workspace test pattern. CRUD + access control matrix
- Files: new test file

**C6. WebSocket streaming** (~300 LOC, 3-5 days, hard)
- Replace `test_ws.py` stub with real `websockets` test client
- Cases: auth, ack, token ordering, cancel-mid-stream, partial DB save, error frames, reconnect
- Add `websockets>=12` to `requirements-dev.txt`
- Files: rewrite `tests/test_api/test_ws.py`, `requirements-dev.txt`

**C7. Investigations HTTP endpoint** (~80 LOC, 0.5 day)
- New: `backend/tests/test_api/test_investigations.py`
- Auth/quota/error-mapping cases
- Files: new test file

**C8. Users API** (~40 LOC, 0.5 day)
- New: `backend/tests/test_api/test_users.py`
- Files: new test file

### Files to touch

| Path | Change |
|---|---|
| `backend/pyproject.toml` | C1 — add `--cov-fail-under` |
| `backend/tests/conftest.py` | C4 — add `admin_headers` fixture |
| `backend/tests/test_api/test_auth_recovery.py` | C2 — NEW |
| `backend/tests/test_api/test_admin.py` | C4 — NEW |
| `backend/tests/test_api/test_collections.py` | C5 — NEW |
| `backend/tests/test_api/test_investigations.py` | C7 — NEW |
| `backend/tests/test_api/test_users.py` | C8 — NEW |
| `backend/tests/test_api/test_ws.py` | C6 — rewrite |
| `backend/tests/test_generation/test_reranker_integration.py` | C3 — NEW |
| `backend/tests/test_generation/test_guardrail.py` | C3 — extend |
| `backend/requirements-dev.txt` | C6 — add `websockets>=12` |

### Effort

- Recommended (C1, C2, C3, C4, C7): **5-7 days**
- With C5, C6, C8: **9-13 days**

### Acceptance criteria

- `pytest --cov` exits 0 with `--cov-fail-under=40` (then bump)
- All new endpoint tests pass
- WebSocket test suite runs in <30s with mocked server
- CI fails on coverage drop

---

## Cross-cutting notes

- **Auth fixture scope**: existing `auth_headers` fixture creates a regular user. Need `admin_headers` for admin endpoints (C4). Both can live in `tests/conftest.py` as session-scoped functions.
- **Golden set version hash**: `hashlib.sha1(open("backend/evaluation/golden_dataset.py","rb").read()).hexdigest()[:12]` — deterministic, no git needed.
- **WAAPI opacity workaround**: do NOT change `opacity: 0.99` patterns. They dodge a real WAAPI bug. Keep them in B-side changes.
- **Mock pattern**: existing tests use `sys.modules` injection for `langchain_ollama` due to version conflict. Follow same pattern for any new Ollama-touching tests.
- **DB fixture**: `tests/conftest.py` provides `test_engine` (NullPool aiosqlite), `test_db` (session per test), `client` (ASGI). Reuse these — do not create parallel DB infra.
- **No new dependencies needed for A**. B needs no deps. C adds `websockets>=12` only.

---

## Open questions

1. **Coverage target for `--cov-fail-under`**: pick 40 (loose) or measure first and pick real?
2. **WebSocket test client**: `httpx-ws` vs `websockets` raw vs `fastapi.testclient.TestClient.websocket_connect` — last is most idiomatic but limited. Recommend `websockets` raw.
3. **Eval CI gate**: enforce on every PR (slow) or nightly cron (full)? Recommend nightly + PR-smoke (5-entry subset).
4. **Sidebar dead code**: delete `SourcesTab/WhyThisAnswerTab/ConversationHistoryTab` from `ChatPage.tsx:1465-2196` during B6, or leave as historical reference?
5. **`.coverage` re-baseline**: run before or after C1 ships? Recommend before, to set realistic `--cov-fail-under` value.
6. **Multimodal tests**: skip entirely (LLaVA dependency), or stub? Recommend stub-only — feature likely off in prod.

---

## Recommended ship order

**Day 1 (quick wins)**:
- C1 (15 min) — coverage gate
- B1 (15 min) — `isMobile` resize

**Week 1 (highest-ROI infrastructure)**:
- C2 (1-1.5 days) — auth recovery tests
- A1-A5 (1.5 days) — golden-set pytest + CI hook
- B2 (0.25 day) — token batching

**Week 2 (UX + coverage)**:
- B3 (0.5 day) — cancel + retry
- B4 (0.25 day) — live citations
- B5 (0.5 day) — reconnect
- C3 (1-2 days) — real-model integration tests
- C7 (0.5 day) — investigations endpoint

**Week 3+ (deepening)**:
- B6 (0.5 day) — sidebar Sources tab
- C4 (2-3 days) — admin endpoints
- C5 (1-2 days) — collections
- C6 (3-5 days) — WebSocket streaming
- A6, A7 (0.25 day) — refusal accuracy + per-category
- C8 (0.5 day) — users API

**Total**: ~7-10 days for recommended path. ~12-15 days with everything.