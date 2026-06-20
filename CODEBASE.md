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

## API Endpoints
| Method | Route | Handler | Auth |
|--------|-------|---------|------|
| POST | `/api/auth/register` | Register new user | No |
| POST | `/api/auth/login` | Login, get JWT | No |
| POST | `/api/auth/refresh` | Refresh access token | Yes |
| GET | `/api/auth/me` | Get current user | Yes |
| GET | `/api/workspaces` | List workspaces | Yes |
| POST | `/api/workspaces` | Create workspace | Yes |
| GET | `/api/workspaces/:id` | Get workspace detail | Yes |
| DELETE | `/api/workspaces/:id` | Delete workspace | Yes |
| GET | `/api/workspaces/:id/documents` | List documents | Yes |
| POST | `/api/workspaces/:id/documents` | Upload document | Yes |
| DELETE | `/api/workspaces/:id/documents/:doc_id` | Delete document | Yes |
| WS | `/api/ws/query` | Streaming query WebSocket | Yes |

## Data Model (Frontend types)
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
