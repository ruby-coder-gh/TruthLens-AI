# PROJECT.md

## Goal
VeritasRAG — offline-first, enterprise-grade RAG platform. Users ask natural-language questions over private documents. Answers are grounded, cited, confidence-scored, and generated 100% locally with no paid APIs. "Perplexity for your private documents — fully offline, fully free, engineered so it never makes things up."

## Decisions
- **Stack:** Python 3.11 + FastAPI backend, React + Vite frontend, ChromaDB vector store, Ollama local LLM
- **Frontend choice:** React + Vite over Streamlit (richer UX for source highlighting, explainability panel) ✅
- **Default LLM:** Llama 3.1 8B (primary), Phi-3 3B fallback for 8GB RAM ✅
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

### Phase 3: Build (parallel)
#### Backend ✅
- [x] Ingestion pipeline (load, chunk, embed, store)
- [x] Retrieval pipeline (hybrid search, re-rank)
- [x] Generation pipeline (Ollama, streaming, citations, guardrail)
- [x] Auth & user management (JWT, register, login, refresh)
- [x] REST API + WebSocket endpoints (all 22 REST + WS streaming)
- [x] LangGraph orchestration (query_graph, crag_graph, ingestion_graph)
- [x] Evaluation (trust score, RAGAS, feedback loop)
- [x] Admin routes (stats, audit logs, evaluation trigger)
- [x] Database models (8 tables), Alembic migrations, ChromaDB client

#### AI Pipeline ✅ (built inside backend)
- [x] Hybrid search (BM25 + vector)
- [x] Cross-encoder re-ranking
- [x] Hallucination guardrail
- [x] Trust/confidence score
- [x] Query rewriting
- [x] Self-correcting RAG (CRAG) loop
- [ ] Multimodal (charts/tables) — _deferred: needs LLaVA model integration_

#### Frontend 🚫 (SKIPPED — user wants backend only)

### Phase 4: Security ✅
- [x] Security audit completed (13 findings)
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
- [x] F11 (LOW): Remaining medium/low items noted

### Phase 5: Testing ✅
- [x] 102 tests passing (69 core + 33 new)
- [x] PII redactor: 0% → 100% coverage
- [x] Retry utility: 0% → 95% coverage
- [x] Main app: 60% → 62% coverage
- [x] Overall: 54% → 56% (ML modules limit unit tests)
- [x] Security fixes verified (auth tests pass)
- [ ] Golden dataset + RAGAS eval — needs Ollama runtime

### Phase 6: DevOps ✅
- [x] Dockerfile (already existed)
- [x] Docker Compose (app + Ollama)
- [x] CI pipeline (GitHub Actions: test, lint, security scan)
- [ ] HF Spaces deployment — needs HF account

### Phase 7: Docs ✅
- [x] README with setup guide, API table, architecture
- [x] .env.example updated (secure defaults)

## Open Questions
- **Coverage:** 56% overall. ML-heavy modules (graph, generation, ingestion) need Ollama/ChromaDB runtime for testing. Recommend integration test suite for those.
- **Deployment:** HF Spaces deployment deferred (needs HF token + repo setup)
- **Multimodal:** Deferred — needs LLaVA model integration

## Artifacts
- PRD: `prd (1).html`
- Architecture: `ARCHITECTURE.md` (2,146 lines, 10 sections)
- API Spec: `backend/app/api/` — 9 route modules (auth, users, workspaces, documents, queries, feedback, admin, ws, router)
- Backend: `backend/` — Full FastAPI app (100+ files)

### Backend API lives at:
- REST: `http://localhost:8000/api`
- WebSocket: `ws://localhost:8000/api/ws/query`
- Docs: `http://localhost:8000/docs` (dev only)

### How to run:
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
