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
### Phase 2: Architecture (CURRENT)
- [ ] Architecture review & user sign-off
- [ ] API contract definition
- [ ] Data model design
- [ ] Component interface specs

### Phase 3: Build (parallel)
#### Backend
- [ ] Ingestion pipeline (load, chunk, embed, store)
- [ ] Retrieval pipeline (hybrid search, re-rank)
- [ ] Generation pipeline (Ollama, streaming, citations)
- [ ] Auth & user management
- [ ] REST API + WebSocket endpoints

#### Frontend
- [ ] Project scaffolding (Vite + React + Tailwind)
- [ ] Chat UI with streaming
- [ ] Document upload & management
- [ ] Source highlighting viewer
- [ ] "Why this answer?" panel
- [ ] Auth screens (login, register)
- [ ] Workspace management
- [ ] Analytics dashboard

#### AI Pipeline
- [ ] Hybrid search (BM25 + vector)
- [ ] Cross-encoder re-ranking
- [ ] Hallucination guardrail
- [ ] Trust/confidence score
- [ ] Query rewriting
- [ ] Self-correcting RAG (CRAG) loop
- [ ] Multimodal (charts/tables)

### Phase 4: Security
- [ ] Security audit
- [ ] PII redaction pipeline
- [ ] Prompt-injection defenses

### Phase 5: Testing
- [ ] Golden dataset creation
- [ ] RAGAS evaluation
- [ ] Unit/integration tests (>70% coverage)
- [ ] Hallucination benchmark

### Phase 6: DevOps
- [ ] Docker setup
- [ ] Docker Compose (app + DB + Ollama)
- [ ] CI pipeline (GitHub Actions)
- [ ] HF Spaces deployment

### Phase 7: Docs
- [ ] README, setup guide, API docs

## Open Questions
- _None — all resolved 2026-06-20_

## Artifacts
- PRD: `prd (1).html`
- Architecture: _pending_
- API Spec: _pending_
- Deployment: _pending_
