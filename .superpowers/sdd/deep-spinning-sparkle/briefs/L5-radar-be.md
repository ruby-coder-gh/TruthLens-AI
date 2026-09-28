# L5 — Contradiction Radar backend

Owned: `backend/app/radar/*` (scaffold stub `scan.py:run_scan`), `backend/app/api/radar.py` (scaffold empty router),
`backend/app/api/documents.py` (post-ingest hook ONLY, ~line 610), `backend/app/api/ws.py` (sources `conflicts` count ONLY — lane L1
also edits ws.py guardrail frame; keep your change tiny and local), tests. Models `RadarScan`, `Contradiction` from scaffold.

Reuse: `guardrail.nli_batch` (scaffold), `_load_model` embedder (`ingestion/embedder.py:30`), `get_workspace_collection`
(`chroma_client.py:26`, cosine; ids `f"{doc}:{index}"`, metadata has chunk_id UUID, document_id, document_name, page_number),
`stream_registry.track_task` (api/stream_registry.py:69) for background tasks, `async_session_factory` for own sessions,
deps `check_workspace_access_or_admin` / `require_workspace_editor` (core/deps.py).

Build:
1. `run_scan(workspace_id, document_ids=None, created_by=None) -> scan_id` (awaitable, does the full work) and
   `start_scan_task(...) -> scan_id` (creates `queued` row, commits, spawns tracked task, returns immediately). One active scan per
   workspace (running/queued) → API 409.
2. Algorithm (all heavy CPU/Chroma calls in `asyncio.to_thread`; never block the loop — note `embed()` blocks today, don't reuse it on the loop):
   - Scope chunks: `collection.get(where={"document_id": {"$in": ids}} or all, include=["embeddings","documents","metadatas"])`,
     cap `RADAR_MAX_CHUNKS` (log when capped). Skip quarantined chunks if they are present in Chroma (check quarantine module).
   - Per chunk: `collection.query(query_embeddings=[emb], n_results=RADAR_NEIGHBOURS, where={"document_id": {"$ne": doc}})`;
     similarity = 1 - distance ≥ `RADAR_MIN_SIMILARITY`. Dedupe unordered chunk pairs.
   - Sentences (20–400 chars) of both chunks; embed all sentences in one batch; per chunk pair keep top `RADAR_SENTENCE_PAIRS`
     sentence pairs with cosine ≥ 0.5.
   - `nli_batch` both directions; contradiction = max(c_ab, c_ba), entail = max(e_ab, e_ba). Flag if contradiction ≥
     `RADAR_MIN_CONTRADICTION` and contradiction > entail.
   - Persist `Contradiction` with canonical ordering (a/b sorted by chunk id), `pair_key` = sha1 of the canonical pair incl. sentences;
     existing pair_key → skip (preserve dismissed/resolved status). Update scan counters as you go (chunks_scanned, pairs_checked, found)
     so the UI can show progress; `status` running→done, or failed with `error`.
3. Post-ingest hook in `process_document_background` after the successful commit: if `RADAR_AUTO_SCAN` and chunk_count > 0 →
   `start_scan_task(workspace_id, [document_id])`. Must never raise into ingestion (wrap + log). If a scan is already active, skip.
4. Document deletion: contradictions must go (FK cascade only works if SQLite `PRAGMA foreign_keys=ON` — check `database.py`;
   else delete explicitly in the document delete paths incl. bulk delete in admin_documents.py — keep edits minimal and list them).
5. API (`api/radar.py`, contract in plan.md): `POST /api/workspaces/{wid}/radar/scans` (editor; 202; 409 active),
   `GET /api/workspaces/{wid}/radar?status=` (access; latest scan + contradictions with document names + page_number from Chroma
   metadata when cheap, open first, newest first; counts), `PATCH /api/workspaces/{wid}/radar/contradictions/{cid}` (editor; status
   open|dismissed|resolved; sets resolved_by). Audit `radar.scan` / `radar.update`.
6. `radar.conflict_counts(session, chunk_ids) -> dict[chunk_id,int]` (open only, one query); ws.py sources frame items get `conflicts`.

Tests: fake Chroma collection + mocked `nli_batch` + mocked sentence embedder → finds planted contradiction, ignores same-doc,
respects thresholds, dedupes, preserves dismissed; start_scan_task 409 path; hook fires on successful ingest and not on failure;
API access (viewer can GET not POST/PATCH); conflicts count in sources frame.
