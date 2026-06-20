# VeritasRAG Architecture

> Offline-first, enterprise-grade RAG platform. Grounded, cited, confidence-scored answers over private documents. 100% free, 100% offline, 100% open-source.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Directory Structure](#2-directory-structure)
3. [Data Model](#3-data-model)
4. [API Contract](#4-api-contract)
5. [Component Interfaces](#5-component-interfaces)
6. [Data Flow](#6-data-flow)
7. [Module Boundaries](#7-module-boundaries)
8. [Configuration](#8-configuration)
9. [Architecture Decision Records](#9-architecture-decision-records)
10. [Risk Assessment & Threat Model](#10-risk-assessment--threat-model)

---

## 1. System Overview

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client (Browser)                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Chat UI  │  │ Upload   │  │ Analytics│  │ Auth/Workspace│  │
│  │ (stream) │  │ Manager  │  │ Dashboard│  │ Manager       │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬────────┘  │
│       │              │              │               │           │
│       └──────────────┴──────────────┴───────────────┘           │
│                          │ REST + WebSocket                      │
└──────────────────────────┼──────────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────────┐
│                    FastAPI (Python 3.11)                        │
│                          │                                       │
│  ┌──────────────────────┴──────────────────────────────┐       │
│  │                    API Layer                         │       │
│  │  /auth  /users  /workspaces  /documents  /query  ws  │       │
│  └──────────────────────┬──────────────────────────────┘       │
│                          │                                       │
│  ┌──────────────────────┴──────────────────────────────┐       │
│  │              LangGraph Orchestrator                  │       │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │       │
│  │  │Ingestion │  │Retrieval │  │  Generation       │  │       │
│  │  │ Pipeline │→│ Pipeline │→│  + CRAG Loop     │  │       │
│  │  └──────────┘  └──────────┘  └──────────────────┘  │       │
│  └──────────────────────┬──────────────────────────────┘       │
│                          │                                       │
│  ┌──────────────────────┴──────────────────────────────┐       │
│  │              Data Stores                            │       │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │       │
│  │  │ SQLite   │  │ChromaDB  │  │  Ollama (local)   │  │       │
│  │  │ (app db) │  │(vectors) │  │  Llama 3.1 / Phi-3│  │       │
│  │  └──────────┘  └──────────┘  └──────────────────┘  │       │
│  └─────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Tech Stack Justification

| Component | Choice | Why |
|-----------|--------|-----|
| **Runtime** | Python 3.11 | LangChain/LangGraph native, best ML ecosystem, free |
| **API Framework** | FastAPI | Async-native, auto-docs, WebSocket support, Pydantic validation |
| **App DB** | SQLite | Zero infrastructure, ACID, good enough for single-server deployment; migrate to PostgreSQL if scale demands |
| **Vector Store** | ChromaDB | Free, local, simple API, good enough for <1M chunks; migrate to Qdrant if needed |
| **LLM** | Ollama (Llama 3.1 8B) | Fully offline, free, runs on 8GB RAM; Phi-3 3B fallback for low-memory |
| **Embeddings** | sentence-transformers (BGE-base) | Free, local, good multilingual performance, 768d |
| **Re-ranker** | BGE-reranker-v2-m3 | Cross-encoder quality, free, local |
| **BM25** | rank_bm25 | Simple, fast, proven lexical search |
| **Orchestration** | LangChain + LangGraph | Pipeline composition, CRAG loop, streaming support |
| **Frontend** | React + Vite + Tailwind | Rich UX, streaming support, fast dev cycle |
| **Auth** | JWT (python-jose, passlib) | Stateless, simple, no external dependency |
| **Migration** | Alembic | Required for SQLite schema evolution |

---

## 2. Directory Structure

```
truthlens/
│
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                        # FastAPI app factory, lifespan, middleware, router includes
│   │   ├── config.py                      # Settings via pydantic-settings (env vars)
│   │   ├── database.py                    # SQLAlchemy async engine + sessionmaker
│   │   ├── chroma_client.py               # ChromaDB singleton client
│   │   │
│   │   ├── models/                        # SQLAlchemy ORM models (SQLite schema)
│   │   │   ├── __init__.py
│   │   │   ├── base.py                    # DeclarativeBase, common mixins (TimestampMixin, UUIDPkMixin)
│   │   │   ├── user.py                    # User model
│   │   │   ├── workspace.py               # Workspace + WorkspaceMember models
│   │   │   ├── document.py                # Document model
│   │   │   ├── chunk.py                   # Chunk model (metadata for vector store reference)
│   │   │   ├── query.py                   # Query + Source models
│   │   │   ├── feedback.py                # Feedback model
│   │   │   └── audit_log.py              # AuditLog model
│   │   │
│   │   ├── schemas/                       # Pydantic schemas (request/response)
│   │   │   ├── __init__.py
│   │   │   ├── auth.py                    # LoginRequest, RegisterRequest, TokenResponse
│   │   │   ├── user.py                    # UserCreate, UserUpdate, UserResponse
│   │   │   ├── workspace.py               # WorkspaceCreate, WorkspaceResponse, MemberAdd
│   │   │   ├── document.py                # DocumentResponse, DocumentStatus
│   │   │   ├── query.py                   # QueryRequest, QueryResponse, SourceResponse
│   │   │   ├── feedback.py                # FeedbackCreate, FeedbackResponse
│   │   │   ├── common.py                  # PaginatedResponse, ErrorResponse
│   │   │   └── ws.py                      # WebSocket message types
│   │   │
│   │   ├── api/                           # Route handlers
│   │   │   ├── __init__.py
│   │   │   ├── router.py                  # Aggregate router
│   │   │   ├── auth.py                    # /auth/*
│   │   │   ├── users.py                   # /users/*
│   │   │   ├── workspaces.py              # /workspaces/*
│   │   │   ├── documents.py               # /workspaces/{id}/documents/*
│   │   │   ├── queries.py                 # /workspaces/{id}/queries/*, /queries/{id}/*
│   │   │   ├── feedback.py                # /queries/{id}/feedback/*
│   │   │   ├── admin.py                   # /admin/*
│   │   │   └── ws.py                      # WebSocket /ws/query
│   │   │
│   │   ├── core/                          # Cross-cutting
│   │   │   ├── __init__.py
│   │   │   ├── auth.py                    # JWT encode/decode, password hashing (passlib bcrypt)
│   │   │   ├── deps.py                    # FastAPI Depends: get_db, get_current_user, check_workspace_access
│   │   │   ├── security.py                # Rate limiter, CORS, PII redactor
│   │   │   └── exceptions.py             # Custom exception classes + handlers
│   │   │
│   │   ├── ingestion/                     # Document ingestion pipeline
│   │   │   ├── __init__.py
│   │   │   ├── loader.py                  # load() — PDF/DOCX/TXT/MD/CSV → list[str]
│   │   │   ├── chunker.py                 # chunk() — semantic splitting + fixed-size overlap
│   │   │   ├── embedder.py                # embed() — sentence-transformers → np.ndarray
│   │   │   └── indexer.py                 # store() — ChromaDB upsert + BM25 index update
│   │   │
│   │   ├── retrieval/                     # Search & retrieval
│   │   │   ├── __init__.py
│   │   │   ├── hybrid_search.py           # hybrid_search() — vector similarity + BM25 fusion
│   │   │   ├── reranker.py                # rerank() — cross-encoder re-scoring
│   │   │   └── query_rewrite.py           # rewrite() — LLM-based query reformulation
│   │   │
│   │   ├── generation/                    # Answer generation
│   │   │   ├── __init__.py
│   │   │   ├── generator.py               # generate() — Ollama call with context
│   │   │   ├── streamer.py                # stream() — async token generator for WS push
│   │   │   ├── citer.py                   # cite() — mark source spans in answer
│   │   │   └── guardrail.py               # guardrail() — NLI-based hallucination check
│   │   │
│   │   ├── evaluation/                    # Quality & feedback
│   │   │   ├── __init__.py
│   │   │   ├── trust_score.py             # compute_trust() — confidence from signals
│   │   │   ├── ragas_eval.py              # ragas_evaluate() — faithfulness, relevance, precision
│   │   │   └── feedback_loop.py           # ingest_feedback() — store + trigger re-evaluation
│   │   │
│   │   ├── graph/                         # LangGraph orchestration graphs
│   │   │   ├── __init__.py
│   │   │   ├── ingestion_graph.py         # Orchestrated ingestion pipeline
│   │   │   ├── query_graph.py             # Standard RAG query flow
│   │   │   └── crag_graph.py              # CRAG self-correction loop
│   │   │
│   │   └── utils/
│   │       ├── __init__.py
│   │       ├── logger.py                  # Structured logging (structlog)
│   │       ├── retry.py                   # Async retry decorator (tenacity)
│   │       └── pii_redactor.py            # Presidio-based PII detection/masking
│   │
│   ├── tests/
│   │   ├── conftest.py                    # Fixtures: test DB, test ChromaDB, test Ollama mock
│   │   ├── test_ingestion/
│   │   │   ├── test_loader.py
│   │   │   ├── test_chunker.py
│   │   │   ├── test_embedder.py
│   │   │   └── test_indexer.py
│   │   ├── test_retrieval/
│   │   │   ├── test_hybrid_search.py
│   │   │   ├── test_reranker.py
│   │   │   └── test_query_rewrite.py
│   │   ├── test_generation/
│   │   │   ├── test_generator.py
│   │   │   ├── test_streamer.py
│   │   │   ├── test_citer.py
│   │   │   └── test_guardrail.py
│   │   ├── test_api/
│   │   │   ├── test_auth.py
│   │   │   ├── test_documents.py
│   │   │   ├── test_queries.py
│   │   │   └── test_ws.py
│   │   └── test_evaluation/
│   │       ├── test_trust_score.py
│   │       └── test_ragas_eval.py
│   │
│   ├── migrations/                        # Alembic migration scripts
│   │   ├── versions/
│   │   └── env.py
│   ├── alembic.ini
│   ├── requirements.txt                   # Pinned dependencies
│   ├── requirements-dev.txt               # Dev/test dependencies
│   ├── Dockerfile
│   └── pyproject.toml                     # Project metadata, tool config
│
├── frontend/
│   ├── public/
│   │   └── favicon.svg
│   ├── src/
│   │   ├── main.jsx                       # Entry point
│   │   ├── App.jsx                        # Root component + router
│   │   │
│   │   ├── api/                           # API client layer
│   │   │   ├── client.js                  # Axios instance, interceptors, base URL
│   │   │   ├── auth.js                    # login(), register(), refresh(), logout()
│   │   │   ├── documents.js               # upload(), list(), delete(), getStatus()
│   │   │   ├── queries.js                 # query() — WebSocket session manager
│   │   │   ├── workspaces.js              # CRUD for workspaces + members
│   │   │   ├── feedback.js                # submitFeedback(), getFeedback()
│   │   │   └── admin.js                   # getStats(), getLogs()
│   │   │
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── AppLayout.jsx          # Sidebar + main content shell
│   │   │   │   ├── Sidebar.jsx            # Workspace nav, doc list
│   │   │   │   ├── Header.jsx             # User menu, search bar
│   │   │   │   └── WorkspaceSelector.jsx
│   │   │   ├── chat/
│   │   │   │   ├── ChatPanel.jsx          # Main chat container
│   │   │   │   ├── MessageBubble.jsx      # Single Q/A pair
│   │   │   │   ├── StreamingMessage.jsx   # Token-by-token display
│   │   │   │   ├── SourceCard.jsx         # Expandable source citation
│   │   │   │   ├── SourceHighlight.jsx    # Inline source highlighting
│   │   │   │   ├── TrustBadge.jsx         # Confidence indicator
│   │   │   │   ├── WhyThisAnswer.jsx      # Explainability panel
│   │   │   │   └── QueryInput.jsx         # Text input + send button
│   │   │   ├── documents/
│   │   │   │   ├── UploadZone.jsx         # Drag-drop file upload
│   │   │   │   ├── DocumentList.jsx       # Table/list of documents
│   │   │   │   ├── DocumentCard.jsx       # Single doc status card
│   │   │   │   └── DocumentViewer.jsx     # Embedded doc preview
│   │   │   ├── auth/
│   │   │   │   ├── LoginForm.jsx
│   │   │   │   ├── RegisterForm.jsx
│   │   │   │   └── ProtectedRoute.jsx
│   │   │   ├── workspace/
│   │   │   │   ├── WorkspaceSettings.jsx
│   │   │   │   └── MemberList.jsx
│   │   │   ├── analytics/
│   │   │   │   ├── AnalyticsDashboard.jsx
│   │   │   │   ├── UsageChart.jsx
│   │   │   │   ├── TrustScoreChart.jsx
│   │   │   │   └── FeedbackSummary.jsx
│   │   │   └── common/
│   │   │       ├── Button.jsx
│   │   │       ├── Modal.jsx
│   │   │       ├── Spinner.jsx
│   │   │       ├── Toast.jsx
│   │   │       └── EmptyState.jsx
│   │   │
│   │   ├── hooks/
│   │   │   ├── useAuth.js                 # Auth context consumer
│   │   │   ├── useWebSocket.js            # WS connection lifecycle + message buffer
│   │   │   ├── useDocuments.js            # Document CRUD + polling status
│   │   │   ├── useQuery.js                # Send query + handle stream
│   │   │   └── useWorkspace.js            # Current workspace state
│   │   │
│   │   ├── contexts/
│   │   │   ├── AuthContext.jsx             # Auth state provider
│   │   │   └── WorkspaceContext.jsx        # Active workspace provider
│   │   │
│   │   ├── pages/
│   │   │   ├── LoginPage.jsx
│   │   │   ├── RegisterPage.jsx
│   │   │   ├── ChatPage.jsx               # Main query interface
│   │   │   ├── DocumentsPage.jsx          # Document management
│   │   │   ├── AnalyticsPage.jsx          # Admin dashboard
│   │   │   └── SettingsPage.jsx
│   │   │
│   │   └── utils/
│   │       ├── constants.js
│   │       ├── formatters.js              # Date, file size, text truncation
│   │       └── validators.js              # Client-side validation
│   │
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── package.json
│   ├── Dockerfile
│   └── nginx.conf                         # Production reverse proxy
│
├── scripts/
│   ├── setup.sh                           # Full dev environment bootstrap
│   ├── download_models.sh                 # Pull Ollama models + embeddings
│   ├── seed_data.py                       # Sample documents + test user
│   └── run_benchmark.py                   # Performance benchmark suite
│
├── docker-compose.yml                     # App + Ollama + (optional) Postgres
├── Dockerfile.ollama                      # Ollama with pre-pulled models
├── .env.example                           # Template for all env vars
├── .gitignore
├── ARCHITECTURE.md                        # This file
├── CODEBASE.md                            # Codebase map
├── PROJECT.md                             # Project management & task board
└── README.md                              # Setup & usage guide
```

---

## 3. Data Model

### 3.1 Entity Relationship Diagram

```
┌──────────┐     ┌──────────────────┐     ┌──────────────┐
│   User   │1──N│   WorkspaceMember │N──1│  Workspace   │
└──────────┘     └──────────────────┘     └──────┬───────┘
     │1                                          │1
     │                                           │
     │N                                          │N
┌────┴──────────┐                     ┌──────────┴───────┐
│  AuditLog     │                     │   Document        │
└───────────────┘                     └──────────┬───────┘
                                                  │1
                                                  │
                                                  │N
                                        ┌─────────┴───────┐
                                        │     Chunk       │
                                        └─────────────────┘
     ┌──────────────┐
     │   Query      │──N────────1 User
     └──────┬───────┘
            │1                          ┌──────────────┐
            │                           │  Feedback     │
            │N                          │  (rating 1-5) │
     ┌──────┴───────┐                   └──────────────┘
     │   Source     │  (junction: query↔chunk)
     └──────────────┘
```

### 3.2 SQLite Schema (App Data)

#### `users`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | TEXT (UUID) | PK, default uuid4 | |
| `email` | TEXT | UNIQUE, NOT NULL, INDEX | |
| `username` | TEXT | UNIQUE, NOT NULL, INDEX | |
| `password_hash` | TEXT | NOT NULL | bcrypt hash |
| `role` | TEXT | NOT NULL, DEFAULT 'user' | 'user' or 'admin' |
| `is_active` | BOOLEAN | NOT NULL, DEFAULT TRUE | |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT now() | |
| `updated_at` | TIMESTAMP | NOT NULL, DEFAULT now(), ON UPDATE now() | |

```sql
CREATE TABLE users (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
    is_active BOOLEAN NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
```

#### `workspaces`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | TEXT (UUID) | PK | |
| `name` | TEXT | NOT NULL | |
| `description` | TEXT | | |
| `owner_id` | TEXT (UUID) | FK→users.id, NOT NULL | |
| `created_at` | TIMESTAMP | NOT NULL | |
| `updated_at` | TIMESTAMP | NOT NULL | |

```sql
CREATE TABLE workspaces (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_workspaces_owner ON workspaces(owner_id);
```

#### `workspace_members`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | TEXT (UUID) | PK | |
| `workspace_id` | TEXT (UUID) | FK→workspaces.id, NOT NULL | |
| `user_id` | TEXT (UUID) | FK→users.id, NOT NULL | |
| `role` | TEXT | NOT NULL, DEFAULT 'viewer' | 'owner', 'editor', 'viewer' |
| `joined_at` | TIMESTAMP | NOT NULL | |

```sql
CREATE TABLE workspace_members (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('owner', 'editor', 'viewer')),
    joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(workspace_id, user_id)
);
CREATE INDEX idx_wm_workspace ON workspace_members(workspace_id);
CREATE INDEX idx_wm_user ON workspace_members(user_id);
```

#### `documents`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | TEXT (UUID) | PK | |
| `workspace_id` | TEXT (UUID) | FK→workspaces.id, NOT NULL | |
| `filename` | TEXT | NOT NULL | Server-side filename (UUID-based) |
| `original_filename` | TEXT | NOT NULL | User-facing filename |
| `mime_type` | TEXT | NOT NULL | |
| `file_size` | INTEGER | NOT NULL | Bytes |
| `page_count` | INTEGER | | For PDFs |
| `chunk_count` | INTEGER | NOT NULL, DEFAULT 0 | |
| `status` | TEXT | NOT NULL, DEFAULT 'pending' | pending→processing→ready |
| `error_message` | TEXT | | On failure |
| `uploaded_by` | TEXT (UUID) | FK→users.id | |
| `created_at` | TIMESTAMP | NOT NULL | |
| `updated_at` | TIMESTAMP | NOT NULL | |

```sql
CREATE TABLE documents (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    page_count INTEGER,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'ready', 'failed')),
    error_message TEXT,
    uploaded_by TEXT REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_docs_workspace ON documents(workspace_id);
CREATE INDEX idx_docs_status ON documents(status);
```

#### `chunks`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | TEXT (UUID) | PK | |
| `document_id` | TEXT (UUID) | FK→documents.id, NOT NULL | |
| `index` | INTEGER | NOT NULL | Order within document |
| `content` | TEXT | NOT NULL | Raw text of chunk |
| `token_count` | INTEGER | NOT NULL | Approximate token count |
| `created_at` | TIMESTAMP | NOT NULL | |

```sql
CREATE TABLE chunks (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    index INTEGER NOT NULL,
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(document_id, index)
);
CREATE INDEX idx_chunks_document ON chunks(document_id);
```

#### `queries`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | TEXT (UUID) | PK | |
| `workspace_id` | TEXT (UUID) | FK→workspaces.id, NOT NULL | |
| `user_id` | TEXT (UUID) | FK→users.id | Null for anonymous |
| `query_text` | TEXT | NOT NULL | Original user question |
| `rewritten_query` | TEXT | | After query rewriting |
| `response_text` | TEXT | | Final generated answer |
| `response_sources` | TEXT (JSON) | | [{chunk_id, score, excerpt}] |
| `trust_score` | REAL | | 0.0 – 1.0 |
| `guardrail_score` | REAL | | Hallucination guardrail score |
| `guardrail_passed` | BOOLEAN | | Did guardrail pass? |
| `model_used` | TEXT | | 'llama3.1:8b' or 'phi3:3b' |
| `latency_ms` | INTEGER | | Total end-to-end latency |
| `token_count` | INTEGER | | Tokens generated |
| `created_at` | TIMESTAMP | NOT NULL | |

```sql
CREATE TABLE queries (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id),
    query_text TEXT NOT NULL,
    rewritten_query TEXT,
    response_text TEXT,
    response_sources TEXT DEFAULT '[]',
    trust_score REAL,
    guardrail_score REAL,
    guardrail_passed BOOLEAN,
    model_used TEXT,
    latency_ms INTEGER,
    token_count INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_queries_workspace ON queries(workspace_id);
CREATE INDEX idx_queries_user ON queries(user_id);
CREATE INDEX idx_queries_created ON queries(created_at);
```

#### `feedback`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | TEXT (UUID) | PK | |
| `query_id` | TEXT (UUID) | FK→queries.id, NOT NULL | |
| `user_id` | TEXT (UUID) | FK→users.id | |
| `rating` | INTEGER | NOT NULL, CHECK(1-5) | |
| `comment` | TEXT | | |
| `created_at` | TIMESTAMP | NOT NULL | |

```sql
CREATE TABLE feedback (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    query_id TEXT NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id),
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_feedback_query ON feedback(query_id);
```

#### `audit_logs`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | TEXT (UUID) | PK | |
| `user_id` | TEXT (UUID) | FK→users.id | |
| `action` | TEXT | NOT NULL | e.g. 'document.upload', 'query.run', 'workspace.create' |
| `resource_type` | TEXT | NOT NULL | 'document', 'query', 'workspace', 'user' |
| `resource_id` | TEXT | | |
| `details` | TEXT (JSON) | | Arbitrary metadata |
| `ip_address` | TEXT | | |
| `created_at` | TIMESTAMP | NOT NULL | |

```sql
CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT REFERENCES users(id),
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    details TEXT DEFAULT '{}',
    ip_address TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
```

### 3.3 ChromaDB Collection Schemas (Vector Store)

#### Collection: `workspace_chunks`

One collection per workspace (named `ws_{workspace_id}_chunks`) — or a single collection with workspace_id filter.

| Field | Type | Description |
|-------|------|-------------|
| `id` | str | `{document_id}:{chunk_index}` |
| `embedding` | list[float] | 768-dim from BGE-base-en-v1.5 |
| `metadata` | dict | See below |

**Metadata fields:**
```json
{
  "document_id": "uuid",
  "chunk_id": "uuid",
  "workspace_id": "uuid",
  "chunk_index": 0,
  "document_name": "report.pdf",
  "page_number": 5,
  "token_count": 256,
  "created_at": "2026-06-20T12:00:00Z"
}
```

**Distance function:** `cosine`

#### Collection: `query_cache` (optional, v2+)

| Field | Type | Description |
|-------|------|-------------|
| `id` | str | Hash of query + top_k |
| `embedding` | list[float] | Query embedding |
| `metadata` | dict | `{query_text, workspace_id, top_chunks, trust_score}` |

### 3.4 BM25 Index

Maintained per workspace as an in-memory index persisted to disk alongside ChromaDB:

- **Storage:** `data/bm25/{workspace_id}/index.pkl`
- **Rebuilt on:** each document ingestion (incremental update)
- **Implementation:** `rank_bm25.BM25Okapi` with custom tokenizer

---

## 4. API Contract

### 4.1 Base URL

- **Development:** `http://localhost:8000/api`
- **Production:** `https://{host}/api`

### 4.2 Authentication

**Scheme:** Bearer JWT

```
Authorization: Bearer <access_token>
```

**Token lifecycle:**
- Access token: 30 minutes (short-lived)
- Refresh token: 7 days (rotated on use)
- Tokens stored client-side in httpOnly cookie or memory

### 4.3 Standard Response Envelope

```json
// Success
{
  "data": { ... },
  "meta": {
    "page": 1,
    "page_size": 20,
    "total": 100
  }
}

// Error
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "Email already registered",
    "details": { "field": "email" }
  }
}
```

### 4.4 REST Endpoints

---

#### Auth

| Method | Path | Auth | Request | Response | Notes |
|--------|------|------|---------|----------|-------|
| `POST` | `/auth/register` | No | `RegisterRequest` | `AuthResponse` | Create account |
| `POST` | `/auth/login` | No | `LoginRequest` | `AuthResponse` | Get tokens |
| `POST` | `/auth/refresh` | No | `RefreshRequest` | `AuthResponse` | Rotate tokens |
| `GET` | `/auth/me` | Yes | — | `UserResponse` | Current user |
| `PUT` | `/auth/me` | Yes | `UserUpdateRequest` | `UserResponse` | Update profile |
| `DELETE` | `/auth/me` | Yes | — | `204` | Delete account |

**`POST /auth/register`**
```json
// Request
{
  "email": "user@example.com",
  "username": "johndoe",
  "password": "SecureP@ss1"       // min 8 chars, 1 upper, 1 digit
}

// Response (201)
{
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "username": "johndoe",
      "role": "user",
      "created_at": "2026-06-20T12:00:00Z"
    },
    "access_token": "eyJ...",
    "refresh_token": "eyJ...",
    "token_type": "bearer",
    "expires_in": 1800
  }
}
```

**`POST /auth/login`**
```json
// Request
{
  "email": "user@example.com",
  "password": "SecureP@ss1"
}

// Response (200)
{
  "data": {
    "user": { "id": "uuid", "email": "...", "username": "..." },
    "access_token": "eyJ...",
    "refresh_token": "eyJ...",
    "token_type": "bearer",
    "expires_in": 1800
  }
}
```

---

#### Users (Admin)

| Method | Path | Auth | Request | Response | Notes |
|--------|------|------|---------|----------|-------|
| `GET` | `/users` | Admin | — | `PaginatedResponse<UserResponse>` | List all |
| `GET` | `/users/{id}` | Admin | — | `UserResponse` | Get by ID |

---

#### Workspaces

| Method | Path | Auth | Request | Response | Notes |
|--------|------|------|---------|----------|-------|
| `POST` | `/workspaces` | Yes | `WorkspaceCreate` | `WorkspaceResponse` | Creator becomes owner |
| `GET` | `/workspaces` | Yes | — | `ListResponse<WorkspaceSummary>` | User's workspaces |
| `GET` | `/workspaces/{id}` | Yes | — | `WorkspaceResponse` | With member count |
| `PUT` | `/workspaces/{id}` | Owner | `WorkspaceUpdate` | `WorkspaceResponse` | |
| `DELETE` | `/workspaces/{id}` | Owner | — | `204` | Cascade deletes documents |
| `POST` | `/workspaces/{id}/members` | Owner | `MemberAdd` | `MemberResponse` | Add user |
| `PUT` | `/workspaces/{id}/members/{user_id}` | Owner | `MemberUpdate` | `MemberResponse` | Change role |
| `DELETE` | `/workspaces/{id}/members/{user_id}` | Owner | — | `204` | Remove member |
| `GET` | `/workspaces/{id}/members` | Yes | — | `ListResponse<MemberResponse>` | |

**`POST /workspaces`**
```json
// Request
{
  "name": "Research Papers",
  "description": "AI research paper analysis"
}

// Response (201)
{
  "data": {
    "id": "uuid",
    "name": "Research Papers",
    "description": "AI research paper analysis",
    "owner_id": "uuid",
    "member_count": 1,
    "document_count": 0,
    "created_at": "2026-06-20T12:00:00Z"
  }
}
```

---

#### Documents

| Method | Path | Auth | Request | Response | Notes |
|--------|------|------|---------|----------|-------|
| `POST` | `/workspaces/{id}/documents` | Yes | Multipart form | `DocumentResponse` | Upload file |
| `GET` | `/workspaces/{id}/documents` | Yes | Query params | `PaginatedResponse<DocumentResponse>` | List, filter by status |
| `GET` | `/workspaces/{id}/documents/{doc_id}` | Yes | — | `DocumentDetailResponse` | Includes chunk list |
| `GET` | `/workspaces/{id}/documents/{doc_id}/status` | Yes | — | `DocumentStatusResponse` | Poll processing status |
| `DELETE` | `/workspaces/{id}/documents/{doc_id}` | Yes | — | `204` | Removes from ChromaDB too |

**Supported file types:**
| MIME Type | Extension |
|-----------|-----------|
| `application/pdf` | .pdf |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | .docx |
| `text/plain` | .txt |
| `text/markdown` | .md |
| `text/csv` | .csv |
| `application/json` | .json |

**`POST /workspaces/{id}/documents`**
```
// Request: multipart/form-data
file: <binary>
// Max file size: 50MB (configurable)
```

```json
// Response (202 — Accepted)
{
  "data": {
    "id": "uuid",
    "filename": "a1b2c...uuid.pdf",
    "original_filename": "research_paper.pdf",
    "mime_type": "application/pdf",
    "file_size": 2458677,
    "status": "pending",
    "created_at": "2026-06-20T12:00:00Z"
  }
}
```

---

#### Queries

| Method | Path | Auth | Request | Response | Notes |
|--------|------|------|---------|----------|-------|
| `POST` | `/workspaces/{id}/query` | Yes | `QueryRequest` | See WebSocket | Synchronous path (future) |
| `GET` | `/workspaces/{id}/queries` | Yes | Query params | `PaginatedResponse<QuerySummary>` | History, paginated |
| `GET` | `/workspaces/{id}/queries/{query_id}` | Yes | — | `QueryDetailResponse` | Full query + response |
| `GET` | `/workspaces/{id}/queries/{query_id}/sources` | Yes | — | `ListResponse<SourceResponse>` | Cited chunks with excerpts |
| `DELETE` | `/workspaces/{id}/queries/{query_id}` | Yes | — | `204` | |

---

#### Feedback

| Method | Path | Auth | Request | Response | Notes |
|--------|------|------|---------|----------|-------|
| `POST` | `/queries/{query_id}/feedback` | Yes | `FeedbackCreate` | `FeedbackResponse` | Rate 1-5 |
| `GET` | `/queries/{query_id}/feedback` | Yes | — | `ListResponse<FeedbackResponse>` | |

---

#### Admin

| Method | Path | Auth | Request | Response | Notes |
|--------|------|------|---------|----------|-------|
| `GET` | `/admin/stats` | Admin | — | `AdminStatsResponse` | System-wide metrics |
| `GET` | `/admin/logs` | Admin | Query params | `PaginatedResponse<AuditLogResponse>` | Audit log |
| `GET` | `/admin/evaluation` | Admin | — | `EvaluationResponse` | RAGAS scores |
| `POST` | `/admin/evaluation/run` | Admin | — | `202` | Trigger eval on golden set |

---

### 4.5 WebSocket Protocol (`ws://host/api/ws/query`)

#### Connection

```
ws://host/api/ws/query?token=<access_token>
```

Server validates token on connect. Returns error if invalid/expired.

#### Client → Server Messages

```json
// Query submission
{
  "type": "query",
  "payload": {
    "workspace_id": "uuid",
    "query": "What are the key findings from the Q3 report?",
    "top_k": 5,
    "filters": {
      "document_ids": ["uuid1", "uuid2"]  // optional
    }
  }
}

// Cancel in-flight query
{
  "type": "cancel",
  "payload": {}
}

// Feedback during session (optional)
{
  "type": "feedback",
  "payload": {
    "query_id": "uuid",
    "rating": 4,
    "comment": "Good but could be more specific"
  }
}
```

#### Server → Client Messages

```json
// Query acknowledged
{
  "type": "ack",
  "payload": {
    "query_id": "uuid",
    "status": "processing"
  }
}

// Token stream (one per chunk of text)
{
  "type": "token",
  "payload": {
    "query_id": "uuid",
    "token": "The",
    "index": 0
  }
}

// Signal end of stream
{
  "type": "stream_end",
  "payload": {
    "query_id": "uuid"
  }
}

// Sources found (sent after retrieval, before generation)
{
  "type": "sources",
  "payload": {
    "query_id": "uuid",
    "sources": [
      {
        "chunk_id": "uuid",
        "document_id": "uuid",
        "document_name": "q3_report.pdf",
        "excerpt": "Revenue increased by 23% in Q3...",
        "relevance_score": 0.89,
        "rerank_score": 0.94,
        "page_number": 5
      }
    ]
  }
}

// Guardrail result
{
  "type": "guardrail",
  "payload": {
    "query_id": "uuid",
    "passed": true,
    "score": 0.96,          // 0.0-1.0, higher = more faithful
    "details": "All claims supported by retrieved chunks"
  }
}

// Trust score (final)
{
  "type": "trust_score",
  "payload": {
    "query_id": "uuid",
    "score": 0.87,
    "components": {
      "retrieval_quality": 0.91,
      "faithfulness": 0.96,
      "relevance": 0.85,
      "source_authority": 0.75
    }
  }
}

// Query complete (terminal)
{
  "type": "complete",
  "payload": {
    "query_id": "uuid",
    "latency_ms": 4320,
    "model_used": "llama3.1:8b",
    "token_count": 386
  }
}

// Error
{
  "type": "error",
  "payload": {
    "code": "GUARDRAIL_FAILED",
    "message": "Generated response contains unsupported claims. Please rephrase your query.",
    "query_id": "uuid"
  }
}

// Progress for long operations (retrieval, generation phases)
{
  "type": "progress",
  "payload": {
    "query_id": "uuid",
    "phase": "retrieval",   // "retrieval" | "generation" | "guardrail" | "evaluation"
    "progress": 0.5         // 0.0-1.0
  }
}
```

#### Message Sequence (Normal Flow)

```
Client                          Server
  │                               │
  │── {type: "query", ...} ──────>│
  │                               │
  │<── {type: "ack", ...} ────────│
  │<── {type: "progress", phase: "retrieval", 0.3}
  │<── {type: "sources", ...} ────│   ← Retrieved chunks
  │<── {type: "progress", phase: "generation", 0.5}
  │<── {type: "token", "The"} ────│   ← Streaming start
  │<── {type: "token", " key"} ───│
  │<── {type: "token", " findings"} ─│
  │<── {type: "stream_end"} ──────│
  │<── {type: "guardrail", ...} ──│   ← Hallucination check
  │<── {type: "trust_score", ...}─│
  │<── {type: "complete", ...} ───│
```

---

### 4.6 Error Codes

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `INVALID_INPUT` | 400 | Validation failure |
| `UNAUTHORIZED` | 401 | Missing/invalid token |
| `TOKEN_EXPIRED` | 401 | Access token expired |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Duplicate resource |
| `TOO_LARGE` | 413 | File exceeds size limit |
| `UNSUPPORTED_TYPE` | 415 | Unsupported file format |
| `RATE_LIMITED` | 429 | Too many requests |
| `GUARDRAIL_FAILED` | 422 | Response failed hallucination check |
| `INGESTION_FAILED` | 500 | Document processing error |
| `LLM_UNAVAILABLE` | 503 | Ollama not reachable |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## 5. Component Interfaces

Each module boundary is defined using Python dataclasses/protocols. These are the contracts that enable parallel development across the five team members.

### 5.1 Ingestion Module

**File:** `app/ingestion/`

```python
"""ingestion/interfaces.py — Module boundary contracts"""

from dataclasses import dataclass, field
from typing import Protocol, AsyncIterator
from pathlib import Path
import numpy as np


# ─── Data Types ───────────────────────────────────────────────────

@dataclass
class Document:
    id: str
    workspace_id: str
    filename: str
    mime_type: str
    file_size: int
    upload_path: Path


@dataclass
class Chunk:
    id: str
    document_id: str
    index: int
    content: str
    token_count: int
    page_number: int | None = None
    metadata: dict = field(default_factory=dict)


@dataclass
class EmbeddingResult:
    chunk_id: str
    embedding: np.ndarray            # 768-dim float vector
    metadata: dict


# ─── Interface Protocols ──────────────────────────────────────────

class Loader(Protocol):
    """Load document from disk → list of page texts."""
    async def load(self, path: Path, mime_type: str) -> list[str]: ...


class Chunker(Protocol):
    """Split texts into overlapping chunks."""
    async def chunk(
        self,
        pages: list[str],
        document_id: str,
        chunk_size: int = 512,          # tokens
        chunk_overlap: int = 64,         # tokens
    ) -> list[Chunk]: ...


class Embedder(Protocol):
    """Convert text chunks → vector embeddings."""
    async def embed(self, chunks: list[Chunk]) -> list[EmbeddingResult]: ...

    @property
    def dimension(self) -> int: ...       # 768 for BGE-base

    @property
    def model_name(self) -> str: ...


class Indexer(Protocol):
    """Store embeddings in ChromaDB + update BM25 index."""
    async def store(
        self,
        embeddings: list[EmbeddingResult],
        workspace_id: str,
    ) -> int: ...                          # Number of chunks stored

    async def delete_document(
        self,
        document_id: str,
        workspace_id: str,
    ) -> None: ...

    async def delete_workspace(
        self,
        workspace_id: str,
    ) -> None: ...
```

---

### 5.2 Retrieval Module

**File:** `app/retrieval/`

```python
"""retrieval/interfaces.py — Module boundary contracts"""

from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class RetrievalResult:
    chunk_id: str
    document_id: str
    workspace_id: str
    content: str
    score: float                          # Combined hybrid score
    vector_score: float                   # Cosine similarity
    bm25_score: float                     # BM25 normalized score
    metadata: dict = field(default_factory=dict)


@dataclass
class RerankedResult(RetrievalResult):
    rerank_score: float = 0.0             # Cross-encoder score
    final_score: float = 0.0              # Weighted combination


class HybridSearch(Protocol):
    """Combine vector + BM25 results with reciprocal rank fusion."""
    async def hybrid_search(
        self,
        query: str,
        workspace_id: str,
        top_k: int = 10,
        filters: dict | None = None,
    ) -> list[RetrievalResult]: ...

    async def vector_search(
        self,
        query_embedding: list[float],
        workspace_id: str,
        top_k: int = 10,
        filters: dict | None = None,
    ) -> list[RetrievalResult]: ...

    async def bm25_search(
        self,
        query: str,
        workspace_id: str,
        top_k: int = 10,
    ) -> list[RetrievalResult]: ...


class Reranker(Protocol):
    """Cross-encoder reranking for more precise scoring."""
    async def rerank(
        self,
        query: str,
        results: list[RetrievalResult],
        top_k: int = 5,
    ) -> list[RerankedResult]: ...

    @property
    def model_name(self) -> str: ...       # 'BAAI/bge-reranker-v2-m3'


class QueryRewriter(Protocol):
    """LLM-based query reformulation for better retrieval."""
    async def rewrite(
        self,
        query: str,
        conversation_history: list[dict] | None = None,
    ) -> str: ...

    async def expand(
        self,
        query: str,
        n_variations: int = 3,
    ) -> list[str]: ...
```

---

### 5.3 Generation Module

**File:** `app/generation/`

```python
"""generation/interfaces.py — Module boundary contracts"""

from dataclasses import dataclass, field
from typing import Protocol, AsyncIterator


@dataclass
class GenerationInput:
    query: str
    rewritten_query: str | None = None
    contexts: list[dict] = field(default_factory=list)   # [{chunk_id, content, score}]
    conversation_history: list[dict] = field(default_factory=list)
    system_prompt: str | None = None


@dataclass
class CitedSpan:
    text: str
    chunk_id: str
    start_index: int
    end_index: int


@dataclass
class GenerationResult:
    text: str                           # Full generated answer
    cited_spans: list[CitedSpan] = field(default_factory=list)
    token_count: int = 0
    model_used: str = ""
    latency_ms: int = 0


@dataclass
class GuardrailResult:
    passed: bool
    score: float                        # 0.0-1.0, higher = more faithful
    unsupported_claims: list[str] = field(default_factory=list)
    details: str = ""


class Generator(Protocol):
    """Generate answer from retrieved context."""
    async def generate(
        self,
        input: GenerationInput,
    ) -> GenerationResult: ...

    async def stream(
        self,
        input: GenerationInput,
    ) -> AsyncIterator[str]: ...        # Token-by-token async generator

    @property
    def model_name(self) -> str: ...


class Citer(Protocol):
    """Match answer spans back to source chunks."""
    async def cite(
        self,
        answer: str,
        contexts: list[dict],
    ) -> list[CitedSpan]: ...


class Guardrail(Protocol):
    """NLI-based hallucination detection on generated answer."""
    async def check(
        self,
        answer: str,
        contexts: list[dict],
    ) -> GuardrailResult: ...

    @property
    def threshold(self) -> float: ...    # Default 0.7
```

---

### 5.4 Evaluation Module

**File:** `app/evaluation/`

```python
"""evaluation/interfaces.py — Module boundary contracts"""

from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class TrustScoreComponents:
    retrieval_quality: float            # 0.0-1.0
    faithfulness: float                 # Guardrail score
    relevance: float                    # How relevant to query
    source_authority: float             # Source quality signals
    overall: float = 0.0


@dataclass
class RagasScores:
    faithfulness: float
    answer_relevance: float
    context_precision: float
    context_recall: float
    answer_correctness: float | None = None


@dataclass
class FeedbackData:
    query_id: str
    user_id: str | None
    rating: int                         # 1-5
    comment: str | None = None


class TrustScorer(Protocol):
    """Compute overall trust score from multiple signals."""
    async def compute(
        self,
        retrieval_results: list,
        guardrail_result: GuardrailResult,
        generation_result: GenerationResult,
        query: str,
    ) -> TrustScoreComponents: ...


class RagasEvaluator(Protocol):
    """Evaluate RAG pipeline quality using RAGAS metrics."""
    async def evaluate(
        self,
        queries: list[str],
        answers: list[str],
        contexts: list[list[str]],
        ground_truth: list[str] | None = None,
    ) -> RagasScores: ...

    async def evaluate_single(
        self,
        query: str,
        answer: str,
        contexts: list[str],
        ground_truth: str | None = None,
    ) -> RagasScores: ...


class FeedbackIngester(Protocol):
    """Process user feedback and trigger re-evaluation."""
    async def ingest(
        self,
        feedback: FeedbackData,
    ) -> None: ...

    async def get_feedback_stats(
        self,
        workspace_id: str,
        days: int = 30,
    ) -> dict: ...                      # avg_rating, distribution, trends
```

---

### 5.5 Graph Orchestration (LangGraph)

**File:** `app/graph/`

```python
"""graph/interfaces.py — LangGraph state definitions"""

from dataclasses import dataclass, field
from typing import Literal, Annotated
from typing_extensions import TypedDict
import operator


class GraphState(TypedDict):
    """State passed between LangGraph nodes."""
    query: str
    rewritten_query: str | None
    workspace_id: str
    user_id: str | None
    query_id: str
    top_k: int
    filters: dict | None

    # Retrieval
    retrieval_results: list | None
    reranked_results: list | None

    # Generation
    contexts: list[dict] | None
    response_text: str | None
    cited_spans: list | None

    # Guardrail
    guardrail_result: dict | None
    guardrail_retry_count: int

    # Evaluation
    trust_score: float | None

    # Metadata
    model_used: str
    latency_ms: int
    error: str | None


@dataclass
class GraphNode:
    """Node definition for the LangGraph pipeline."""
    name: str
    description: str


# Graph topology (CRAG):
# rewrite_query → hybrid_search → rerank → decide_relevance
#   ├─ yes → generate → guardrail_check
#   │          ├─ pass → compute_trust → done
#   │          └─ fail → web_search (if online) or fallback → generate_again
#   └─ no  → query_expansion → hybrid_search (retry)
```

---

## 6. Data Flow

### 6.1 Document Upload → Ingestion Pipeline

```
┌──────┐   ┌──────────┐   ┌──────┐   ┌─────────┐   ┌──────────┐   ┌───────────┐
│Client│   │  API     │   │ DB   │   │ Loader  │   │ Chunker  │   │ Embedder  │
└──┬───┘   └────┬─────┘   └──┬───┘   └────┬────┘   └────┬─────┘   └─────┬────┘
   │            │            │            │             │              │
   │ POST /doc  │            │            │             │              │
   │ (multipart)│            │            │             │              │
   │───────────>│            │            │             │              │
   │            │            │            │             │              │
   │            │ INSERT doc │            │             │              │
   │            │ (pending)  │            │             │              │
   │            │───────────>│            │             │              │
   │<─── 202 ───│            │            │             │              │
   │ {doc_id}   │            │            │             │              │
   │            │            │            │             │              │
   │ (Background: Fire & Forget via Celery or asyncio task)          │
   │            │            │            │             │              │
   │            │ UPDATE doc │            │             │              │
   │            │ (processing)│           │             │              │
   │            │───────────>│            │             │              │
   │            │            │            │             │              │
   │            │ send path  │            │             │              │
   │            │────────────────────────>│             │              │
   │            │            │            │             │              │
   │            │            │       load(path)        │              │
   │            │            │─────────────────────────>              │
   │            │            │       return [pages]     │              │
   │            │            │<─────────────────────────│              │
   │            │            │            │             │              │
   │            │            │            │    chunk(pages)           │
   │            │            │            │───────────────────────────>
   │            │            │            │             │              │
   │            │            │            │    return [Chunks]        │
   │            │            │            │<───────────────────────────│
   │            │            │            │             │              │
   │            │            │            │             │  embed(chunks)
   │            │            │            │             │─────────────>
   │            │            │            │             │              │
   │            │            │            │             │ return vecs │
   │            │            │            │             │<─────────────│
   │            │            │            │             │              │
   │            │            │  INSERT chunks          │              │
   │            │            │<────────────────────────│              │
   │            │            │            │             │              │
   │            │            │            │             │  store(vecs) │
   │            │            │            │             │──────────────>│
   │            │            │            │             │              │
   │            │            │            │             │  (ChromaDB   │
   │            │            │            │             │   + BM25)    │
   │            │            │            │             │              │
   │            │            │            │             │  return ok   │
   │            │            │            │             │<──────────────│
   │            │            │            │             │              │
   │            │ UPDATE doc │            │             │              │
   │            │ (ready, n_chunks)      │             │              │
   │            │───────────>│            │             │              │
   │            │            │            │             │              │
   │ Client polls GET /status            │             │              │
   │─────────────────────────────────────────────────────────────────>│
```

### 6.2 User Query → Retrieval → Generation → Response (Streaming)

```
┌──────┐   ┌──────────┐   ┌─────────┐   ┌────────┐   ┌───────┐   ┌──────┐
│Client│   │   WS     │   │Rewrite  │   │Hybrid  │   │Reranker│   │Ollama│
│(React│   │ Handler  │   │Query    │   │Search  │   │        │   │      │
│ UI)  │   │          │   │         │   │        │   │        │   │      │
└──┬───┘   └────┬─────┘   └────┬────┘   └───┬────┘   └───┬────┘   └──┬───┘
   │            │              │            │            │           │
   │ WS connect │              │            │            │           │
   │───────────>│              │            │            │           │
   │            │ validate JWT │            │            │           │
   │            │──────────────│            │            │           │
   │            │  ack         │            │            │           │
   │<───── ack ─│──────────────│            │            │           │
   │            │              │            │            │           │
   │ query msg  │              │            │            │           │
   │───────────>│              │            │            │           │
   │            │ progress(0.1)│            │            │           │
   │<──progress─│──────────────│            │            │           │
   │            │              │            │            │           │
   │            │ rewrite(q)   │            │            │           │
   │            │─────────────>│            │            │           │
   │            │              │  return rewritten       │           │
   │            │<─────────────│            │            │           │
   │            │              │            │            │           │
   │            │ progress(0.3)│            │            │           │
   │<──progress─│──────────────│            │            │           │
   │            │              │            │            │           │
   │            │ hybrid_search(rewritten, ws_id)        │           │
   │            │───────────────────────────────────────>│           │
   │            │              │            │            │           │
   │            │              │            │  return N results      │
   │            │<───────────────────────────────────────│           │
   │            │              │            │            │           │
   │            │ progress(0.5)│            │            │           │
   │            │ rerank(query, results)    │            │           │
   │            │───────────────────────────────────────>│           │
   │            │              │            │            │           │
   │            │              │            │  return top_k reranked │
   │            │<───────────────────────────────────────│           │
   │            │              │            │            │           │
   │            │ sources event             │            │           │
   │<───sources─│──────────────│            │            │           │
   │            │              │            │            │           │
   │            │ progress(0.6)│            │            │           │
   │<──progress─│──────────────│            │            │           │
   │            │              │            │            │           │
   │            │ generate(contexts)        │            │           │
   │            │───────────────────────────────────────────────────>│
   │            │              │            │            │           │
   │            │  token stream             │            │           │
   │<────token──│──────────────│            │            │           │
   │<────token──│──────────────│            │            │           │
   │<────token──│──────────────│            │            │           │
   │            │              │            │            │           │
   │            │ return complete answer    │            │           │
   │            │<───────────────────────────────────────────────────│
   │            │              │            │            │           │
   │            │ progress(0.8)            │            │           │
   │            │ guardrail(answer, contexts)           │           │
   │            │───────────────────────────────────────────────────>│
   │            │              │            │            │           │
   │            │ guardrail_result          │            │           │
   │<──guardrail│──────────────│            │            │           │
   │            │              │            │            │           │
   │            │ trust_score(...)          │            │           │
   │            │───────────────────────────│            │           │
   │            │              │            │            │           │
   │<──trust_scr│──────────────│            │            │           │
   │            │              │            │            │           │
   │<──complete─│──────────────│            │            │           │
```

### 6.3 Hallucination Guardrail Flow

```
              ┌──────────────────┐
              │  Generated Answer│
              │  + Retrieved     │
              │    Contexts      │
              └────────┬─────────┘
                       │
                       ▼
              ┌──────────────────┐
              │  Extract Claims  │
              │  (NLI model or   │
              │   LLM-as-judge)  │
              └────────┬─────────┘
                       │
                       ▼
              ┌──────────────────────────────────┐
              │  For each claim:                  │
              │  premise = concatenated contexts  │
              │  hypothesis = claim               │
              │  NLI inference:                   │
              │  entailment / contradiction / neut.│
              └────────┬─────────────────────────┘
                       │
                       ▼
            ┌──────────────────────┐
            │ Aggregate scores:    │
            │ entail_ratio =       │
            │ entail / (entail+cont)│
            └────────┬─────────────┘
                     │
                     ▼
         ┌───────────────────────────┐
         │ entail_ratio >= threshold? │
         │ (default 0.7)             │
         └───────────┬───────────────┘
                     │
          YES        │        NO
          │          │          │
          ▼          ▼          ▼
   ┌──────────┐  ┌────────────────────┐
   │ PASS     │  │  FAIL              │
   │ score=0.9│  │  score=0.4         │
   │ Send to  │  │  unsupported_claims│
   │ client   │  │  Try:              │
   └──────────┘  │  • Retrieve more   │
                 │  • Re-generate     │
                 │  • CRAG correction │
                 │  • Return error    │
                 └────────────────────┘
```

### 6.4 CRAG Self-Correction Loop

```
                   ┌──────────────┐
                   │  User Query  │
                   └──────┬───────┘
                          │
                          ▼
                   ┌──────────────┐
                   │ Query Rewrite│
                   └──────┬───────┘
                          │
                          ▼
                   ┌──────────────┐
                   │ Hybrid Search│
                   │ + Rerank     │
                   └──────┬───────┘
                          │
                          ▼
                   ┌──────────────┐
              ┌───>│ Check        │
              │    │ Relevance    │
              │    │ (LLM judge)  │
              │    └──────┬───────┘
              │           │
              │    ┌──────┴──────┐
              │    │             │
              │  Relevant    Not Relevant
              │    │             │
              │    ▼             ▼
              │  ┌────────┐  ┌──────────┐
              │  │Generate│  │Expand    │
              │  │Answer  │  │Query     │
              │  └───┬────┘  └────┬─────┘
              │      │            │
              │      ▼            │
              │  ┌────────┐      │
              │  │Guardrail│      │
              │  │Check   │      │
              │  └───┬────┘      │
              │      │           │
              │  ┌───┴───┐      │
              │  │       │      │
              │ Pass   Fail     │
              │  │       │      │
              │  │   ┌───┴───┐  │
              │  │   │Retry  │  │
              │  │   │Count<3│  │
              │  │   └───┬───┘  │
              │  │       │ YES  │
              │  │       ├──────┘
              │  │       │
              │  │       ▼
              │  │   ┌──────────┐
              │  │   │Fallback  │
              │  │   │Model     │
              │  │   │(Phi-3)   │
              │  │   └────┬─────┘
              │  │        │
              │  │        ▼
              │  │   ┌──────────┐
              │  │   │Generate  │
              │  │   │(no guard │
              │  │   │ needed)  │
              │  │   └────┬─────┘
              │  │        │
              │  ▼        ▼
              │  ┌──────────────┐
              │  │ Compute Trust│
              │  │ Score        │
              │  └──────┬───────┘
              │         │
              │         ▼
              │  ┌──────────────┐
              └──│  Response    │
                 │  to Client   │
                 └──────────────┘
```

**CRAG Graph Decision Logic:**

```
Node: decide_relevance
  Input: reranked_results, query
  LLM-judge: "Are these chunks sufficient to answer the query?"
  If YES → route to "generate"
  If NO  → route to "expand_query"

Node: guardrail_check
  Input: response_text, contexts
  NLI model: entailment ratio
  If >= threshold (0.7) → route to "compute_trust"
  If < threshold AND retry_count < 3 → route to "retrieve_more" (re-expand)
  If < threshold AND retry_count >= 3 → route to "fallback" (Phi-3, relaxed)
```

---

## 7. Module Boundaries

### 7.1 Team Composition (5 Members)

| Role | Owner | Module | Key Files | First Milestone |
|------|-------|--------|-----------|-----------------|
| **Ingestion** | Member A | `app/ingestion/` | loader.py, chunker.py, embedder.py, indexer.py | Load & index a PDF → ChromaDB |
| **Retrieval** | Member B | `app/retrieval/` | hybrid_search.py, reranker.py, query_rewrite.py | Hybrid search returns top-5 relevant chunks |
| **Generation** | Member C | `app/generation/`, `app/graph/` | generator.py, streamer.py, citer.py, guardrail.py, crag_graph.py | Streaming answer with citations from context |
| **Frontend** | Member D | `frontend/` | Chat UI, upload, auth screens, WS client | Chat interface consumes WebSocket stream |
| **Eval/DevOps** | Member E | `app/evaluation/`, `app/core/`, `app/api/`, Docker, CI | trust_score.py, ragas_eval.py, auth.py, all API routes | Full API routes working, Docker Compose up |

### 7.2 Interface Contracts & Dependencies

```
Ingestion ──> Indexer.store(embeddings, workspace_id)
    │
    │  Provides: ChromaDB collection + BM25 index
    ▼
Retrieval ──> HybridSearch.hybrid_search(query, workspace_id)
    │         Reranker.rerank(query, results)
    │         QueryRewriter.rewrite(query)
    │
    │  Provides: top-k reranked chunks
    ▼
Generation ──> Generator.generate(input)
    │           Generator.stream(input)
    │           Guardrail.check(answer, contexts)
    │           Citer.cite(answer, contexts)
    │
    │  Provides: final answer + citations + guardrail result
    ▼
Evaluation ──> TrustScorer.compute(...)
    │           FeedbackIngester.ingest(...)
    │
    │  Provides: quality metrics, feedback data
    ▼
Frontend ──> WebSocket + REST API
    │
    │  Provides: user interface
    ▼
Eval/DevOps ──> API routes, auth, eval, Docker, CI
```

### 7.3 Parallel Development Strategy

| Week | Ingestion (A) | Retrieval (B) | Generation (C) | Frontend (D) | Eval/DevOps (E) |
|------|---------------|---------------|----------------|---------------|-----------------|
| **1** | Loader (PDF/TXT), Chunker | ChromaDB setup, vector search | Ollama integration, basic generate | Vite scaffold, Tailwind, WS mock | FastAPI skeleton, SQLite models, Alembic |
| **2** | Embedder (BGE-base), Indexer | BM25 integration, hybrid fusion | Streaming token generator, SSE/WS | Chat UI with mock stream, message display | JWT auth, user/workspace CRUD, Dockerfile |
| **3** | DOCX/MD/CSV support, retry logic | Cross-encoder reranker | Citation matcher, prompt templates | Upload UI, doc list with status | Document routes, file storage, audit logging |
| **4** | Error handling, status reporting | Query rewriting | NLI guardrail implementation | Source cards, trust badge | Admin routes, rate limiting, CI setup |
| **5** | Chunk overlap tuning, metadata | Query expansion, multi-query | Trust score integration | "Why this answer?" panel | Docker Compose (app+Ollama), E2E tests |
| **6** | Re-ingestion on doc update | Filter/semantic search | Guardrail tuning, edge cases | Workspace management, member UI | RAGAS golden dataset, eval pipeline |
| **7** | Image/chart extraction (PDF) | CRAG relevance check node | CRAG graph end-to-end | Dark mode, responsive, loading | Multi-user load testing, perf tuning |
| **8** | Table extraction, OCR prep | Cross-workspace search | Feedback loop integration | Analytics dashboard | Security audit, HF Spaces deploy |

### 7.4 Shared Files (everyone touches)

| File | Reason | Primary |
|------|--------|---------|
| `app/schemas/` | Everyone defines request/response shapes | E (coordinates) |
| `app/models/` | Data model changes affect all | E (maintains) |
| `app/config.py` | New env vars from any module | E (maintains) |
| `app/graph/query_graph.py` | Pipeline orchestration connects all modules | C (maintains) |
| `frontend/src/api/` | API client mirrors backend routes | D (maintains) |
| `docker-compose.yml` | Service wiring | E (maintains) |

---

## 8. Configuration

### 8.1 Environment Variables (`.env`)

```bash
# ─── App ─────────────────────────────────────────────────────────
APP_NAME=VeritasRAG
APP_VERSION=0.1.0
APP_ENV=development                      # development | production
APP_SECRET_KEY=your-secret-key-here      # min 32 chars, generate with: openssl rand -hex 32
APP_CORS_ORIGINS=http://localhost:5173,http://localhost:4000

# ─── Server ──────────────────────────────────────────────────────
SERVER_HOST=0.0.0.0
SERVER_PORT=8000
SERVER_WORKERS=4                         # Only in production (Uvicorn workers)
SERVER_MAX_UPLOAD_SIZE=52428800           # 50MB in bytes

# ─── Database (SQLite) ───────────────────────────────────────────
DB_URL=sqlite+aiosqlite:///./data/truthlens.db
DB_ECHO=false                            # SQL logging (dev only)

# ─── Vector Store (ChromaDB) ─────────────────────────────────────
CHROMA_PERSIST_DIR=./data/chromadb
CHROMA_COLLECTION_PREFIX=ws_             # {prefix}{workspace_id}_chunks

# ─── Ollama ──────────────────────────────────────────────────────
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_PRIMARY_MODEL=llama3.1:8b
OLLAMA_FALLBACK_MODEL=phi3:3b
OLLAMA_EMBED_MODEL=bge-base:latest
OLLAMA_RERANK_MODEL=bge-reranker:latest   # Or use sentence-transformers directly
OLLAMA_TIMEOUT=120                        # Seconds
OLLAMA_MAX_TOKENS=2048
OLLAMA_TEMPERATURE=0.3                    # Low temp for factual answers
OLLAMA_TOP_P=0.9
OLLAMA_NUM_CTX=4096                       # Context window size

# ─── Sentence Transformers (fallback / local embed) ──────────────
# Used when Ollama embedding is slow or unavailable
EMBED_MODEL_NAME=BAAI/bge-base-en-v1.5
EMBED_DIMENSION=768
EMBED_DEVICE=cpu                          # cpu | mps (Apple Silicon) | cuda
RERANK_MODEL_NAME=BAAI/bge-reranker-v2-m3

# ─── Retrieval ───────────────────────────────────────────────────
RETRIEVAL_TOP_K=10                        # Initial retrieval count
RETRIEVAL_RERANK_K=5                      # After re-ranking
RETRIEVAL_BM25_WEIGHT=0.3                 # BM25 weight in hybrid fusion
RETRIEVAL_VECTOR_WEIGHT=0.7               # Vector weight in hybrid fusion
RETRIEVAL_RERANK_WEIGHT=0.6               # Rerank score weight in final ordering
RETRIEVAL_MIN_SCORE=0.3                   # Minimum score threshold

# ─── Guardrail ───────────────────────────────────────────────────
GUARDRAIL_THRESHOLD=0.7                   # Minimum entailment ratio
GUARDRAIL_MAX_RETRIES=3                   # Max CRAG correction attempts
GUARDRAIL_NLI_MODEL=microsoft/deberta-v3-base  # Local NLI model

# ─── Chunking ────────────────────────────────────────────────────
CHUNK_SIZE=512                             # Tokens per chunk
CHUNK_OVERLAP=64                           # Overlap between chunks
CHUNK_SEPARATORS=["\n\n", "\n", ".", "!", "?", ",", " ", ""]

# ─── Query Rewriting ─────────────────────────────────────────────
REWRITE_ENABLED=true
REWRITE_TEMPERATURE=0.2
REWRITE_MAX_TOKENS=256

# ─── Trust Score ─────────────────────────────────────────────────
TRUST_RETRIEVAL_WEIGHT=0.3
TRUST_FAITHFULNESS_WEIGHT=0.4
TRUST_RELEVANCE_WEIGHT=0.2
TRUST_SOURCE_WEIGHT=0.1

# ─── JWT Auth ────────────────────────────────────────────────────
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=30
JWT_REFRESH_TOKEN_EXPIRE_DAYS=7
JWT_ALGORITHM=HS256
JWT_ISSUER=veritasrag

# ─── Rate Limiting ───────────────────────────────────────────────
RATE_LIMIT_ENABLED=true
RATE_LIMIT_REQUESTS=30                     # Per minute
RATE_LIMIT_WINDOW=60                       # Seconds

# ─── Logging ─────────────────────────────────────────────────────
LOG_LEVEL=INFO                             # DEBUG | INFO | WARNING | ERROR
LOG_FORMAT=json                            # json | text

# ─── Data Paths ──────────────────────────────────────────────────
DATA_DIR=./data
UPLOAD_DIR=./data/uploads
BM25_INDEX_DIR=./data/bm25
TRUST_MODEL_DIR=./data/models

# ─── PII Redaction ───────────────────────────────────────────────
PII_REDACTION_ENABLED=true
PII_ENTITIES=EMAIL,PHONE,SSN,CREDIT_CARD,ADDRESS
```

### 8.2 Default Settings by Environment

| Setting | Development | Production |
|---------|-------------|------------|
| `APP_ENV` | `development` | `production` |
| `LOG_LEVEL` | `DEBUG` | `WARNING` |
| `LOG_FORMAT` | `text` | `json` |
| `DB_ECHO` | `true` | `false` |
| `SERVER_WORKERS` | 1 | 4 |
| `RATE_LIMIT_ENABLED` | `false` | `true` |

### 8.3 Model Download Script

**`scripts/download_models.sh`**

```bash
#!/bin/bash
# Pull all required models

# Ollama models
ollama pull llama3.1:8b        # Primary LLM (~4.7GB)
ollama pull phi3:3b             # Fallback LLM (~2.2GB)
ollama pull bge-base:latest     # Embedding model (~130MB)

# NLI model for guardrail (downloads to HuggingFace cache)
python -c "from sentence_transformers import CrossEncoder; CrossEncoder('BAAI/bge-reranker-v2-m3')"

# NLI model
python -c "from transformers import AutoModel; AutoModel.from_pretrained('microsoft/deberta-v3-base')"

echo "All models downloaded."
```

---

## 9. Architecture Decision Records

### ADR-001: SQLite over PostgreSQL (MVP)

- **Context:** Need a database for app state. No DevOps capacity in MVP.
- **Decision:** Use SQLite with aiosqlite. Schema migrations via Alembic.
- **Consequences:** No separate DB server. Data stored on disk. Single-writer — OK for single-server deployment. Future: swap `DB_URL` to asyncpg PostgreSQL when horizontal scale needed.
- **Migration path:** Alembic handles migration; replace `aiosqlite` with `asyncpg` in `database.py`; no ORM code changes.

### ADR-002: ChromaDB over Pinecone/Weaviate/Qdrant

- **Context:** Need vector storage that's free, local, and simple.
- **Decision:** ChromaDB persisted to disk. One collection per workspace.
- **Consequences:** Scales to ~1M chunks before perf degrades. No network dependency. Data travels with the app. Migration to Qdrant if beyond 1M chunks.

### ADR-003: LangChain + LangGraph over custom orchestration

- **Context:** Need flexible pipeline composition, streaming, and a CRAG loop.
- **Decision:** Use LangChain for LLM/tool abstraction, LangGraph for graph-based pipeline with branching/looping.
- **Consequences:** Added dependency weight (~50MB). But CRAG loop requires conditional branching — LangGraph's `StateGraph` with conditional edges is cleaner than hand-rolled state machines. Pin LangChain versions (0.3.x) to avoid breaking changes.

### ADR-004: WebSocket over SSE for streaming

- **Context:** Need bidirectional communication (cancel query, send feedback mid-stream).
- **Decision:** Use WebSocket (FastAPI native) for the query endpoint.
- **Consequences:** Persistent connection per client. Scales fine for C10K. Need to manage reconnection logic on frontend.

### ADR-005: Local NLI guardrail over LLM-as-judge

- **Context:** Need hallucination detection that doesn't call an LLM (cost, latency).
- **Decision:** Use a dedicated NLI model (microsoft/deberta-v3-base) for claim entailment checking.
- **Consequences:** Adds ~500MB model. ~100ms inference per claim. More deterministic and interpretable than LLM-as-judge. Can fall back to LLM judgment if NLI unavailable.

### ADR-006: BGE-base embeddings over OpenAI/text-embedding-3

- **Context:** Must be free and local.
- **Decision:** BGE-base-en-v1.5 (768d). Sentence-transformers for inference.
- **Consequences:** 768 dimensions vs OpenAI's 1536 — slightly less expressive but 4x faster and fully offline. Compatible with all major rerankers.

### ADR-007: rank_bm25 for lexical search

- **Context:** Hybrid search needs a lexical component.
- **Decision:** rank_bm25 library, BM25Okapi variant.
- **Consequences:** Pure Python, no system dependencies. Index stored as pickle. Rebuilt incrementally on doc upload. ~1M docs before perf consideration.

---

## 10. Risk Assessment & Threat Model

### 10.1 Risk Matrix

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Ollama model OOM on 8GB RAM | High | High | Implement Phi-3 fallback (2.2GB vs 4.7GB). Monitor RSS. Auto-detect and downgrade. |
| ChromaDB corruption on crash | Low | High | Periodic collection snapshots. `DELETE + re-embed` on corruption detect. |
| SQLite write contention | Medium | Medium | WAL mode enabled. Retry on `database is locked` (tenacity). Migrate to PostgreSQL if needed. |
| Prompt injection via uploaded documents | Medium | High | Input sanitization in chunker. PII redaction (Presidio). Analyze-and-reject suspicious queries. Strict system prompts. |
| JWT token theft | Medium | High | Short-lived access tokens (30 min). Refresh token rotation. httpOnly cookies (production). |
| Large PDF processing timeout | Medium | Low | Background task with progress reporting. 50MB file limit. Streaming chunk processing. |
| Hallucination in edge cases | Medium | Medium | NLI guardrail with configurable threshold. CRAG retry loop. User feedback for continuous improvement. |
| ChromaDB + BM25 index out of sync | Low | Medium | Transactional update: both success or both rolled back. Periodic consistency check. |

### 10.2 Threat Model (STRIDE per Component)

| Component | Spoofing | Tampering | Repudiation | Info Disclosure | DoS | Elevation |
|-----------|----------|-----------|-------------|-----------------|-----|-----------|
| **FastAPI** | JWT signatures validated | Request body validated by Pydantic | Audit log on every write | CORS restricted, HTTPS required | Rate limiting, max body size | Role-based access (user/admin) |
| **SQLite** | N/A (local) | File permissions | Audit log table | Data encrypted at rest via SQLCipher (future) | WAL mode, conn pooling | N/A (accessed only via app) |
| **ChromaDB** | N/A (local) | File permissions | N/A | Vectors don't contain raw text (only metadata) | Collection size limits | N/A |
| **Ollama** | API bound to localhost | No user input in system prompts | Query logging | Prompts contain user queries (logged) | Model timeout, max tokens | N/A (stateless) |
| **Frontend** | JWT in httpOnly cookie | CSP headers, input validation | N/A | No secrets in bundle | WebSocket reconnection limits | Role-based UI rendering |
| **WebSocket** | Token validated on connect | Message schema validated | Query stored in DB | No PII in responses by default | Max message size, connection limits | Workspace membership check |

### 10.3 Security Hardening Checklist

- [ ] HTTPS in production (nginx reverse proxy)
- [ ] JWT stored in httpOnly, secure, SameSite cookies (production)
- [ ] CORS whitelist — no wildcard in production
- [ ] Rate limiting on /auth endpoints (login brute force)
- [ ] Password policy: min 8 chars, 1 uppercase, 1 digit
- [ ] File upload: validate MIME type server-side, not just extension
- [ ] File upload: scan with ClamAV if available (future)
- [ ] SQLite file permissions: 0640, not world-readable
- [ ] Ollama bound to 127.0.0.1 (not exposed in Docker Compose)
- [ ] Query logging: exclude sensitive user content if PII flag raised
- [ ] CSP headers: restrict script-src, style-src
- [ ] Rate limit per user per workspace: 30 queries/min
- [ ] Input sanitization: strip control characters from uploaded text
- [ ] Prompt injection: detect and reject queries containing system prompt overrides

---

## Appendices

### A. Dependencies (requirements.txt)

```
# --- Core ---
fastapi==0.111.0
uvicorn[standard]==0.29.0
pydantic==2.7.0
pydantic-settings==2.3.0
python-multipart==0.0.9

# --- Database ---
sqlalchemy[asyncio]==2.0.30
aiosqlite==0.20.0
alembic==1.13.0

# --- Auth ---
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
python-bcrypt==0.13.0

# --- LangChain / LangGraph ---
langchain==0.2.0
langchain-community==0.2.0
langgraph==0.2.0
langchain-ollama==0.1.0

# --- Vector Store ---
chromadb==0.5.0

# --- Embeddings ---
sentence-transformers==3.0.0

# --- Retrieval ---
rank-bm25==0.2.2

# --- NLI / Guardrail ---
transformers==4.41.0
torch==2.3.0

# --- PII ---
presidio-analyzer==2.2.0
presidio-anonymizer==2.2.0

# --- Monitoring ---
structlog==24.1.0
prometheus-client==0.20.0

# --- Utilities ---
tenacity==8.3.0
python-dateutil==2.9.0
filetype==1.2.0
PyMuPDF==1.24.0           # PDF extraction
python-docx==1.1.0        # DOCX extraction
markdown==3.6.0           # MD extraction

# --- Async ---
httpx==0.27.0
anyio==4.4.0
```

### B. ChromaDB Collection Lifecycle

```
document uploaded
       │
       ▼
GET or CREATE ChromaDB collection: ws_{workspace_id}_chunks
       │
       ▼
Chunk → Embed → Upsert to collection (batched, 100 at a time)
       │
       ▼
Update BM25 index (incremental)
       │
       ▼
Commit SQLite transaction (document.status = 'ready')

--- On delete ---
collection.delete(where={"document_id": doc_id})
Remove from BM25 index
SQLite: DELETE document, chunks (CASCADE)
```

### C. Key Metrics & SLIs

| Metric | Target | Measurement |
|--------|--------|-------------|
| Ingestion throughput | ≥50 pages/min | Chunks indexed / min |
| P95 query latency | <10s | Time from query → complete |
| P95 Time-to-first-token | <2s | Time until first `token` WS message |
| Retrieval latency | <500ms | Hybrid search + rerank |
| Generation latency | <8s (for 512 tokens) | Ollama generation time |
| Guardrail latency | <1s | NLI inference time |
| Hallucination rate | <3% | % of queries where guardrail fails |
| Trust score accuracy | ±0.1 vs human rating | Correlation with user feedback |
| Uptime | 99% | Docker health check |
| Memory (app) | <2GB RSS | `psutil` |
| Memory (Ollama) | <6GB RSS | Ollama metrics |

---

*Document version: 1.0 · Last updated: 2026-06-20 · Authors: VeritasRAG Architecture Team*
