# VeritasRAG

Offline-first, enterprise-grade RAG platform. Ask natural-language questions over private documents. Answers are grounded, cited, confidence-scored, and generated 100% locally — no paid APIs.

> "Perplexity for your private documents — fully offline, fully free."

## Architecture

```
┌─────────────┐     REST + WebSocket      ┌─────────────────────────────┐
│  Frontend   │ ◄──────────────────────►  │       FastAPI Backend        │
│ (React/Vite)│                           │  ┌───────────────────────┐  │
└─────────────┘                           │  │  LangGraph Orchestrator│  │
                                          │  │  ┌───┐ ┌───┐ ┌───┐ │  │
┌─────────────┐                           │  │  │ R │ │ G │ │ E │ │  │
│   Ollama    │ ◄─────────────────────────┤  │  │ E │ │ E │ │ V │ │  │
│ Llama 3.1   │                           │  │  │ T │ │ N │ │ A │ │  │
└─────────────┘                           │  │  └───┘ └───┘ └───┘ │  │
                                          │  └───────────────────────┘  │
┌─────────────┐                           │  ┌───────────────────────┐  │
│  ChromaDB   │ ◄─────────────────────────┤  │  SQLite + ChromaDB    │  │
│ Vector Store│                           │  │  (app data + vectors) │  │
└─────────────┘                           └─────────────────────────────┘
```

## Quick Start

### Prerequisites
- Python 3.11+
- [Ollama](https://ollama.ai) with llama3.1:8b (or phi3:3b for 8GB RAM)
- 8GB+ RAM (16GB recommended)

### 1. Setup

```bash
git clone <repo-url>
cd veritasrag

cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure

```bash
cp ../.env.example .env
# Generate strong secret key:
#   openssl rand -hex 32
# Edit .env:
#   APP_SECRET_KEY=<your-generated-key>
```

### 3. Pull LLM models

```bash
ollama pull llama3.1:8b     # primary model
ollama pull phi3:3b         # fallback (optional)
ollama pull bge-base:latest # embeddings (optional — uses sentence-transformers)
```

### 4. Start server

```bash
uvicorn app.main:app --reload --port 8000
```

### 5. Verify

```bash
curl http://localhost:8000/health
# {"status":"ok","version":"0.1.0"}
```

API docs at [http://localhost:8000/docs](http://localhost:8000/docs)

## Docker

```bash
docker-compose up -d
```

This starts:
- **app** — FastAPI backend on `:8000`
- **ollama** — LLM server on `:11434`

Wait for Ollama to be healthy, then pull models:
```bash
docker exec veritasrag-ollama ollama pull llama3.1:8b
```

## API

### REST Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | No | Register user |
| POST | `/api/auth/login` | No | Login |
| POST | `/api/auth/refresh` | No | Refresh tokens |
| GET/PUT/DELETE | `/api/auth/me` | Yes | User profile |
| GET | `/api/users` | Admin | List users |
| CRUD | `/api/workspaces` | Yes | Workspace management |
| POST | `/api/workspaces/{id}/documents` | Yes | Upload document |
| GET/DELETE | `/api/workspaces/{id}/documents` | Yes | Manage documents |
| POST | `/api/workspaces/{id}/query` | Yes | Ask question |
| GET/DELETE | `/api/workspaces/{id}/queries` | Yes | Query history |
| POST/GET | `/api/queries/{id}/feedback` | Yes | Feedback |
| GET | `/api/admin/stats` | Admin | System stats |
| GET | `/api/admin/logs` | Admin | Audit logs |
| WS | `/api/ws/query` | Yes* | Streaming Q&A |

*\*WebSocket: authenticate via first message `{"type":"auth","token":"<jwt>"}`*

### Supported file types
PDF, DOCX, TXT, MD, CSV

## Stack

| Layer | Technology |
|-------|------------|
| Framework | FastAPI (Python 3.11) |
| Database | SQLite + SQLAlchemy (async) |
| Vector store | ChromaDB |
| LLM | Ollama (llama3.1:8b / phi3:3b) |
| Search | BM25 + vector hybrid (RRF fusion) |
| Reranker | Cross-encoder (BGE-reranker) |
| Guardrail | NLI (DeBERTa) |
| Orchestration | LangGraph |
| Auth | JWT (access + refresh tokens) |
| Logging | structlog |
| Container | Docker + Docker Compose |

## Project Structure

```
backend/
├── app/
│   ├── api/          # REST + WebSocket routes (9 modules)
│   ├── core/         # Auth, deps, security, exceptions
│   ├── models/       # SQLAlchemy ORM (8 tables)
│   ├── schemas/      # Pydantic request/response schemas
│   ├── ingestion/    # Load, chunk, embed, index
│   ├── retrieval/    # Hybrid search, reranker, query rewrite
│   ├── generation/   # Ollama gen, citations, guardrail, streaming
│   ├── evaluation/   # Trust score, RAGAS, feedback loop
│   ├── graph/        # LangGraph: query, CRAG, ingestion
│   └── utils/        # Logger, retry, PII redactor
├── tests/            # pytest (22 test files)
├── migrations/       # Alembic (1 version)
├── Dockerfile
└── requirements.txt
```

## Development

```bash
# Install dev deps
pip install -r requirements-dev.txt

# Run tests
pytest tests/ -v

# With coverage
pytest tests/ --cov=app

# Run specific test
pytest tests/test_api/test_auth.py -v
```

## Security

- JWT with explicit algorithm binding (HS256)
- bcrypt password hashing
- Rate limiting (30 req/min per endpoint)
- Account lockout after 5 failed attempts (15 min)
- PII redaction (email, phone, SSN, credit card, IP, ZIP)
- Security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options)
- Request ID tracing
- Audit logging on all state changes
- No pickle deserialization (JSON-based BM25 storage)

## License

MIT
