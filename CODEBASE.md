# CODEBASE.md

## Project Structure
```
TruthLens AI/
├── frontend/
│   └── src/
│       ├── api/           # API client, types, WebSocket
│       ├── components/    # UI components + Layout
│       ├── context/       # AuthContext (login/logout/register)
│       ├── pages/         # All page components
│       ├── App.tsx        # Routes + providers
│       ├── main.tsx       # Entry point (React 19, no StrictMode)
│       └── index.css      # Global styles, glass tokens, animations
├── backend/               # Python FastAPI backend
│   └── app/
│       ├── api/           # Route handlers
│       │   ├── auth.py            # Auth routes (register/login/refresh/me/logout/password)
│       │   ├── users.py           # Admin user management routes
│       │   ├── workspaces.py      # Workspace CRUD routes
│       │   ├── documents.py       # Document upload/list/delete/reindex routes
│       │   ├── collections.py     # Collection CRUD + access management routes
│       │   ├── queries.py         # Query routes
│       │   ├── feedback.py        # Feedback routes
│       │   ├── investigations.py  # Investigation routes
│       │   ├── admin.py           # Admin dashboard/analytics/evaluation/settings routes
│       │   ├── ws.py              # WebSocket handler
│       │   └── router.py          # Aggregate all sub-routers
│       ├── models/        # SQLAlchemy ORM models
│       │   ├── base.py            # DeclarativeBase, TimestampMixin, UUIDPkMixin
│       │   ├── user.py            # User model
│       │   ├── workspace.py       # Workspace + WorkspaceMember models
│       │   ├── document.py        # Document model
│       │   ├── chunk.py           # Chunk model
│       │   ├── query.py           # Query model
│       │   ├── feedback.py        # Feedback model
│       │   ├── collection.py      # Collection + CollectionAccess models
│       │   ├── eval_run.py        # EvalRun model (RAGAS evaluation tracking)
│       │   └── audit_log.py       # AuditLog model
│       ├── schemas/      # Pydantic validation schemas
│       │   ├── auth.py            # Auth request/response schemas
│       │   ├── user.py            # User schemas
│       │   ├── workspace.py       # Workspace schemas
│       │   ├── document.py        # Document schemas
│       │   ├── collection.py      # Collection Pydantic schemas
│       │   ├── query.py           # Query schemas
│       │   ├── feedback.py        # Feedback schemas
│       │   ├── analytics.py       # Analytics/admin schemas
│       │   ├── investigation.py   # Investigation schemas
│       │   ├── ws.py              # WebSocket message schemas
│       │   └── common.py          # Shared schemas (PaginatedResponse, ListResponse, etc.)
│       ├── core/          # Core utilities
│       ├── ingestion/     # Document ingestion pipeline
│       ├── evaluation/    # RAGAS evaluation
│       ├── graph/         # LangGraph pipelines
│       └── migrations/    # Alembic migrations
│           └── versions/
│               └── 003_add_collections_eval_runs.py  # Migration
├── PROJECT.md
└── CODEBASE.md
```

## Entry Points
- **Frontend**: `frontend/src/main.tsx` → `App.tsx` → Routes
- **Backend**: `backend/app/main.py` (FastAPI)
- **Dev server**: `npm run dev` (port 5173)

## Key Modules
| Module | File | Responsibility |
|--------|------|---------------|
| Auth | `context/AuthContext.tsx` | Login/register/logout, token storage, session restore |
| UI | `components/ui.tsx` | Button, Input, Card, Modal, Toast, Tabs, Skeleton, Badge, ProgressBar, animated variants |
| Layout | `components/Layout.tsx` | Glass sidebar nav, header, `<Outlet />` for child routes |
| API client | `api/client.ts` | Axios instance with JWT interceptor, auth/workspace/query APIs |
| WebSocket | `api/websocket.ts` | Query WebSocket connection, streaming token/source/trust updates |
| Types | `api/types.ts` | User, Workspace, Source, QuerySummary, ChatMessage types |
| Login | `pages/LoginPage.tsx` | Email/password form, validation, redirect to /workspaces |
| Register | `pages/RegisterPage.tsx` | Registration with password strength, auto-login |
| Workspaces | `pages/WorkspacesPage.tsx` | Grid of workspaces, create/delete/search/filter |
| Workspace Detail | `pages/WorkspaceDetailPage.tsx` | Document list, upload, tabs (files/settings) |
| Chat | `pages/ChatPage.tsx` | Message thread, streaming responses, source sidebar, trust scores |
| Investigation | `pages/InvestigationPage.tsx` | Query builder with trust gauge, trace explorer |
| Admin | `pages/AdminDashboard.tsx` | Stats cards, user table, system health |

## API Endpoints (64 total)

### Auth (`/api/auth/*`)
| Method | Route | Handler | Auth |
|--------|-------|---------|------|
| POST | `/api/auth/register` | Register new user | No |
| POST | `/api/auth/login` | Login, get JWT | No |
| POST | `/api/auth/refresh` | Refresh access token | Yes |
| GET | `/api/auth/me` | Get current user | Yes |
| PUT | `/api/auth/me` | Update profile (email/username/password) | Yes |
| DELETE | `/api/auth/me` | Delete current user account | Yes |
| POST | `/api/auth/forgot-password` | Generate password reset token | No |
| POST | `/api/auth/reset-password` | Reset password using token | No |
| POST | `/api/auth/change-password` | Change password (authenticated) | Yes |
| POST | `/api/auth/logout` | Logout (audit log entry) | Yes |

### User Management (`/api/users/*`) — Admin
| Method | Route | Handler | Auth |
|--------|-------|---------|------|
| GET | `/api/users` | List all users | Admin |
| GET | `/api/users/{user_id}` | Get user by ID | Admin |

### Workspaces (`/api/workspaces/*`)
| Method | Route | Handler | Auth |
|--------|-------|---------|------|
| POST | `/api/workspaces` | Create workspace | Yes |
| GET | `/api/workspaces` | List user's workspaces | Yes |
| GET | `/api/workspaces/{id}` | Get workspace detail | Yes |
| PUT | `/api/workspaces/{id}` | Update workspace (owner) | Yes |
| DELETE | `/api/workspaces/{id}` | Delete workspace (owner) | Yes |
| POST | `/api/workspaces/{id}/members` | Add member (owner) | Yes |
| PUT | `/api/workspaces/{id}/members/{user_id}` | Update member role (owner) | Yes |
| DELETE | `/api/workspaces/{id}/members/{user_id}` | Remove member (owner) | Yes |
| GET | `/api/workspaces/{id}/members` | List workspace members | Yes |

### Documents (`/api/workspaces/{id}/documents/*`)
| Method | Route | Handler | Auth |
|--------|-------|---------|------|
| POST | `/api/workspaces/{id}/documents` | Upload document (202, bg process) | Yes |
| GET | `/api/workspaces/{id}/documents` | List documents in workspace | Yes |
| GET | `/api/workspaces/{id}/documents/{doc_id}` | Get document with chunks | Yes |
| GET | `/api/workspaces/{id}/documents/{doc_id}/status` | Poll processing status | Yes |
| DELETE | `/api/workspaces/{id}/documents/{doc_id}` | Delete document | Yes |
| POST | `/api/workspaces/{id}/documents/{doc_id}/reindex` | Re-trigger ingestion | Yes |
| GET | `/api/documents` | List ALL documents (global, accessible) | Yes |

### Collections (`/api/workspaces/{id}/collections/*`)
| Method | Route | Handler | Auth |
|--------|-------|---------|------|
| POST | `/api/workspaces/{id}/collections` | Create collection | Yes |
| GET | `/api/workspaces/{id}/collections` | List accessible collections | Yes |
| GET | `/api/workspaces/{id}/collections/{cid}` | Get collection detail | Yes |
| PUT | `/api/workspaces/{id}/collections/{cid}` | Update collection | Yes |
| DELETE | `/api/workspaces/{id}/collections/{cid}` | Delete collection | Yes |
| POST | `/api/workspaces/{id}/collections/{cid}/access` | Grant user access | Yes |
| DELETE | `/api/workspaces/{id}/collections/{cid}/access/{user_id}` | Revoke user access | Yes |
| GET | `/api/workspaces/{id}/collections/{cid}/access` | List access entries | Yes |

### Queries (`/api/workspaces/{id}/queries/*`)
| Method | Route | Handler | Auth |
|--------|-------|---------|------|
| GET | `/api/workspaces/{id}/queries` | List query history | Yes |
| GET | `/api/workspaces/{id}/queries/{qid}` | Get query detail | Yes |
| GET | `/api/workspaces/{id}/queries/{qid}/sources` | Get cited sources | Yes |
| DELETE | `/api/workspaces/{id}/queries/{qid}` | Delete a query | Yes |

### Feedback (`/api/queries/{query_id}/feedback`)
| Method | Route | Handler | Auth |
|--------|-------|---------|------|
| POST | `/api/queries/{query_id}/feedback` | Submit feedback/rating | Yes |
| GET | `/api/queries/{query_id}/feedback` | List feedback for query | Yes |

### Investigation (`/api/workspaces/{id}/investigate`)
| Method | Route | Handler | Auth |
|--------|-------|---------|------|
| POST | `/api/workspaces/{id}/investigate` | Run multi-step investigation | Yes |

### Admin (`/api/admin/*`)
| Method | Route | Handler | Auth |
|--------|-------|---------|------|
| GET | `/api/admin/stats` | System-wide metrics | Admin |
| GET | `/api/admin/logs` | Audit log entries | Admin |
| GET | `/api/admin/evaluation` | Current RAGAS scores | Admin |
| POST | `/api/admin/evaluation/run` | Trigger RAGAS evaluation | Admin |
| GET | `/api/admin/evaluation/history` | Past eval run history | Admin |
| GET | `/api/admin/users` | List all users (paginated) | Admin |
| POST | `/api/admin/users/invite` | Invite new user | Admin |
| GET | `/api/admin/users/{user_id}` | Get user detail | Admin |
| PUT | `/api/admin/users/{user_id}/role` | Update user role | Admin |
| PUT | `/api/admin/users/{user_id}/status` | Activate/deactivate user | Admin |
| DELETE | `/api/admin/users/{user_id}` | Soft-delete (deactivate) user | Admin |
| GET | `/api/admin/users/{user_id}/activity` | User query history | Admin |
| GET | `/api/admin/analytics/flagged-answers` | Low-trust-score queries | Admin |
| GET | `/api/admin/analytics/queries-over-time` | Daily query counts | Admin |
| GET | `/api/admin/analytics/trust-score-distribution` | Trust score buckets | Admin |
| GET | `/api/admin/settings` | Get app settings | Admin |
| PUT | `/api/admin/settings` | Update app settings (in-memory) | Admin |

### WebSocket
| Method | Route | Handler | Auth |
|--------|-------|---------|------|
| WS | `/api/ws/query` | Streaming query WebSocket | Yes |

## Data Model

### Backend (SQLAlchemy / PostgreSQL)

**users**
- id, email, username, password_hash, role, is_active, failed_attempts, locked_until, last_login_at, created_at, updated_at

**workspaces**
- id, name, description, owner_id, created_at, updated_at

**workspace_members**
- id, workspace_id (FK), user_id (FK), role, invited_by

**documents**
- id, workspace_id (FK), filename, original_filename, mime_type, file_size, page_count, chunk_count, status, error_message, uploaded_by (FK), collection_id (FK, nullable), indexed_at, created_at, updated_at

**chunks**
- id, document_id (FK), index, content, token_count, embedding, created_at

**collections**
- id, workspace_id (FK), name, description, created_by (FK), created_at, updated_at

**collection_access**
- id, collection_id (FK), user_id (FK) — unique pair enforced

**eval_runs**
- id, run_at, faithfulness, context_precision, context_recall, answer_relevance, answer_correctness, refusal_accuracy, golden_set_version, notes

**queries**
- id, user_id (FK), workspace_id (FK), query_text, response_text, response_sources, trust_score, model, latency_ms, token_count, created_at

**feedback**
- id, user_id (FK), query_id (FK), rating, comment, created_at

**audit_logs**
- id, user_id (FK), action, resource_type, resource_id, details, ip_address, created_at

### Frontend (TypeScript types)
- `User`: id, email, username, role, created_at
- `Workspace`: id, name, description, document_count, created_at, updated_at
- `Source`: chunk_id, document_id, excerpt, relevance_score, document_name
- `ChatMessage`: id, role, content, sources[], trustScore, status, error, queryId

## Key Dependencies
- **Frontend**: React 19, React Router 7, Framer Motion 12, Tailwind CSS v4, Axios, TanStack Query, clsx, lucide-react
- **Backend**: Python 3.11+, FastAPI, SQLAlchemy, PostgreSQL, JWT, LangChain

## Config
- **Env vars**: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `LLM_MODEL`
- **Frontend config**: `vite.config.ts` (proxy `/api` → `:8000`)

## Deployment
- Not yet deployed (local dev only)
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`
