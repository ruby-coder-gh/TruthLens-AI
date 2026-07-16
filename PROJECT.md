# PROJECT.md

## Goal
Offline-first RAG platform (TruthLens AI/VeritasRAG) with local LLMs. No paid APIs. Users upload documents, query them via RAG pipeline, get trust-scored answers.

## Decisions
- **Stack**: Python FastAPI backend + React TypeScript frontend + Vite + Tailwind v4 + Framer Motion v12
- **WAAPI fix**: Framer Motion v12 uses Web Animations API — `initial={{ opacity: 0 }}` gets stuck on some browsers. Fix: use `opacity: 0.99` + CSS transitions for hover/active states
- **Routing**: React Router v7, Layout uses `<Outlet />` for child routes
- **Auth**: JWT in HttpOnly cookies (access + refresh) set by the API on login/register; AuthContext resolves the user via `/api/auth/me` (not localStorage — avoids XSS token theft)
- **UI**: Dark cinematic theme, glassmorphism, ambient blobs, gradient accents

## Task Board
### Phase: Core RAG Backend + Full Frontend Integration
- [x] Initial schema (users, workspaces, docs, chunks, queries, feedback, audit_log)
- [x] JWT auth (register, login, refresh, me)
- [x] Ingestion pipeline (load → chunk → embed → index → BM25)
- [x] Hybrid retrieval (ChromaDB vector + BM25 keyword) + reranker
- [x] LangGraph query pipeline + CRAG self-correction loop
- [x] WebSocket streaming query + Ollama generation
- [x] NLI guardrail (hallucination detection) + trust score
- [x] Admin dashboard, stats, audit logs, RAGAS evaluation
- [x] Docker Compose (api + ollama + model-init)
- [x] 18 premium frontend pages (public, user, admin)
- [x] Frontend API client + most pages connected
- [x] Investigator routes + multi-step investigation graph

### Phase: VeritasRAG Backend Complete (June 21)
- [x] Collections model + CRUD API + access control
- [x] Forgot/reset/change password + logout endpoints
- [x] Admin user management (invite, role, status, activity)
- [x] Admin analytics (flagged answers, queries over time, trust dist)
- [x] Admin settings endpoint
- [x] Global document listing + reindex endpoint
- [x] Eval runs table + history endpoint
- [x] Database migration 003 (new tables + columns)
- [x] Frontend API client methods (18 new)
- [x] Connected 9 frontend pages to real API calls
- [x] CODEBASE.md + PROJECT.md updated

### Stopped (June 21)
- [x] All VeritasRAG backend spec implemented
- [x] Backend 64 routes, frontend 0 TS errors
- [x] Login verified working

## Stopped
Project paused by user. All VeritasRAG backend spec implemented per requirements.

## Artifacts
- Frontend: `frontend/src/`
- Backend: `backend/` (not in workspace root)
- Config: `frontend/vite.config.ts`, `frontend/tailwind.config.ts`
