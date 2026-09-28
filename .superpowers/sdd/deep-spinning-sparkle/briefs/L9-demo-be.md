# L9 — Demo pack backend + boot

Owned: `backend/app/demo/*` (scaffold empty pkg), `backend/app/api/demo.py` (scaffold empty router), `backend/app/main.py`
(lifespan warmup + ready route), `backend/app/generation/provider.py` (Ollama options), `backend/app/api/auth.py` (only to export/
reuse the cookie-setting helper), `backend/app/api/admin.py` (`_usage_rollup` abstain fix only), `run.sh`, `README.md`,
new `DEMO_SCRIPT.md`, `.env.example`, tests.

1. Corpus `backend/app/demo/corpus/` — fictional wind+solar developer "Northwind Renewables". Realistic prose, 600–1500 words each,
   consistent except PLANTED CONFLICTS:
   - `annual-report-2025.md` → PDF (multi-page, headings, one table): revenue €412M; 1.8 GW installed; CEO Dana Whitfield CEO since
     March 2021; emissions intensity −34% vs 2020; 1,240 employees; offshore "Aurora" 600 MW commissioning Q3 2027.
   - `q4-2025-press-release.md` → PDF: revenue €398M (CONFLICT); 1.8 GW (agree); Aurora Q3 2027 (agree).
   - `sustainability-report-2025.md` → PDF: emissions intensity −41% vs 2020 (CONFLICT); 1,240 employees (agree).
   - `board-memo-aurora.md` → DOCX (python-docx): Aurora commissioning slipped to Q1 2028 (CONFLICT); budget €1.1B; key risks.
   - `leadership-team.md` → MD: Dana Whitfield became CEO in January 2022 (CONFLICT).
   - `project-pipeline.csv`: ~12 projects (name, technology, MW, country, status, expected COD).
   - `manifest.json`: docs (source, format, title), `suggested_questions` (6, e.g. revenue 2025; Aurora commissioning; emissions
     intensity vs 2020; CEO + start date; projects under construction; Aurora key risks), `planted_contradictions` list.
   - PDFs built at seed time with PyMuPDF `Story` from markdown→HTML (`markdown` lib is installed); DOCX via python-docx.
2. Seed CLI `python -m app.demo seed [--reset]` (`app/demo/__main__.py` + `seed.py`), idempotent:
   - Needs `settings.DEMO_PASSWORD` (fail with a clear message if empty; run.sh generates it into backend/.env).
   - Users: `admin@truthlens.dev` (username `demo_admin`, role admin), `analyst@truthlens.dev` (username `demo_analyst`, role user).
   - Workspace "Northwind Renewables — Due Diligence" owned by analyst; admin added as editor member.
   - Build corpus files → Document rows + copy to `upload_path` (mirror documents.py:106-140) → commit → `await process_document_background(...)` sequentially.
   - `await run_scan(workspace_id)` from `app.radar.scan` (lane L5; if it raises NotImplementedError, warn and continue).
   - Marker `DATA_DIR/.demo_seeded` (JSON with workspace id). `--reset`: delete demo workspace (docs, chroma collection, bm25) + reseed.
   - Never print passwords.
3. Warmup `app/demo/warmup.py`: module state `{embedder, reranker, nli: cold|loading|warm|error}`; `start_warmup()` tracked background
   task from lifespan when `DEMO_MODE or DEMO_WARMUP`: load embedder/reranker/NLI in `to_thread`, then one tiny Ollama generate with
   keep_alive. Never blocks startup; never crashes when Ollama is down.
4. `GET /api/health/ready` (PUBLIC): `{status, demo_mode, warm, ollama{reachable, model, model_present}, models{...},
   demo_workspace_id}` — Ollama via `GET {OLLAMA_BASE_URL}/api/tags` 1.5s timeout. No secrets.
5. provider.py: ChatOllama gets `keep_alive=settings.OLLAMA_KEEP_ALIVE`; thinking off per `OLLAMA_THINK` (check installed
   langchain-ollama for `reasoning=`; if absent, strip `<think>…</think>` in generator + streamer, reusing query_rewrite's stripper).
   VERIFY against the live local Ollama (qwen3:4b installed; `curl -s localhost:11434/api/tags`) that a streamed answer has no
   `<think>` text; paste evidence in report.
6. `POST /api/auth/demo-login {persona: analyst|admin}` (in api/demo.py): 404 unless `DEMO_MODE` and `APP_ENV != "production"`;
   sets cookies + refresh session exactly like login (reuse helpers); audit `auth.demo_login`; same response body as login.
7. `GET /api/workspaces/{wid}/suggestions` (in api/demo.py; access required): demo workspace → manifest questions; otherwise up to 4
   derived from ready documents' titles ("Summarize {title}", "What are the key figures in {title}?"); empty list if no docs.
8. `run.sh --demo` (default mode keeps working; fix the literal `\n` echo):
   - create `backend/.env` from `.env.example` if missing (APP_SECRET_KEY via `openssl rand -hex 32`, random DEMO_PASSWORD); never echo secrets.
   - demo env overrides: `DEMO_MODE=true APP_ENV=development LLM_PROVIDER=ollama` and isolated storage under `backend/data/demo/`
     (DB_URL, DATA_DIR, UPLOAD_DIR, CHROMA_PERSIST_DIR, any BM25 dir setting).
   - ensure venv (+pip install) and `frontend/node_modules` (npm ci) exist; ensure Ollama is serving (start `ollama serve` if not)
     and `OLLAMA_PRIMARY_MODEL` pulled.
   - seed once (marker), start backend, wait for `/health` (≤90s loop, not `sleep 1`), start frontend, print URLs + "one-click demo
     on the login page", `open` the browser (macOS) at the frontend.
9. Fix Usage & Cost report listing `abstain` as a model: `_usage_rollup` (admin.py ~965) must apply the same answered-only filter
   used elsewhere (`_ANSWERED_ONLY` ~:807). Test.
10. Docs: README "Demo in 60 seconds"; `DEMO_SCRIPT.md` 3-minute talk track (ask → Truth Lens → View in document → Seal receipt →
    Radar shows the planted conflicts → admin analytics).

Tests: corpus builder produces valid PDF/DOCX/CSV/MD (open them back); manifest schema; seed idempotency with ingestion + radar
mocked; demo-login gating (off → 404, production → 404, on → cookies set, unknown persona 422); ready endpoint with mocked httpx;
warmup state transitions incl. failure; suggestions (demo vs derived vs empty; access control); usage fix. Also run `bash -n run.sh`.
