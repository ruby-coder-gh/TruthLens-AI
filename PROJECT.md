# PROJECT.md

## Goal
VeritasRAG — offline-first, enterprise-grade RAG platform. Users ask natural-language questions over private documents. Answers are grounded, cited, confidence-scored, and generated 100% locally with no paid APIs. "Perplexity for your private documents — fully offline, fully free, engineered so it never makes things up."

## Decisions
- **Stack:** Python 3.11 + FastAPI backend, React + Vite frontend, ChromaDB vector store, Ollama local LLM
- **Frontend choice:** React + Vite over Streamlit (richer UX for source highlighting, explainability panel) ✅
- **Default LLM:** qwen3:4b (primary+fallback), nomic-embed-text (embed+rerank) ✅
- **Vector store:** ChromaDB (simpler, free) ✅
- **Orchestration:** LangChain + LangGraph for pipeline and CRAG loop
- **No paid APIs:** Entirely free, open-source, offline-capable
- **Auth:** JWT-based, basic user/admin roles (no SSO)
- **DB:** SQLite for app data (users, workspaces, audit logs), ChromaDB for vectors

## Task Board

### Phase 0: Codebase Setup
- [x] Create CODEBASE.md
- [x] Create PROJECT.md
- [x] User confirmed decisions (React + Vite, Llama 3.1, ChromaDB)

### Phase 1: Requirements — DONE (PRD approved)
### Phase 2: Architecture (DONE — awaiting sign-off)
- [x] Architecture review & user sign-off
- [x] API contract definition (22 REST endpoints + WebSocket)
- [x] Data model design (8 SQLite tables + ChromaDB collections)
- [x] Component interface specs (ingestion, retrieval, generation, evaluation)

### Phase 3: Build (parallel) ✅ COMPLETE
#### Backend ✅
- [x] Ingestion pipeline (load, chunk, embed, store) — **PII Presidio + regex hybrid** integrated
- [x] Retrieval pipeline (hybrid search, re-rank, **parent-document expansion**)
- [x] Generation pipeline (Ollama, streaming, citations, guardrail, **prompt-injection defense**, **conversational memory**)
- [x] Auth & user management (JWT, register, login, refresh)
- [x] REST API + WebSocket endpoints (31 REST + WS streaming with `conversation_id`)
- [x] LangGraph orchestration (query_graph, crag_graph, ingestion_graph, investigation_graph)
- [x] Evaluation (trust score, RAGAS, feedback loop **100% tested**)
- [x] Admin routes (stats, audit logs, evaluation trigger)
- [x] Database models (8 tables + `conversation_id`), Alembic migrations (v001, v002), ChromaDB client

#### AI Pipeline ✅
- [x] Hybrid search (BM25 + vector)
- [x] Cross-encoder re-ranking
- [x] Hallucination guardrail
- [x] Trust/confidence score
- [x] Query rewriting
- [x] Self-correcting RAG (CRAG) loop
- [x] Investigation graph (multi-step research agent)
- [x] Multimodal (charts/tables) — LLaVA 7B
- [x] Golden dataset (80 entries: 50 answerable, 15 trap, 15 ambiguous)
- [x] HF Spaces deployment config (Dockerfile + startup script)

#### Frontend ✅ FULLY BUILT
- [x] **Scaffold:** React 18 + Vite + TypeScript + Tailwind CSS
- [x] **API layer:** HTTP client (JWT Bearer, auto-refresh on 401) + WebSocket streaming client
- [x] **Auth:** AuthContext provider (login, register, logout, user state)
- [x] **Layout:** Collapsible sidebar (glass effect, backdrop-blur), responsive shell
- [x] **UI kit:** 13 shared components (Button, Input, Card, Badge, Modal, Toast, EmptyState, Skeleton, ProgressBar, Tabs, etc.)
- [x] **LoginPage:** Centered glass card, email+password, validation, API error display
- [x] **RegisterPage:** Username+email+password+confirm, pw requirements hint, toggle visibility
- [x] **WorkspacesPage:** Grid cards, create modal, role badges, loading/empty/error states
- [x] **WorkspaceDetailPage:** 3 tabs (Documents, Members, Settings), upload w/ progress, status polling, member management, edit/delete workspace
- [x] **ChatPage:** Split-panel (chat + context), real-time WebSocket streaming, citation markers, guardrail badges, trust score, source panel, conversation history
- [x] **AdminDashboard:** 8 stat cards (animated), recharts chart placeholders, audit logs table (paginated, filterable), RAGAS evaluation display, admin-only gating
- [x] **InvestigationPage:** Multi-step research UI (input → sub-questions → reasoning trace → final report → trust score), all states covered
- [x] **Routing:** App.tsx with ProtectedRoute + AdminRoute guards, all routes wired
- [x] **Build:** `npx vite build` succeeds (723 KB JS bundle, 47 KB CSS)

### Phase 4: Security ✅
- [x] Security audit completed (17 findings, 0 High/Critical)
- [x] F1 (CRITICAL): APP_SECRET_KEY validation on startup
- [x] F2 (HIGH): Rate limiting enabled by default
- [x] F3 (HIGH): Account lockout (5 failures → 15 min lock)
- [x] F4 (HIGH): Pickle → JSON BM25 serialization (safe)
- [x] F5 (HIGH): WS auth via first message (no URL token)
- [x] F6 (MEDIUM): CORS methods/headers restricted
- [x] F7 (MEDIUM): Security headers middleware added
- [x] F8 (MEDIUM): Feedback workspace access check
- [x] F9 (MEDIUM): User enumeration fixed (combined error)
- [x] F10 (LOW): DB_ECHO=false default
- [x] F11 (LOW): JWT error handling — `ExpiredSignatureError` subclass (fragile string match fixed)
- [x] F12 (LOW): PII entity mismatch — ADDRESS in config but no regex; swapped for IP
- [x] F13 (LOW): Dead code removed — `get_current_user_ws` (token-in-query-param pattern)
- [x] F14 (INFO): `.env.example` model defaults synced with config
- [x] F15 (INFO): Corrupt PDF handling — try/except in `_load_pdf()`
- [x] F16 (INFO): Upload streaming — 1MB chunks to disk (no full-file RAM load)
- [x] F17 (INFO): CSP header not needed (no frontend from this API)
- [x] Gate: **PASS** — no High/Critical, no exposed secrets, all authz in place

### Phase 5: Testing ✅ (72% coverage)
- [x] **340+ tests passing** (0 failures, 72% coverage)
- [x] PII redactor: 93% coverage (Presidio + regex hybrid)
- [x] Feedback loop: **0% → 100% coverage**
- [x] Generator: **38% → 92% coverage** (mocked Ollama)
- [x] Guardrail: **42% → 94% coverage** (mocked NLI)
- [x] Query rewrite: **45% → 98% coverage** (mocked LLM)
- [x] Core deps: **42% → 85% coverage**
- [x] Safety module: **100% coverage** (prompt-injection defense)
- [x] Parent retrieval: **93% coverage**
- [x] Golden dataset (80 entries across 3 categories) + CLI eval runner
- [x] API integration tests: workspaces, documents, feedback, queries
- [x] Security fixes verified (auth + deps tests pass)

### Phase 6: DevOps ✅
- [x] Dockerfile (already existed)
- [x] Docker Compose (app + Ollama)
- [x] CI pipeline (GitHub Actions: test, lint, security scan)
- [x] HF Spaces deployment config (spaces.Dockerfile + startup script) ✅ NEW

### Phase 7: Docs ✅
- [x] README with setup guide, API table, architecture
- [x] .env.example updated (secure defaults + new vars)
- [x] **REPORT.md** — comprehensive project report (everything explained)
- [x] **docs/security/audit_report.md** — updated (17 findings, Gate PASS)
- [x] CODEBASE.md + PROJECT.md — fully synced

## Open Questions
- **Frontend tests:** Not yet written. Build successful, types clean. Test framework (vitest) not configured.
- **Performance benchmarking:** Median <4s latency not measured end-to-end (needs Ollama runtime).
- **Deployment:** HF Spaces config ready — needs HF account + token to push.
- **Refresh token jti:** Not implemented — accepted MVP risk (rotation mitigates window).
- **Outdated deps:** python-jose + passlib unmaintained — schedule migration to PyJWT + bcrypt.

## Artifacts
- PRD: `prd (1).html`
- Architecture: `ARCHITECTURE.md` (2,146 lines, 10 sections)
- API Spec: `backend/app/api/` — 10 route modules (auth, users, workspaces, documents, queries, feedback, admin, investigations, ws, router)
- Backend: `backend/` — Full FastAPI app (100+ files, 3,436 stmts, 72% coverage)
- **Report:** `REPORT.md` — comprehensive project report with explanations
- **Security Audit:** `docs/security/audit_report.md` — 17 findings, Gate PASS

### Backend API lives at:
- REST: `http://localhost:8000/api`
- WebSocket: `ws://localhost:8000/api/ws/query`
- Docs: `http://localhost:8000/docs` (dev only)

### How to run:
```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

### Run tests:
```bash
cd backend
uv run python -m pytest tests/ -q
uv run python -m pytest tests/ --cov=app --cov-report=html
```
