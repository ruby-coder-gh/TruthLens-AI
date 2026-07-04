# CODEBASE.md — VeritasRAG (TruthLens AI)

**VeritasRAG** is an offline-first, full-stack Retrieval-Augmented Generation (RAG) platform built for grounded, cited, and confidence-scored question answering over private documents. It uses a FastAPI Python backend, a React + TypeScript + Vite frontend, LangGraph orchestration, ChromaDB vector search, BM25 keyword search, hybrid LLM provider (OpenAI-compatible API → Ollama fallback), and multi-signal trust scoring.

---

## Project Structure

```
TruthLens AI/
├── .env.example                 # Template for all env vars
├── .github/workflows/ci.yml    # GitHub Actions CI pipeline
├── .gitignore
├── ARCHITECTURE.md              # System architecture doc
├── PROJECT.md                   # Project overview
├── README.md                    # Setup & usage instructions
├── REPORT.md                    # Evaluation report
├── CODEBASE.md                  # This file
├── docker-compose.yml           # Multi-service Docker (ollama + app)
├── spaces.Dockerfile            # HuggingFace Spaces single-container
├── hf_spaces_setup.sh           # HF Spaces startup (Ollama bg + app)
├── run.sh                       # Local dev launcher (backend + frontend)
│
├── backend/
│   ├── Dockerfile               # Backend container (python:3.11-slim)
│   ├── alembic.ini              # Alembic migration config
│   ├── pyproject.toml           # Project metadata + dev dependencies
│   ├── requirements.txt         # Python runtime dependencies
│   ├── requirements-dev.txt     # Dev extras
│   │
│   ├── app/                     # Main application package
│   │   ├── main.py              # FastAPI app factory (lifespan, CORS, middleware)
│   │   ├── config.py            # Pydantic-settings (all env vars)
│   │   ├── database.py          # SQLAlchemy async engine + session factory
│   │   ├── chroma_client.py     # ChromaDB singleton client
│   │   │
│   │   ├── api/                 # REST + WebSocket route handlers
│   │   │   ├── router.py        # Aggregates all sub-routers
│   │   │   ├── auth.py          # /api/auth/* (register, login, refresh, me, etc.)
│   │   │   ├── users.py         # /api/users/* (admin user mgmt)
│   │   │   ├── workspaces.py    # /api/workspaces/* (CRUD + members)
│   │   │   ├── documents.py     # /workspaces/{id}/documents/* (upload, list, reindex)
│   │   │   ├── queries.py       # /workspaces/{id}/queries/* (history, detail)
│   │   │   ├── feedback.py      # /queries/{id}/feedback (submit, list)
│   │   │   ├── collections.py   # /workspaces/{id}/collections/* (CRUD + access)
│   │   │   ├── admin.py         # /api/admin/* (stats, logs, users, analytics)
│   │   │   ├── investigations.py# /workspaces/{id}/investigate (multi-step agent)
│   │   │   ├── comparisons.py   # /workspaces/{id}/comparisons/* (multi-doc compare)
│   │   │   └── ws.py            # /ws/query + /ws/compare (WebSocket streaming)
│   │   │
│   │   ├── core/                # Cross-cutting concerns
│   │   │   ├── auth.py          # JWT encode/decode, bcrypt hashing
│   │   │   ├── deps.py          # FastAPI DI (get_db, get_current_user, workspace access, UUID validation)
│   │   │   ├── exceptions.py    # Custom exceptions + error handlers
│   │   │   ├── security.py      # Rate limiter, security headers, PII redaction
│   │   │   └── validators.py    # UUID format validator (returns 422 on invalid input)
│   │   │
│   │   ├── models/              # SQLAlchemy ORM models
│   │   │   ├── base.py          # DeclarativeBase, TimestampMixin, UUIDPkMixin
│   │   │   ├── user.py          # User (email, username, password_hash, role)
│   │   │   ├── workspace.py     # Workspace + WorkspaceMember
│   │   │   ├── document.py      # Document (file metadata, status, chunks)
│   │   │   ├── chunk.py         # Chunk (text segments with index)
│   │   │   ├── query.py         # Query (question, answer, trust score, sources)
│   │   │   ├── feedback.py      # Feedback (rating, comment per query)
│   │   │   ├── collection.py    # Collection + CollectionAccess
│   │   │   ├── audit_log.py     # AuditLog (action trail)
│   │   │   └── eval_run.py      # EvalRun (RAGAS evaluation history)
│   │   │
│   │   ├── schemas/             # Pydantic request/response schemas
│   │   │   ├── auth.py          # LoginRequest, RegisterRequest, AuthResponse, etc.
│   │   │   ├── user.py          # UserResponse, UserUpdate
│   │   │   ├── workspace.py     # WorkspaceCreate, WorkspaceResponse, MemberAdd, etc.
│   │   │   ├── document.py      # DocumentResponse, DocumentDetailResponse, ChunkInfo
│   │   │   ├── query.py         # QuerySummary, QueryDetailResponse, SourceResponse
│   │   │   ├── feedback.py      # FeedbackCreate, FeedbackResponse
│   │   │   ├── collection.py    # CollectionCreate, CollectionResponse, CollectionAccess*
│   │   │   ├── investigation.py # InvestigationRequest, InvestigationResponse
│   │   │   ├── analytics.py     # AdminSettings*, UsageStats*, EvalRunResponse, etc.
│   │   │   ├── common.py        # PaginatedResponse, ListResponse, MessageResponse, etc.
│   │   │   └── ws.py            # WebSocket message types
│   │   │
│   │   ├── ingestion/           # Document processing pipeline
│   │   │   ├── loader.py        # Load PDF/DOCX/TXT/MD/CSV -> pages
│   │   │   ├── chunker.py       # RecursiveCharacterTextSplitter chunking
│   │   │   ├── embedder.py      # Sentence-transformers BGE embeddings
│   │   │   ├── indexer.py       # Store embeddings in ChromaDB + BM25 index
│   │   │   └── multimodal.py    # PDF image extraction + LLaVA vision descriptions
│   │   │
│   │   ├── retrieval/           # Search and scoring
│   │   │   ├── hybrid_search.py # Vector + BM25 fusion with RRF scoring
│   │   │   ├── reranker.py      # Cross-encoder BGE reranking
│   │   │   ├── query_rewrite.py # LLM-based query reformulation
│   │   │   └── parent_retrieval.py # Expand matched chunks with sibling context
│   │   │
│   │   ├── generation/          # Answer generation
│   │   │   ├── generator.py     # Ollama LLM invocation (context-grounded)
│   │   │   ├── streamer.py      # Async token streaming for WebSocket
│   │   │   ├── guardrail.py     # NLI-based hallucination detection
│   │   │   ├── citer.py         # Citation matching (answer span -> source)
│   │   │   └── safety.py        # Prompt-injection detection & sanitization
│   │   │
│   │   ├── graph/               # LangGraph orchestration pipelines
│   │   │   ├── ingestion_graph.py # Load -> chunk -> embed -> store
│   │   │   ├── query_graph.py   # Rewrite -> search -> rerank -> generate -> guardrail -> trust
│   │   │   ├── crag_graph.py    # CRAG self-correction loop (retry on low confidence)
│   │   │   └── investigation.py # Multi-step agent: decompose -> research -> synthesize
│   │   │
│   │   ├── evaluation/          # Quality metrics
│   │   │   ├── trust_score.py   # Multi-signal trust score (retrieval + faithfulness + relevance + source)
│   │   │   ├── ragas_eval.py    # RAGAS framework integration (faithfulness, relevance, precision, recall)
│   │   │   └── feedback_loop.py # Feedback ingestion + stats aggregation
│   │   │
│   │   └── utils/               # Utilities
│   │       ├── logger.py        # Structlog-based structured logging
│   │       ├── pii_redactor.py  # PII detection + redaction (regex + Presidio)
│   │       └── retry.py         # Tenacity-based async retry decorator
│   │
│   ├── migrations/              # Alembic DB migrations
│   │   ├── env.py
│   │   ├── script.py.mako
│   │   └── versions/
│   │       ├── 001_initial_schema.py
│   │       ├── 002_add_conversation_id.py
│   │       ├── 003_add_collections_eval_runs.py
│   │       └── 004_add_trust_score_index.py
│   │
│   ├── evaluation/              # CLI evaluation tooling
│   │   ├── evaluate.py          # Run RAGAS eval from CLI
│   │   └── golden_dataset.py    # Golden dataset definitions
│   │
│   ├── tests/                   # pytest test suite
│   │   ├── conftest.py
│   │   ├── test_main.py
│   │   ├── test_chroma.py
│   │   ├── test_database.py
│   │   ├── test_api/            # API integration tests
│   │   ├── test_evaluation/     # Trust score, RAGAS, feedback tests
│   │   ├── test_generation/     # Generator, guardrail, citer, streamer tests
│   │   ├── test_graph/          # Graph pipeline tests
│   │   ├── test_ingestion/      # Loader, chunker, embedder, indexer tests
│   │   ├── test_retrieval/      # Hybrid search, reranker, query rewrite tests
│   │   └── test_utils/          # Deps, PII redactor, retry tests
│   │
│   └── data/                    # Runtime data (gitignored)
│       ├── truthlens.db         # SQLite database
│       ├── chromadb/            # ChromaDB vector store
│       ├── bm25/                # BM25 keyword index
│       └── uploads/             # Uploaded document files
│
└── frontend/
    ├── index.html               # HTML entry point
    ├── package.json             # npm dependencies + scripts
    ├── vite.config.ts           # Vite config (React + Tailwind + proxy)
    ├── tsconfig.json            # TypeScript config (root)
    ├── tsconfig.app.json        # App-specific TS config
    ├── tsconfig.node.json       # Node-side TS config
    ├── eslint.config.js         # ESLint flat config
    │
    └── src/
        ├── main.tsx             # React DOM entry point
        ├── App.tsx              # Router + providers + lazy-loaded pages
        ├── App.css              # Global styles
        ├── index.css            # Tailwind CSS v4 imports
        │
        ├── api/                 # Backend client layer
        │   ├── client.ts        # Fetch wrapper + all API call functions
        │   ├── types.ts         # TypeScript interfaces (User, Document, Query, etc.)
        │   └── websocket.ts     # WebSocket client for streaming queries
        │
        ├── context/
        │   └── AuthContext.tsx   # Auth state management (login, register, logout)
        │
        ├── components/
        │   ├── Layout.tsx       # App shell: sidebar nav + ambient background
        │   ├── ui.tsx           # Shared UI primitives (Skeleton, Toast, Modal)
        │   ├── EvidenceSidebar.tsx # Inline evidence/citation display
        │   │
        │   ├── api-catalog/     # API documentation viewer
        │   │   ├── types.ts, data.ts, SearchBar.tsx, HeroSection.tsx,
        │   │   ├── EndpointGroup.tsx, EndpointDetailDrawer.tsx,
        │   │   ├── CenterContent.tsx, RightPanel.tsx, StatsRow.tsx,
        │   │   ├── AnimatedCounter.tsx, WebSocketViz.tsx
        │   │
        │   └── premium/         # Premium UI effects
        │       ├── AnimatedInput.tsx, GlowingIcon.tsx,
        │       ├── ParticleField.tsx, PremiumButton.tsx
        │
        └── pages/               # Route-level page components
            ├── LandingPage.tsx
            ├── LoginPage.tsx
            ├── RegisterPage.tsx
            ├── ForgotPasswordPage.tsx
            ├── ResetPasswordPage.tsx
            ├── NotFoundPage.tsx              # 404 catch-all (dark theme, gradient heading)
            ├── PrivacyPage.tsx               # Privacy policy (static)
            ├── TermsPage.tsx                 # Terms of service (static)
            ├── ContactPage.tsx               # Contact page (static)
            ├── UserDashboard.tsx
            ├── ChatPage.tsx, ChatNewPage.tsx, ChatDetailPage.tsx, ChatHistoryPage.tsx
            ├── DocumentsBrowsePage.tsx
            ├── SettingsPage.tsx
            ├── WorkspacesPage.tsx, WorkspaceDetailPage.tsx
            ├── InvestigationPage.tsx
            ├── ApiCatalogPage.tsx
            ├── AdminDashboard.tsx
            ├── AdminDocumentsPage.tsx, AdminUploadPage.tsx, AdminDocumentDetailPage.tsx
            ├── AdminCollectionsPage.tsx
            ├── AdminUsersPage.tsx, AdminInviteUserPage.tsx, AdminUserDetailPage.tsx
            ├── AdminSettingsPage.tsx
            ├── AdminAnalyticsPage.tsx
            └── AdminAuditLogPage.tsx
```

---

## Entry Points

| Entry Point | File | Purpose |
|---|---|---|
| **FastAPI server** | `backend/app/main.py` | App factory: lifespan, CORS, middleware, health check, includes API router |
| **Frontend app** | `frontend/src/main.tsx` | React DOM render with error boundary |
| **Frontend router** | `frontend/src/App.tsx` | BrowserRouter + QueryClient + AuthProvider; lazy-loaded public/protected/admin routes, 404 catch-all, static pages (privacy, terms, contact) |
| **Local dev launcher** | `run.sh` | Starts backend (uvicorn --reload) + frontend (vite dev) concurrently |
| **CLI evaluation** | `backend/evaluation/evaluate.py` | Run RAGAS evaluation on golden dataset from terminal |
| **Alembic migrations** | `backend/migrations/` | `alembic upgrade head` for DB schema migrations |

---

## Key Modules

### Backend (`backend/app/`)

| Module | File(s) | Responsibility |
|---|---|---|
| **API Router** | `api/router.py` | Aggregates all sub-routers under `/api` |
| **Auth API** | `api/auth.py` | Register, login, refresh, forgot/reset/change password, logout, profile CRUD |
| **Workspace API** | `api/workspaces.py` | Workspace CRUD, member management (add by id or email, remove, role change) |
| **Document API** | `api/documents.py` | Upload, list, detail, status polling, delete, reindex; background ingestion |
| **Query API** | `api/queries.py` | List query history, detail with sources, delete |
| **Feedback API** | `api/feedback.py` | Submit and list user ratings/comments per query |
| **Collections API** | `api/collections.py` | Collection CRUD, access grants/revocations (by id or email) |
| **Admin API** | `api/admin.py` | Stats, audit logs, user mgmt, flagged answers, analytics, eval history, settings |
| **Investigation API** | `api/investigations.py` | Multi-step agentic research endpoint |
| **WebSocket** | `api/ws.py` | Real-time streaming: auth -> query -> retrieval -> sources -> generate -> guardrail -> trust -> complete |
| **Config** | `config.py` | Pydantic-settings, all env vars with defaults |
| **Database** | `database.py` | SQLAlchemy async engine (SQLite + aiosqlite) + session factory |
| **ChromaDB Client** | `chroma_client.py` | Singleton PersistentClient, workspace collection management |
| **JWT Auth** | `core/auth.py` | JWT encode/decode, bcrypt password hashing |
| **Dependencies** | `core/deps.py` | FastAPI DI: `get_db`, `get_current_user`, `check_workspace_access`, `check_workspace_owner` (with UUID validation), `get_current_admin` |
| **Exceptions** | `core/exceptions.py` | AppException hierarchy (NotFound, Unauthorized, Conflict, etc.) + handlers |
| **Security** | `core/security.py` | In-memory rate limiter, RequestID/SecurityHeaders middleware, PII patterns |
| **Document Loader** | `ingestion/loader.py` | Parse PDF (PyMuPDF), DOCX, TXT, MD, CSV into page dicts |
| **Chunker** | `ingestion/chunker.py` | LangChain RecursiveCharacterTextSplitter, configurable size/overlap |
| **Embedder** | `ingestion/embedder.py` | Sentence-transformers BGE model for vector embeddings |
| **Indexer** | `ingestion/indexer.py` | Store chunks in ChromaDB + persist BM25 index to disk |
| **Multimodal** | `ingestion/multimodal.py` | Extract images from PDF, describe via Ollama LLaVA vision model |
| **Hybrid Search** | `retrieval/hybrid_search.py` | Vector similarity (ChromaDB) + BM25 keyword fusion with RRF |
| **Reranker** | `retrieval/reranker.py` | Cross-encoder BGE-reranker for fine-grained relevance scoring |
| **Query Rewrite** | `retrieval/query_rewrite.py` | LLM-based query expansion/reformulation for better retrieval |
| **Parent Retrieval** | `retrieval/parent_retrieval.py` | Expand matched chunks with sibling context from same document |
| **LLM Provider** | `generation/provider.py` | Hybrid provider factory: auto-probe API (OpenAI-compatible, OpenRouter) → fallback to Ollama; cached decision per process |
| **Generator** | `generation/generator.py` | LLM call with context-grounded system prompt, streaming support |
| **Streamer** | `generation/streamer.py` | Async iterator that pushes tokens through WebSocket |
| **Guardrail** | `generation/guardrail.py` | NLI hallucination detection (cross-encoder), claim-level verification |
| **Citer** | `generation/citer.py` | Map `[source:N]` markers in answer back to chunk IDs |
| **Safety** | `generation/safety.py` | Prompt-injection pattern detection + system prompt guard |
| **Ingestion Graph** | `graph/ingestion_graph.py` | LangGraph pipeline: load -> chunk -> embed -> store |
| **Query Graph** | `graph/query_graph.py` | LangGraph pipeline: rewrite -> search -> rerank -> generate -> guardrail -> trust |
| **CRAG Graph** | `graph/crag_graph.py` | Self-correcting RAG: retry generation on low guardrail score |
| **Investigation Graph** | `graph/investigation.py` | Agentic decompose -> research sub-questions -> synthesize report |
| **Comparison Graph** | `graph/comparison_graph.py` | Multi-doc parallel RAG -> synthesis -> agreement detection |
| **Trust Score** | `evaluation/trust_score.py` | Composite score from retrieval quality, faithfulness, relevance, source authority |
| **RAGAS Eval** | `evaluation/ragas_eval.py` | RAGAS metrics integration (faithfulness, answer_relevancy, context_precision, context_recall) |
| **Feedback Loop** | `evaluation/feedback_loop.py` | Feedback CRUD + workspace stats aggregation |
| **Logger** | `utils/logger.py` | Structlog structured JSON logger |
| **PII Redactor** | `utils/pii_redactor.py` | Regex + Presidio PII detection (email, phone, SSN, credit card, IP, ZIP) |
| **Retry** | `utils/retry.py` | Tenacity async retry decorator with exponential backoff |

### Frontend (`frontend/src/`)

| Module | File(s) | Responsibility |
|---|---|---|
| **Entry** | `main.tsx` | ReactDOM.createRoot, error boundary |
| **Router** | `App.tsx` | QueryClient, BrowserRouter, AuthProvider, lazy-loaded routes |
| **API Client** | `api/client.ts` | Fetch wrapper with auto-refresh, all REST API functions |
| **API Types** | `api/types.ts` | TypeScript interfaces: User, Workspace, Document, Query, Feedback, etc. |
| **WebSocket** | `api/websocket.ts` | WS client for streaming queries (tokens, sources, guardrail, trust, complete) |
| **Auth Context** | `context/AuthContext.tsx` | Auth state: login, register, logout, session restore |
| **Layout** | `components/Layout.tsx` | Sidebar nav, ambient background, protected route shell |
| **UI Primitives** | `components/ui.tsx` | ToastProvider, Skeleton, Modal, common UI atoms |
| **Evidence Sidebar** | `components/EvidenceSidebar.tsx` | Citation/excerpt panel for query responses |
| **API Catalog** | `components/api-catalog/` | Interactive API documentation viewer |
| **Premium** | `components/premium/` | Animated input, particle field, glowing icon, premium button |
| **Pages** | `pages/*.tsx` | 31 lazy-loaded page components covering all routes (incl. 404, Privacy, Terms, Contact) |

---

## Data Model

### SQLAlchemy Models (`backend/app/models/`)

| Model | Table | Key Fields | Description |
|---|---|---|---|
| **User** | `users` | id (UUID PK), email (unique), username (unique), password_hash, role (user/admin), is_active, failed_attempts, locked_until, last_login_at | User accounts with lockout protection |
| **Workspace** | `workspaces` | id (UUID PK), name, description, owner_id (FK -> users) | Document containers with ownership |
| **WorkspaceMember** | `workspace_members` | id (UUID PK), workspace_id (FK), user_id (FK), role (owner/viewer/editor), joined_at | Many-to-many workspace membership |
| **Document** | `documents` | id (UUID PK), workspace_id (FK), filename, original_filename, mime_type, file_size, page_count, chunk_count, status (pending/processing/ready/failed), error_message, uploaded_by (FK -> users), collection_id (FK -> collections), indexed_at | Uploaded file metadata with processing status |
| **Chunk** | `chunks` | id (UUID PK), document_id (FK), index, content (Text), token_count | Text segments from document splitting |
| **Query** | `queries` | id (UUID PK), workspace_id (FK), user_id (FK), query_text, rewritten_query, response_text, response_sources (JSON string), trust_score, guardrail_score, guardrail_passed, model_used, latency_ms, token_count | User questions + AI answers with quality scores |
| **Feedback** | `feedback` | id (UUID PK), query_id (FK), user_id (FK), rating (int), comment (Text), created_at | User ratings/comments on query answers |
| **Collection** | `collections` | id (UUID PK), workspace_id (FK), name, description, created_by (FK -> users) | Document grouping within workspaces |
| **CollectionAccess** | `collection_access` | id (UUID PK), collection_id (FK), user_id (FK) | Per-user collection access grants |
| **AuditLog** | `audit_logs` | id (UUID PK), user_id (FK), action, resource_type, resource_id, details (JSON), ip_address, created_at | Immutable action audit trail |
| **EvalRun** | `eval_runs` | id (UUID PK), run_at, faithfulness, context_precision, context_recall, answer_relevance, answer_correctness, refusal_accuracy, golden_set_version, notes | RAGAS evaluation run history |
| **Comparison** | `comparisons` | id (UUID PK), workspace_id (FK), user_id (FK), question (Text), document_ids (JSONB), synthesis_text, agreement_score, trust_score | Multi-document comparison session |
| **ComparisonResult** | `comparison_results` | id (UUID PK), comparison_id (FK), document_id (FK), answer_text, sources (JSON), trust_score, stance (supports/contradicts/silent) | Per-document result within a comparison |

### Pydantic Schemas (`backend/app/schemas/`)

| Schema Group | Files | Description |
|---|---|---|
| **Auth** | `auth.py` | `LoginRequest`, `RegisterRequest`, `AuthResponse`, `TokenResponse`, `RefreshRequest`, `ChangePasswordRequest`, `ForgotPasswordRequest`, `ResetPasswordRequest`, `LogoutRequest`, `UserInfo` |
| **User** | `user.py` | `UserResponse`, `UserUpdate` |
| **Workspace** | `workspace.py` | `WorkspaceCreate`, `WorkspaceUpdate`, `WorkspaceResponse`, `WorkspaceSummary`, `MemberAdd` (user_id or email), `MemberUpdate`, `MemberResponse` |
| **Document** | `document.py` | `DocumentResponse`, `DocumentDetailResponse`, `DocumentStatusResponse`, `ChunkInfo` |
| **Query** | `query.py` | `QuerySummary`, `QueryDetailResponse`, `SourceResponse` |
| **Feedback** | `feedback.py` | `FeedbackCreate`, `FeedbackResponse` |
| **Collection** | `collection.py` | `CollectionCreate`, `CollectionUpdate`, `CollectionResponse`, `CollectionAccessGrant`, `CollectionAccessResponse` |
| **Investigation** | `investigation.py` | `InvestigationRequest`, `InvestigationResponse` |
| **Comparison** | `comparison.py` + `common.py` | `ComparisonSummary`, `ComparisonDetail`, `ComparisonResult`, `ComparisonSource`, `ComparisonCreateRequest`, `ComparisonCreateResponse` |
| **Analytics** | `analytics.py` | `AdminSettingsResponse`, `AdminSettingsUpdate`, `EvalRunResponse`, `FlaggedAnswerResponse`, `TrustScoreDistribution`, `UsageStatsResponse`, `UserActivityResponse` |
| **Common** | `common.py` | `PaginatedResponse[T]`, `ListResponse[T]`, `MessageResponse`, `AdminStatsResponse`, `AuditLogResponse`, `EvaluationResponse` |
| **WebSocket** | `ws.py` | `WSQuery/comparison messages, `WSQueryRequest`, `WSQueryResponse`, `WSError` |

### Frontend Types (`frontend/src/api/types.ts`)

| Interface | Description |
|---|---|
| `User` | User profile with id, email, username, role, is_active |
| `AuthResponse` | Login/register result with user + access_token + refresh_token |
| `Workspace` / `WorkspaceSummary` | Workspace with member/document counts |
| `WorkspaceMember` | Member with role, username, email |
| `Document` | File metadata + processing status |
| `DocumentStatus` | Polling response for document processing |
| `QuerySummary` / `QueryDetail` | Query history item with trust score, sources |
| `Source` | Cited chunk with excerpt, scores, metadata |
| `Feedback` | Rating + comment per query |
| `Collection` | Named document grouping |
| `AdminStats` | System-wide metrics |
| `AuditLogEntry` | Action audit trail entry |
| `InvestigationRequest` / `InvestigationResponse` | Multi-step research I/O |
| `ComparisonSummary` / `ComparisonDetail` / `ComparisonResult` / `ComparisonSource` / `ComparisonCreateRequest` / `ComparisonCreateResponse` | Multi-document comparison I/O |
| `WSMessage` / `WSToken` / `WSSource` / ... | WebSocket streaming message types |
| `PaginatedResponse<T>` / `ListResponse<T>` | Generic API response wrappers |

---

## API Endpoints

All routes are prefixed with `/api` (except WebSocket `/ws/query`).

### Auth — `api/auth.py`

| Method | Route | Handler | Description |
|---|---|---|---|
| POST | `/api/auth/register` | `register` | Create account (email, username, password) -> JWT tokens |
| POST | `/api/auth/login` | `login` | Email + password login with rate limiting & lockout |
| POST | `/api/auth/refresh` | `refresh` | Rotate refresh token -> new access + refresh tokens |
| GET | `/api/auth/me` | `get_me` | Current user profile |
| PUT | `/api/auth/me` | `update_me` | Update profile (email, username, password) |
| DELETE | `/api/auth/me` | `delete_me` | Soft-delete current account |
| POST | `/api/auth/forgot-password` | `forgot_password` | Generate password reset token |
| POST | `/api/auth/reset-password` | `reset_password` | Reset password with token |
| POST | `/api/auth/change-password` | `change_password` | Change password (authenticated) |
| POST | `/api/auth/logout` | `logout` | Logout with audit log |

### Workspaces — `api/workspaces.py`

| Method | Route | Handler | Description |
|---|---|---|---|
| POST | `/api/workspaces` | `create_workspace` | Create workspace (creator = owner) |
| GET | `/api/workspaces` | `list_workspaces` | List user's workspaces (owned + member) |
| GET | `/api/workspaces/{id}` | `get_workspace` | Workspace detail with counts |
| PUT | `/api/workspaces/{id}` | `update_workspace` | Update workspace (owner only) |
| DELETE | `/api/workspaces/{id}` | `delete_workspace` | Delete workspace + cascade (owner only) |
| POST | `/api/workspaces/{id}/members` | `add_member` | Add workspace member by user_id or email (owner only) |
| PUT | `/api/workspaces/{id}/members/{uid}` | `update_member_role` | Change member role (owner only) |
| DELETE | `/api/workspaces/{id}/members/{uid}` | `remove_member` | Remove member (owner only) |
| GET | `/api/workspaces/{id}/members` | `list_members` | List workspace members |

### Documents — `api/documents.py`

| Method | Route | Handler | Description |
|---|---|---|---|
| POST | `/api/workspaces/{wid}/documents` | `upload_document` | Upload file -> 202 accepted, processes in background |
| GET | `/api/workspaces/{wid}/documents` | `list_documents` | List documents (filterable by status) |
| GET | `/api/workspaces/{wid}/documents/{did}` | `get_document` | Document detail with chunks |
| GET | `/api/workspaces/{wid}/documents/{did}/status` | `get_document_status` | Poll processing status |
| DELETE | `/api/workspaces/{wid}/documents/{did}` | `delete_document` | Delete document + ChromaDB/BM25 removal |
| POST | `/api/workspaces/{wid}/documents/{did}/reindex` | `reindex_document` | Re-trigger ingestion (owner/admin only) |
| GET | `/api/documents` | `list_all_documents` | List all docs user can access (cross-workspace) |

### Queries — `api/queries.py`

| Method | Route | Handler | Description |
|---|---|---|---|
| GET | `/api/workspaces/{wid}/queries` | `list_queries` | Query history for workspace (paginated) |
| GET | `/api/queries` | `list_all_queries` | Query history across all accessible workspaces |
| GET | `/api/queries/{qid}` | `get_query_anywhere` | Query detail by ID (any accessible workspace) |
| GET | `/api/workspaces/{wid}/queries/{qid}` | `get_query` | Query detail within workspace |
| GET | `/api/workspaces/{wid}/queries/{qid}/sources` | `get_query_sources` | Cited sources for a query |
| DELETE | `/api/workspaces/{wid}/queries/{qid}` | `delete_query` | Delete a query |

### Feedback — `api/feedback.py`

| Method | Route | Handler | Description |
|---|---|---|---|
| POST | `/api/queries/{qid}/feedback` | `submit_feedback` | Submit/update rating + comment |
| GET | `/api/queries/{qid}/feedback` | `list_feedback` | List feedback for a query |

### Collections — `api/collections.py`

| Method | Route | Handler | Description |
|---|---|---|---|
| POST | `/api/workspaces/{wid}/collections` | `create_collection` | Create document collection |
| GET | `/api/workspaces/{wid}/collections` | `list_collections` | List accessible collections |
| GET | `/api/workspaces/{wid}/collections/{cid}` | `get_collection` | Collection detail |
| PUT | `/api/workspaces/{wid}/collections/{cid}` | `update_collection` | Update collection (owner/creator only) |
| DELETE | `/api/workspaces/{wid}/collections/{cid}` | `delete_collection` | Delete collection (owner/creator only) |
| POST | `/api/workspaces/{wid}/collections/{cid}/access` | `grant_collection_access` | Grant user access by user_id or email |
| DELETE | `/api/workspaces/{wid}/collections/{cid}/access/{uid}` | `revoke_collection_access` | Revoke user access |
| GET | `/api/workspaces/{wid}/collections/{cid}/access` | `list_collection_access` | List access entries |

### Investigations — `api/investigations.py`

| Method | Route | Handler | Description |
|---|---|---|---|
| POST | `/api/workspaces/{wid}/investigate` | `investigate` | Multi-step research: decompose -> retrieve -> synthesize -> report |

### Comparisons — `api/comparisons.py`

| Method | Route | Handler | Description |
|---|---|---|---|
| POST | `/api/workspaces/{wid}/comparisons` | `create_comparison` | Create multi-doc comparison (2-5 docs) -> 202 accepted |
| GET | `/api/workspaces/{wid}/comparisons` | `list_comparisons` | List comparison history (paginated) |
| GET | `/api/workspaces/{wid}/comparisons/{cid}` | `get_comparison` | Full comparison with per-doc answers + synthesis |
| DELETE | `/api/workspaces/{wid}/comparisons/{cid}` | `delete_comparison` | Delete a comparison |

### Admin — `api/admin.py` (all admin-only)

| Method | Route | Handler | Description |
|---|---|---|---|
| GET | `/api/admin/stats` | `get_admin_stats` | System-wide metrics (users, workspaces, docs, queries, avg trust) |
| GET | `/api/admin/logs` | `get_audit_logs` | Paginated audit log (filterable by action) |
| GET | `/api/admin/evaluation` | `get_evaluation` | Last RAGAS evaluation scores |
| POST | `/api/admin/evaluation/run` | `run_evaluation` | Trigger RAGAS evaluation on recent queries |
| GET | `/api/admin/evaluation/history` | `get_evaluation_history` | Past eval run history |
| GET | `/api/admin/users` | `list_users` | List all users (paginated) |
| POST | `/api/admin/users/invite` | `invite_user` | Invite user with temp password (requires email + username; validated) |
| GET | `/api/admin/users/{uid}` | `get_user_detail` | Full user detail with query count |
| PUT | `/api/admin/users/{uid}/role` | `update_user_role` | Change user role |
| PUT | `/api/admin/users/{uid}/status` | `update_user_status` | Activate/deactivate user |
| DELETE | `/api/admin/users/{uid}` | `delete_user` | Soft-delete (deactivate) user |
| GET | `/api/admin/users/{uid}/activity` | `get_user_activity` | User query history |
| GET | `/api/admin/analytics/flagged-answers` | `get_flagged_answers` | Queries with low trust scores (< 0.4) |
| GET | `/api/admin/analytics/queries-over-time` | `get_queries_over_time` | Daily query count (last N days); wrapped with 10s timeout, returns `[]` on timeout |
| GET | `/api/admin/analytics/trust-score-distribution` | `get_trust_score_distribution` | Trust score bucket distribution; wrapped with 10s timeout, returns zero buckets on timeout |
| GET | `/api/admin/settings` | `get_admin_settings` | Current runtime settings |
| PUT | `/api/admin/settings` | `update_admin_settings` | Update settings in-memory |

### WebSocket — `api/ws.py`

| Type | Route | Handler | Description |
|---|---|---|---|
| WS | `/ws/query` | `websocket_query` | Auth -> query -> stream tokens/sources/guardrail/trust/complete |
| WS | `/ws/compare` | `websocket_compare` | Auth -> compare -> stream doc_results/synthesis/trust/complete |

### Health

| Method | Route | Handler | Description |
|---|---|---|---|
| GET | `/health` | `health` | Health check (status, version) |

---

## Key Dependencies

### Backend (Python)

| Package | Version | Purpose |
|---|---|---|
| **fastapi** | 0.111.0 | Web framework |
| **uvicorn** | 0.29.0 | ASGI server |
| **pydantic** + **pydantic-settings** | 2.7.x | Data validation + config |
| **sqlalchemy[asyncio]** | 2.0.30 | Async ORM |
| **aiosqlite** | 0.20.0 | Async SQLite driver |
| **alembic** | 1.13.0 | DB migrations |
| **python-jose[cryptography]** | 3.3.0 | JWT tokens |
| **passlib[bcrypt]** | 1.7.4 | Password hashing |
| **langchain** | 0.2.0 | LangChain framework |
| **langchain-community** | 0.2.0 | LangChain community integrations |
| **langgraph** | 0.2.0 | LangGraph orchestration |
| **langchain-ollama** | 0.1.0 | Ollama LLM integration (fallback) |
| **langchain-openai** | 0.1.0 | OpenAI-compatible API LLM (primary) |
| **chromadb** | 0.5.0 | Vector store |
| **sentence-transformers** | 3.0.0 | Embeddings + reranker models |
| **rank-bm25** | 0.2.2 | BM25 keyword search |
| **transformers** | 4.41.0 | NLI model for guardrail |
| **torch** | 2.3.0 | ML framework |
| **structlog** | 24.1.0 | Structured logging |
| **tenacity** | 8.3.0 | Async retry |
| **PyMuPDF** | 1.24.0 | PDF parsing |
| **python-docx** | 1.1.0 | DOCX parsing |
| **httpx** | 0.27.0 | Async HTTP client |
| **presidio-analyzer** / **presidio-anonymizer** | 2.2.x | PII detection (optional) |
| **prometheus-client** | 0.20.0 | Metrics (optional) |

### Frontend (npm)

| Package | Version | Purpose |
|---|---|---|
| **react** + **react-dom** | ^19.2.6 | UI framework |
| **react-router-dom** | ^6.30.4 | Client-side routing |
| **@tanstack/react-query** | ^5.101.0 | Server state management |
| **framer-motion** | ^12.40.0 | Animations |
| **tailwindcss** | ^4.3.1 | CSS utility framework |
| **@tailwindcss/vite** | ^4.3.1 | Tailwind Vite plugin |
| **lucide-react** | ^1.21.0 | Icons |
| **recharts** | ^3.8.1 | Charts |
| **clsx** | ^2.1.1 | Conditional classnames |
| **vite** | ^8.0.12 | Build tool |
| **typescript** | ~6.0.2 | Language |
| **eslint** | ^10.3.0 | Linting |

### Infrastructure

| Component | Technology | Details |
|---|---|---|
| **Database** | SQLite + aiosqlite | File-based, no external DB needed |
| **Vector Store** | ChromaDB (persistent) | Cosine similarity, per-workspace collections |
| **Keyword Search** | BM25 (rank-bm25) | JSON-index on disk per workspace |
| **LLM** | Ollama (local) | Primary: llama3.1:8b / qwen3:4b; Fallback: phi3:3b |
| **Embeddings** | Sentence-Transformers | BAAI/bge-base-en-v1.5 (768d) |
| **Reranker** | Sentence-Transformers CrossEncoder | BAAI/bge-reranker-v2-m3 |
| **NLI (Guardrail)** | Transformers | cross-encoder/nli-deberta-v3-base |
| **Vision (Multimodal)** | Ollama LLaVA | llava:7b for image description |

---

## Configuration

### Environment Variables (`.env` / `backend/.env`)

All config lives in `backend/app/config.py` via `pydantic-settings.Settings`. The `.env.example` at the repo root documents every variable.

| Variable | Default | Description |
|---|---|---|
| `APP_NAME` | VeritasRAG | Application name |
| `APP_VERSION` | 0.1.0 | Version string |
| `APP_ENV` | development | `development` or `production` |
| `APP_SECRET_KEY` | (change-me...) | JWT signing secret (min 32 chars) |
| `APP_CORS_ORIGINS` | http://localhost:5173,... | Allowed CORS origins |
| `SERVER_HOST` | 0.0.0.0 | Bind address |
| `SERVER_PORT` | 8000 | Port |
| `SERVER_MAX_UPLOAD_SIZE` | 52428800 | Max upload bytes (50 MB) |
| `DB_URL` | sqlite+aiosqlite:///./data/truthlens.db | Database URL |
| `DB_ECHO` | false | SQLAlchemy echo logging |
| `CHROMA_PERSIST_DIR` | ./data/chromadb | ChromaDB storage path |
| `CHROMA_COLLECTION_PREFIX` | ws_ | Collection name prefix |
| `OLLAMA_BASE_URL` | http://localhost:11434 | Ollama server URL |
| `OLLAMA_PRIMARY_MODEL` | llama3.1:8b | Primary LLM |
| `OLLAMA_FALLBACK_MODEL` | phi3:3b | Fallback LLM |
| `OLLAMA_EMBED_MODEL` | bge-base:latest | Ollama embedding model |
| `OLLAMA_RERANK_MODEL` | bge-reranker:latest | Ollama reranker model |
| `OLLAMA_TIMEOUT` | 120 | LLM request timeout (s) |
| `OLLAMA_MAX_TOKENS` | 2048 | Max generation tokens |
| `OLLAMA_TEMPERATURE` | 0.3 | LLM temperature |
| `OLLAMA_NUM_CTX` | 4096 | Context window size |
| `LLM_PROVIDER` | auto | Provider mode: `auto` (API → Ollama), `api`, `ollama` |
| `OPENAI_API_KEY` | "" | API key (OpenAI/OpenRouter/etc.) |
| `OPENAI_BASE_URL` | https://api.openai.com/v1 | API base URL (use `https://openrouter.ai/api/v1` for OpenRouter) |
| `OPENAI_MODEL` | nvidia/nemotron-3-ultra-550b-a55b:free | API model name (Nemotron free: 50 req/day, 20 RPM) |
| `OPENAI_TIMEOUT` | 60 | API request timeout (s) |
| `EMBED_MODEL_NAME` | BAAI/bge-base-en-v1.5 | HuggingFace embedding model |
| `EMBED_DIMENSION` | 768 | Embedding vector dimension |
| `EMBED_DEVICE` | cpu | Inference device (cpu/cuda) |
| `RERANK_MODEL_NAME` | BAAI/bge-reranker-v2-m3 | HuggingFace reranker model |
| `RETRIEVAL_TOP_K` | 10 | Initial top-K retrieval |
| `RETRIEVAL_RERANK_K` | 5 | Top-K after reranking |
| `RETRIEVAL_BM25_WEIGHT` | 0.3 | BM25 fusion weight |
| `RETRIEVAL_VECTOR_WEIGHT` | 0.7 | Vector fusion weight |
| `RETRIEVAL_RERANK_WEIGHT` | 0.6 | Reranker final weight |
| `RETRIEVAL_MIN_SCORE` | 0.3 | Minimum retrieval score |
| `GUARDRAIL_THRESHOLD` | 0.7 | NLI score threshold |
| `GUARDRAIL_MAX_RETRIES` | 3 | Max guardrail retries |
| `GUARDRAIL_NLI_MODEL` | cross-encoder/nli-deberta-v3-base | NLI model name |
| `CHUNK_SIZE` | 512 | Text chunk size (chars) |
| `CHUNK_OVERLAP` | 64 | Chunk overlap |
| `REWRITE_ENABLED` | true | Enable query rewriting |
| `REWRITE_TEMPERATURE` | 0.2 | Rewrite LLM temperature |
| `TRUST_RETRIEVAL_WEIGHT` | 0.3 | Trust: retrieval component weight |
| `TRUST_FAITHFULNESS_WEIGHT` | 0.4 | Trust: faithfulness weight |
| `TRUST_RELEVANCE_WEIGHT` | 0.2 | Trust: relevance weight |
| `TRUST_SOURCE_WEIGHT` | 0.1 | Trust: source authority weight |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | 30 | Access token TTL |
| `JWT_REFRESH_TOKEN_EXPIRE_DAYS` | 7 | Refresh token TTL |
| `JWT_ALGORITHM` | HS256 | JWT signing algorithm |
| `JWT_ISSUER` | veritasrag | JWT issuer claim |
| `RATE_LIMIT_ENABLED` | true | Enable rate limiting |
| `RATE_LIMIT_REQUESTS` | 30 | Max requests per window |
| `RATE_LIMIT_WINDOW` | 60 | Rate limit window (s) |
| `LOG_LEVEL` | INFO | Logging level |
| `LOG_FORMAT` | text | Log format (text/json) |
| `PII_REDACTION_ENABLED` | true | Enable PII masking |
| `PII_ENTITIES` | EMAIL,PHONE,SSN,... | Active PII entity types |
| `MULTIMODAL_ENABLED` | true | Enable vision extraction |
| `MULTIMODAL_MAX_IMAGES` | 10 | Max images per document |

### Secrets

- `APP_SECRET_KEY` — JWT signing secret. Must be replaced with `openssl rand -hex 32` in production.
- `.env` files are in `.gitignore`. Template at `.env.example`.
- Passwords bcrypt-hashed; no plaintext storage.

---

## Deployment

### Docker Compose (multi-service)

File: `docker-compose.yml`

| Service | Image | Port | Description |
|---|---|---|---|
| `ollama` | ollama/ollama:latest | 11434 | Local LLM server |
| `model-init` | ollama/ollama:latest | — | Pulls models (primary, embed, vision) on startup |
| `app` | ./backend/Dockerfile | 8000 | FastAPI app (production mode) |

Volumes: `app_data` (db, chroma, uploads), `ollama_data` (models).

```bash
OLLAMA_PRIMARY_MODEL=qwen3:4b docker compose up -d
```

### Docker (single image)

File: `backend/Dockerfile` — python:3.11-slim, installs requirements, runs uvicorn.

### HuggingFace Spaces

File: `spaces.Dockerfile` + `hf_spaces_setup.sh`

Single container with Ollama binary copied from official image + Python app. Starts Ollama in background, pulls models, then starts the FastAPI app. Uses port 7860 (HF Spaces default).

### CI/CD

File: `.github/workflows/ci.yml`

Runs on push/PR to main branch:
- Backend: install deps, run `pytest` with coverage
- Frontend: install deps, run `tsc --noEmit` type check, build with Vite

### Local Development

Script: `run.sh`

```bash
./run.sh
# -> Backend: http://localhost:8000
# -> Frontend: http://localhost:5173
# -> API docs: http://localhost:8000/docs
```

Requires: Ollama installed locally, Python 3.11+, Node.js.

---
