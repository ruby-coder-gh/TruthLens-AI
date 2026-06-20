# CODEBASE.md

## Project Structure
```
TruthLens AI/
├── .github/workflows/                # CI pipeline
│   └── ci.yml                        # Test + lint + security + Docker
├── backend/                          # FastAPI backend (veritasrag)
│   ├── app/                          # Main application
│   │   ├── main.py                   # FastAPI app factory, lifespan, middleware
│   │   ├── config.py                 # pydantic-settings (all env vars)
│   │   ├── database.py               # SQLAlchemy async engine + session
│   │   ├── chroma_client.py          # ChromaDB singleton + collection helpers
│   │   ├── api/                      # REST + WS routes (10 modules)
│   │   │   ├── router.py             # Aggregates all sub-routers
│   │   │   ├── auth.py               # /auth/register, login, refresh
│   │   │   ├── users.py              # /users (admin)
│   │   │   ├── workspaces.py         # /workspaces CRUD
│   │   │   ├── documents.py          # Upload, list, delete docs
│   │   │   ├── queries.py            # Query history, details
│   │   │   ├── feedback.py           # Submit/list feedback
│   │   │   ├── admin.py              # Stats, logs, eval
│   │   │   ├── investigations.py     # Multi-step investigation agent
│   │   │   └── ws.py                 # WebSocket streaming Q&A
│   │   ├── core/                     # Cross-cutting: auth, deps, security, exceptions
│   │   ├── models/                   # SQLAlchemy ORM (8 tables)
│   │   ├── schemas/                  # Pydantic request/response (10 modules)
│   │   ├── ingestion/                # Load, chunk, embed, index, multimodal
│   │   ├── retrieval/                # Hybrid search, reranker, query rewrite
│   │   ├── generation/               # Ollama gen, citations, guardrail, streaming
│   │   ├── evaluation/               # Trust score, RAGAS, feedback loop
│   │   ├── graph/                    # LangGraph: 4 graphs (query, crag, ingestion, investigation)
│   │   └── utils/                    # Logger, retry, PII redactor
│   ├── migrations/                   # Alembic (1 version: 001_initial_schema)
│   ├── tests/                        # pytest (24 files across 7 test modules)
│   ├── data/                         # Runtime: uploads, chroma, bm25, models
│   ├── Dockerfile                    # python:3.11-slim
│   ├── requirements.txt
│   ├── requirements-dev.txt
│   └── pyproject.toml
├── ARCHITECTURE.md                   # 2146-line architecture spec
├── CODEBASE.md                       # This file
├── PROJECT.md                        # Project tracker
├── REPORT.md                         # Comprehensive project report
├── README.md                         # Setup guide + API reference
├── docs/security/                    # Security audit report (updated 2026-06-20)
│   └── audit_report.md               # 17 findings, 0 High/Critical — Gate PASS
├── evaluation/                       # Golden dataset + eval runner
│   ├── golden_dataset.py             # 10 curated Q&A entries
│   └── evaluate.py                   # RAGAS + fallback metrics runner
├── docker-compose.yml                # App + Ollama services
├── hf_spaces_setup.sh                # HF Spaces startup script
├── spaces.Dockerfile                 # HF Spaces Docker config
├── prd (1).html                      # Product Requirements Document
└── .env.example                      # Env var template
```

## Entry Points
- **Server:** `backend/app/main.py` — `uvicorn app.main:app --reload --port 8000`
- **CLI:** None yet
- **Frontend:** Not built yet

## Key Modules

### Backend (Python/FastAPI)
| Module | File | Responsibility |
|---|---|---|
| App factory | `app/main.py` | FastAPI app, lifespan, CORS, middleware |
| Config | `app/config.py` | All env vars via pydantic-settings |
| Database | `app/database.py` | Async SQLAlchemy engine/session |
| ChromaDB | `app/chroma_client.py` | Vector store client + collections |
| Auth API | `app/api/auth.py` | Register, login, token refresh |
| Users API | `app/api/users.py` | User CRUD (admin) |
| Workspaces API | `app/api/workspaces.py` | Workspace + member management |
| Documents API | `app/api/documents.py` | Upload, list, delete documents |
| Queries API | `app/api/queries.py` | Query history, details, sources |
| Feedback API | `app/api/feedback.py` | Submit/list feedback |
| Admin API | `app/api/admin.py` | Stats, audit logs, evaluation trigger |
| Investigation API | `app/api/investigations.py` | Multi-step research agent REST endpoint |
| WebSocket | `app/api/ws.py` | Streaming Q&A over WS |
| Auth core | `app/core/auth.py` | JWT encode/decode, bcrypt hashing |
| Dependencies | `app/core/deps.py` | FastAPI DI (current user, DB, etc.) |
| Security | `app/core/security.py` | Rate limiter, request ID, PII redact |
| Exceptions | `app/core/exceptions.py` | Custom exceptions + handlers |
| Loader | `app/ingestion/loader.py` | Load PDF/DOCX/TXT/MD/CSV |
| Chunker | `app/ingestion/chunker.py` | Recursive text splitting |
| Embedder | `app/ingestion/embedder.py` | sentence-transformers embeddings |
| Indexer | `app/ingestion/indexer.py` | Store to ChromaDB + BM25 + SQLite |
| Multimodal | `app/ingestion/multimodal.py` | LLaVA vision: extract images → text descriptions |
| Hybrid Search | `app/retrieval/hybrid_search.py` | Vector + BM25 RRF fusion |
| Reranker | `app/retrieval/reranker.py` | Cross-encoder reranking |
| Query Rewrite | `app/retrieval/query_rewrite.py` | LLM query rewriting + expansion |
| Parent Retrieval | `app/retrieval/parent_retrieval.py` | Sibling chunk expansion for richer context |
| Generator | `app/generation/generator.py` | Ollama answer generation |
| Citer | `app/generation/citer.py` | Citation matching |
| Guardrail | `app/generation/guardrail.py` | NLI hallucination detection |
| Safety | `app/generation/safety.py` | Prompt-injection defense + input sanitizer |
| Streamer | `app/generation/streamer.py` | Token streaming via WS |
| Trust Score | `app/evaluation/trust_score.py` | Composite trust score |
| RAGAS Eval | `app/evaluation/ragas_eval.py` | RAGAS metrics + golden dataset eval |
| Golden Dataset | `evaluation/golden_dataset.py` | 10 curated Q&A entries |
| Eval Runner | `evaluation/evaluate.py` | CLI runner for golden dataset evaluation |
| Feedback Loop | `app/evaluation/feedback_loop.py` | Feedback ingestion + stats |
| Query Graph | `app/graph/query_graph.py` | Standard RAG LangGraph flow |
| CRAG Graph | `app/graph/crag_graph.py` | Self-correcting RAG loop |
| Ingestion Graph | `app/graph/ingestion_graph.py` | Load→chunk→embed→store |
| Investigation Graph | `app/graph/investigation.py` | Multi-step research: decompose → investigate → synthesize → trust |
| Logger | `app/utils/logger.py` | structlog structured logging |
| Retry | `app/utils/retry.py` | tenacity async retry |
| PII Redactor | `app/utils/pii_redactor.py` | PII detection/masking |

## Data Model

### SQLite (8 tables via SQLAlchemy)
- `users` — id, email, username, password_hash, role, created_at, updated_at
- `workspaces` — id, name, description, owner_id, created_at
- `workspace_members` — workspace_id, user_id, role
- `documents` — id, workspace_id, filename, content_type, status, chunk_count, error_message, created_at
- `chunks` — id, document_id, content, token_count, chunk_index, created_at
- `queries` — id, workspace_id, user_id, query_text, response_text, confidence_score, trust_score, guardrail_score, latency_ms, sources (JSON), conversation_id, created_at
- `feedback` — id, query_id, rating (1-5), comment, created_at
- `audit_logs` — id, user_id, action, resource, resource_id, ip_address, details (JSON), created_at

### ChromaDB Collections
- `doc_chunks` — embeddings for document chunks

## API Endpoints

| Method | Route | Handler | Description |
|---|---|---|---|
| POST | `/api/auth/register` | `api/auth.py` | Register new user |
| POST | `/api/auth/login` | `api/auth.py` | Login, get tokens |
| POST | `/api/auth/refresh` | `api/auth.py` | Refresh access token |
| GET | `/api/auth/me` | `api/auth.py` | Get current user profile |
| PUT | `/api/auth/me` | `api/auth.py` | Update profile |
| DELETE | `/api/auth/me` | `api/auth.py` | Delete account |
| GET | `/api/users` | `api/users.py` | List users (admin) |
| GET | `/api/users/{id}` | `api/users.py` | Get user by ID (admin) |
| POST | `/api/workspaces` | `api/workspaces.py` | Create workspace |
| GET | `/api/workspaces` | `api/workspaces.py` | List user workspaces |
| GET | `/api/workspaces/{id}` | `api/workspaces.py` | Get workspace details |
| PUT | `/api/workspaces/{id}` | `api/workspaces.py` | Update workspace |
| DELETE | `/api/workspaces/{id}` | `api/workspaces.py` | Delete workspace |
| POST | `/api/workspaces/{id}/members` | `api/workspaces.py` | Add member |
| DELETE | `/api/workspaces/{id}/members/{uid}` | `api/workspaces.py` | Remove member |
| POST | `/api/workspaces/{id}/documents` | `api/documents.py` | Upload document |
| GET | `/api/workspaces/{id}/documents` | `api/documents.py` | List documents |
| GET | `/api/workspaces/{id}/documents/{did}` | `api/documents.py` | Get doc details |
| DELETE | `/api/workspaces/{id}/documents/{did}` | `api/documents.py` | Delete document |
| POST | `/api/workspaces/{id}/query` | `api/queries.py` | Ask a question |
| GET | `/api/workspaces/{id}/queries` | `api/queries.py` | Query history |
| GET | `/api/queries/{id}` | `api/queries.py` | Query details + sources |
| DELETE | `/api/queries/{id}` | `api/queries.py` | Delete query |
| POST | `/api/queries/{id}/feedback` | `api/feedback.py` | Submit feedback |
| GET | `/api/queries/{id}/feedback` | `api/feedback.py` | List feedback |
| GET | `/api/admin/stats` | `api/admin.py` | System stats (admin) |
| GET | `/api/admin/logs` | `api/admin.py` | Audit logs (admin) |
| POST | `/api/admin/evaluation` | `api/admin.py` | Trigger evaluation (admin) |
| GET | `/api/admin/evaluation` | `api/admin.py` | Get eval results (admin) |
| POST | `/api/workspaces/{id}/investigate` | `api/investigations.py` | Multi-step investigation agent |
| WS | `/api/ws/query` | `api/ws.py` | Streaming Q&A WebSocket |
| GET | `/api/health` | `app/main.py` | Health check |

## Key Dependencies
- **Backend:** Python 3.11, FastAPI, SQLAlchemy (async), aiosqlite
- **Vector:** ChromaDB, sentence-transformers (BAAI/bge-base-en-v1.5)
- **Search:** rank-bm25 (BM25, JSON serialization), CrossEncoder (BAAI/bge-reranker-v2-m3)
- **LLM:** Ollama (qwen3:4b primary+fallback, nomic-embed-text embed)
- **Guardrail:** CrossEncoder NLI (microsoft/deberta-v3-base)
- **Orchestration:** LangGraph, LangChain
- **Auth:** python-jose (JWT), passlib (bcrypt)
- **Quality:** RAGAS, structlog, tenacity
- **Frontend (planned):** React + Vite + TailwindCSS
- **DevOps:** Docker, Docker Compose, GitHub Actions CI

## Config
- **Env file:** `backend/.env` (from `.env.example`)
- **Groups:** App (name, debug), Server (host, port), Database (URL), ChromaDB (path), Ollama (3 model configs), Embeddings (2 model configs), Retrieval (top_k, rerank_k, weights), Guardrail (threshold, NLI model, max_retries), Chunking (size, overlap), JWT (secret, expiry), Logging (level, format), Data paths, PII patterns

## Deployment
- **Docker:** `backend/Dockerfile` (python:3.11-slim)
- **Docker Compose:** `docker-compose.yml` — app + Ollama services
- **CI:** `.github/workflows/ci.yml` — test, lint, security scan, Docker build
- **Host:** Local development on :8000
- **Docs:** `README.md` — setup, API reference, architecture
