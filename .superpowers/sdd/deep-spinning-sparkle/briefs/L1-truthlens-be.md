# L1 — Truth Lens backend (per-claim verdicts)

Owned: `backend/app/generation/guardrail.py`, `backend/app/api/ws.py` (guardrail frame, claim persistence, cached replay),
`backend/app/api/queries.py` (`_to_detail`, markdown export), `backend/app/schemas/query.py`, `backend/app/graph/query_graph.py` (optional), tests.

Problem today (guardrail.py:97-176): every claim is scored against ONE merged premise of all contexts → deberta 512-token
truncation drops late chunks; per-claim scores and unsupported list are discarded; WS guardrail frame sends only
`{passed, score, details}`; nothing saved.

Build:
1. `guardrail.check(answer, contexts)` → `GuardrailResult` gains `claims: list[dict]` (default `[]`). Keep `passed/score/unsupported_claims/details`.
   - Claim spans with char offsets into the ORIGINAL `answer` string (the one persisted as `response_text` and rendered).
     `_extract_claims` replaces `\n` with space — add `_extract_claim_spans(answer) -> list[(text, start, end)]` that yields the
     same claims with offsets (`-1,-1` if not locatable). Keep `_extract_claims` behaviour for existing callers/tests.
   - NLI hypothesis = claim text with `[source:N]` markers stripped; remember first cited N.
   - Pairs = each claim × each context `content` (premise). ONE `nli_batch(pairs)` (scaffold helper) via `asyncio.to_thread`.
     Cap at 12 claims × 8 contexts (log if capped).
   - Per claim: best-support context = argmax entailment; ratio = e/(e+c) there. Verdict (constants at module top, tune with tests):
     supported: e ≥ 0.5 and ratio ≥ GUARDRAIL_THRESHOLD · contradicted: max contradiction ≥ 0.6 and best e < 0.3 ·
     partial: not supported but (ratio ≥ 0.5 or e ≥ 0.3) · else unsupported.
   - Chosen context = contradicting one for `contradicted`, else best-support. `source_index` = 1-based position in `contexts`
     (verify contexts order == `[source:N]` numbering used by generator/ws sources frame).
   - `evidence` = sentence in chosen context with max word-overlap with the claim (lowercase, stopwords removed), ≤ 400 chars.
   - `chunk_id, document_id, document_name, page_number` from the context dict / its metadata (inspect the dict shape ws.py passes).
   - Claim object shape exactly as plan.md "Claim object".
   - `score` = min(per-claim ratio); `passed` = score ≥ threshold; `unsupported_claims` = texts with verdict unsupported|contradicted.
   - NLI model unavailable → keep today's pass-through (score 1.0) and `claims=[]`.
2. `api/ws.py`: guardrail frame payload adds `claims` and `unsupported_claims` (read with `getattr(result, "claims", [])` — test fakes are SimpleNamespace).
   Persist a `QueryClaims` row (scaffold model) alongside `_save_query` (same session/transaction). Cached replay: if the cached
   origin query has a claims row, replay its claims in the guardrail frame, else `[]`. Abstentions: no claims.
3. REST: `QueryDetailResponse.claims: list[ClaimOut] | None` (pydantic model mirroring the Claim object); `_to_detail` loads the row
   (detail endpoints only — no N+1 on list endpoints).
4. Query delete paths: ensure claims rows go too (check whether SQLite `PRAGMA foreign_keys=ON` is set in `database.py`; if not, delete explicitly).
5. Markdown export `_render_query_markdown`: add "Claim verification" section (✅ supported / ⚠️ partial / ❌ unsupported / ⛔ contradicted + evidence).
6. Optional (only if cheap): query_graph `_guardrail_node` carries claims so compare re-run persists them.

Tests: guardrail unit (mock `nli_batch` or model; offsets; marker stripping; verdict thresholds; caps; model None), ws pipeline
test asserts claims in frame + row saved, cached replay, detail endpoint returns claims, export section. Fix existing tests
that break from the new scoring and say which in report.
