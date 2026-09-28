# TruthLens "Truth Suite" + Demo-Ready sprint

## Context
User ran agent-reach research (Exa + GitHub): competitors (RAGFlow, AnythingLLM, Onyx, Open WebUI) win on breadth
(parsing, connectors); nobody owns *verification*. TruthLens already computes trust/NLI/abstention, so we lean in.
User picked: **Claim-level Truth Lens, Truth Receipt, Contradiction Radar, Source viewer + highlight**, plus a
**demo pack** (local laptop, local Ollama qwen3:4b). Final gate (user ask): **full Playwright sweep of whole app —
UI, UX, every function — fix → retest.**

Explorer findings that shape design:
- `guardrail.check` (backend/app/generation/guardrail.py:97) scores every claim vs ONE merged premise → NLI 512-tok
  truncation → late-chunk claims mis-scored; per-claim scores + unsupported list discarded; WS never sends them.
- No file-serving endpoint; `X-Frame-Options: DENY` (core/security.py:66) → use PDF.js fetch+canvas, not iframe.
  SQLite `chunks` lacks page_number; Chroma metadata has it (id `f"{doc}:{index}"`).
- comparison_graph parses contradictions then drops them; NLI singleton `_load_nli_model` (guardrail.py:30) reusable.
- Startup = `create_all` only (main.py:46) → **new columns break existing DBs; new tables are safe.** All new
  data goes in NEW tables + alembic 015 for alembic users.
- Demo: no seed, no admin bootstrap (register forces role=user), no warmup, `/health` static, no backend/.env in
  worktree, ChatOllama no keep_alive, qwen3 `<think>` leak unverified, sample corpus empty,
  EXAMPLE_QUESTIONS generic + click only fills input, Usage&Cost shows `abstain` model row (admin.py:965).

## Shared contracts (scaffold commit, CEO, before lanes)
Backend scaffold:
- New tables (models + register in models/__init__ + alembic `015_truth_suite.py`):
  - `query_claims(id, query_id FK cascade UNIQUE, claims JSON text, created_at)`
  - `receipts(id, token UNIQUE urlsafe-32, query_id FK, workspace_id, created_by, payload text, canonical text,
    seal sha256hex, signature hmac hex, created_at, revoked_at NULL, view_count)`
  - `radar_scans(id, workspace_id, status queued|running|done|failed, scope JSON NULL, chunks_scanned,
    pairs_checked, found, error, created_by NULL, started_at, finished_at)`
  - `contradictions(id, workspace_id, scan_id, pair_key UNIQUE per ws, doc_a_id, chunk_a_id, sentence_a,
    doc_b_id, chunk_b_id, sentence_b, score, similarity, status open|dismissed|resolved, created_at, updated_at,
    resolved_by NULL)`
- Config: `DEMO_MODE=False, DEMO_WARMUP=True, OLLAMA_KEEP_ALIVE="30m", OLLAMA_THINK=False, RECEIPTS_ENABLED=True,
  RADAR_AUTO_SCAN=True, RADAR_NEIGHBOURS=4, RADAR_MIN_SIMILARITY=0.55, RADAR_MIN_CONTRADICTION=0.8,
  RADAR_MAX_CHUNKS=1500, RADAR_SENTENCE_PAIRS=3`
- `guardrail.nli_batch(pairs: list[tuple[str,str]]) -> list[tuple[e,n,c]]` (one `predict` call, to_thread-safe).
- Empty routers registered: `api/receipts.py`, `api/radar.py`, `api/demo.py`. Stub `app/radar/scan.py:
  async def run_scan(workspace_id, document_ids=None, created_by=None) -> str`.

Claim object (WS `guardrail.claims`, REST `QueryDetailResponse.claims`, receipt payload):
`{text, start, end, verdict: supported|partial|unsupported|contradicted, entailment, contradiction,
  source_index (1-based = [source:N]) | null, chunk_id, document_id, document_name, page_number, evidence}`

Endpoints:
- Receipts: `POST /api/queries/{qid}/receipts` → `{token, url_path:"/r/{token}", seal, created_at}`;
  `GET /api/receipts/{token}` (PUBLIC) → `{payload, canonical, seal, seal_valid, signature_valid, issued_at, revoked}`
  (410 if revoked); `DELETE /api/receipts/{token}`; `GET /api/queries/{qid}/receipts`.
  seal = sha256(canonical JSON sort_keys, (",",":")); signature = HMAC-SHA256(key derived from APP_SECRET_KEY, seal).
- Radar: `POST /api/workspaces/{wid}/radar/scans` (editor, 409 if running) → 202 `{scan_id,status}`;
  `GET /api/workspaces/{wid}/radar?status=` → `{latest_scan, contradictions[], counts{open,dismissed,resolved}}`;
  `PATCH /api/workspaces/{wid}/radar/contradictions/{id}` `{status}`. Item: `{id, score, similarity, status,
  created_at, a:{document_id, document_name, chunk_id, page_number, sentence}, b:{…}}`.
  WS `sources` items gain `conflicts: int`.
- Viewer: `GET /api/workspaces/{wid}/documents/{doc}/file` (inline FileResponse, access_or_admin);
  `GET …/documents/{doc}/chunks/{chunk}/locate` → `{mode: pdf|text, page_number, page_count, page_width,
  page_height, rects:[[x0,y0,x1,y1]], content, context_before, context_after}`.
- Demo: `GET /api/health/ready` (PUBLIC) → `{status, demo_mode, warm, ollama{reachable, model, model_present},
  models{embedder, reranker, nli: cold|loading|warm|error}}`; `POST /api/auth/demo-login {persona: analyst|admin}`
  (404 unless DEMO_MODE, refused when APP_ENV=production); `GET /api/workspaces/{wid}/suggestions` → `{questions[]}`.

Frontend scaffold: types in `api/types.ts`, all methods in `api/client.ts` (lanes don't touch client.ts),
deps `pdfjs-dist`, `qrcode`, `@types/qrcode`; stubs `components/SealReceiptButton.tsx`,
`context/SourceViewerContext.tsx` (`useSourceViewer().open({workspaceId, documentId, chunkId, documentName,
pageNumber})`), `components/SuggestedQuestions.tsx`, `components/DemoTour.tsx`, `pages/ReceiptPage.tsx`;
Layout mounts provider + DemoTour; App.tsx public route `/r/:token`; add `/receipts/` to public API paths.

## Lanes (parallel, each in own worktree off scaffold commit, TDD, own tests green)
| Lane | Owner files | Work |
|---|---|---|
| L1 Truth Lens BE | guardrail.py, api/ws.py (guardrail frame, save claims, cached replay), api/queries.py `_to_detail`, schemas/query.py | per-claim × per-chunk batched NLI; verdicts; char offsets; evidence sentence (overlap pick in best chunk); score = min per-claim best ratio; persist `query_claims`; strip `[source:N]` from claim text but keep source_index |
| L2 Truth Lens FE | ChatPage.tsx, ChatDetailPage.tsx, api/websocket.ts, new components/truth-lens/* | "Truth Lens" toggle → lens view (sentence spans colored by verdict, hover card w/ evidence + "View in document"); claim ledger summary chip (✅n ⚠n ❌n); ChatDetailPage renders markdown + lens; mounts SealReceiptButton + SuggestedQuestions (click = send) |
| L3 Receipt BE | app/receipts.py, api/receipts.py | canonical payload (question, answer, claims, cited sources w/ excerpt ≤1200 + content sha256, trust, guardrail, model, prompt_version, workspace name, times); HMAC; public GET increments view_count; revoke; audit `receipt.create/revoke`; access = workspace member |
| L4 Receipt FE | SealReceiptButton.tsx, ReceiptPage.tsx | seal modal with public-exposure warning → link + copy + QR; public receipt page in Ledger-and-Seal style: claims+verdicts, evidence, trust gauge, seal, "Verified in your browser" (WebCrypto sha256(canonical)==seal) + server signature status, print CSS → Save as PDF |
| L5 Radar BE | app/radar/*, api/radar.py, documents.py post-ingest hook, ws.py `conflicts` count | chunk emb from Chroma → k neighbours in OTHER docs (`$ne`) → sim filter → sentence emb pairs top-3 → `nli_batch` both directions → flag contra ≥ threshold & > entail; dedupe pair_key; incremental scan after ingest (tracked task, own session, heavy work in to_thread); full scan endpoint |
| L6 Radar FE | WorkspaceDetailPage.tsx (Radar tab), components/radar/* | Radar tab w/ badge, scan button + live progress poll, conflict cards side-by-side, numeric diff highlight, open either side in viewer, dismiss/resolve, empty/scanning/error states |
| L7 Viewer BE | api/documents.py (file + locate) | FileResponse inline + nosniff + private cache; locate via Chroma page meta, PyMuPDF `search_for` on sentence fragments → rects; text mode w/ neighbour chunks; non-PDF formats |
| L8 Viewer FE | SourceViewerContext.tsx, components/source-viewer/*, EvidenceSidebar.tsx, WorkspaceDocumentDetailPage.tsx | slide-over drawer: PDF.js canvas + pulsing highlight rects, page nav, zoom, download; text mode; "View in document" on source cards; doc detail page = viewer + passage list, `?chunk=` deep link |
| L9 Demo BE | app/demo/* (corpus md + manifest + seed CLI), api/demo.py, main.py warmup, provider.py, run.sh, README/DEMO_SCRIPT.md, admin.py usage fix | fictional "Northwind Renewables" corpus (PDF×3 via PyMuPDF Story, DOCX, CSV, MD) w/ planted contradictions + suggested questions; `python -m app.demo seed [--reset]` (admin+analyst @truthlens.dev, password from DEMO_PASSWORD in backend/.env), ingest, run_scan, warm query; background warmup + keep_alive + think=False (verify no `<think>`); ready endpoint; demo-login; suggestions endpoint; `run.sh --demo` (bootstrap .env, venv, npm, ollama serve+pull, seed once, ready-wait loop, open browser); abstain row fix |
| L10 Demo FE | LandingPage.tsx, LoginPage.tsx, SuggestedQuestions.tsx, DemoTour.tsx, header ready pill | "Try the live demo" CTA + one-click Analyst/Admin on login (only when demo_mode); warm-up pill; tailored suggestions; 5-step presenter tour (Ask → Truth Lens → Open source → Seal receipt → Radar), dismissible |

## Sequence
1. CEO: branch `feat/truth-suite-demo`, scaffold (backend + frontend agents in parallel, CEO commits), ledger at
   `.superpowers/sdd/deep-spinning-sparkle/`.
2. Dispatch L1–L10 in parallel worktrees (backend-engineer/ai-engineer/frontend-engineer).
3. CEO merges lanes (merge commits), resolves conflicts, runs full backend pytest + frontend tsc/eslint/vitest/build.
4. security-auditor (public receipts, file endpoint, demo-login) + code-reviewer in parallel → fixes.
5. `./run.sh --demo` real boot; demo script walk.
6. **Playwright full sweep**: every public/user/admin page, every button/form/flow, new features, console errors,
   mobile 375px + desktop, dark/light → bug list → debugger fixes → full re-sweep until clean.
7. PR to `main` with merge commit (no FF).

## Verification
- Backend: `cd backend && "/Users/nikunjvaghasiya/SGP/TruthLens AI/backend/.venv/bin/python" -m pytest tests/ -q`
  + ruff; frontend: `npm run typecheck && npm run lint && npm run test:run && npm run build`.
- Live: `./run.sh --demo` → landing → one-click demo → ask suggested Q → Truth Lens colors claims → hover evidence →
  View in document highlights passage on PDF page → Seal receipt → open `/r/<token>` logged-out, "Verified" →
  Radar tab lists planted contradictions → open both sides.
- Playwright sweep report with screenshots, zero console errors, all S1/S2 fixed.

Skipped (say so): docker-compose/HF Spaces fixes (user chose laptop), knowledge graph, URL ingest, contextual
retrieval, OCR — next sprint candidates.
