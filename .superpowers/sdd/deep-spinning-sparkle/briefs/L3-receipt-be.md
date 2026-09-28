# L3 — Truth Receipt backend

Owned: new `backend/app/receipts.py` (service), `backend/app/api/receipts.py` (scaffold empty router), tests. Scaffold model `Receipt`.

Build:
1. Service:
   - `build_payload(query, claims, workspace) -> dict`: `version:"tl-receipt/1"`, `question`, `answer` (response_text with markers),
     `claims` (from `query_claims` row, may be empty), `sources`: only contexts cited by `[source:N]` in the answer or referenced by a
     claim's `source_index` — each `{index, document_name, page_number, excerpt: content[:1200], content_sha256: sha256(full content)}`
     (full contexts live in `Query.response_sources` JSON), `trust {score, components}`, `guardrail {passed, score}`,
     `model_used`, `prompt_version`, `workspace_name`, `asked_at` (query created_at ISO), `issued_at`, `issuer:"TruthLens AI"`.
   - `canonicalize(payload) -> str` = `json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`.
   - `seal = sha256(canonical.encode()).hexdigest()`; `signature = hmac.new(key, seal.encode(), sha256).hexdigest()`,
     key = `sha256(b"tl-receipt|" + APP_SECRET_KEY.encode()).digest()`.
   - `verify(receipt) -> (seal_valid, signature_valid)` recomputing from stored `canonical`; `hmac.compare_digest`.
2. Routes (contract in plan.md):
   - `POST /api/queries/{qid}/receipts` — auth; user must have access to the query's workspace (reuse deps; 404 if no access, don't leak);
     422 if the query is an abstention / has no answer; 404/403 when `RECEIPTS_ENABLED` false. Token `secrets.token_urlsafe(24)`.
     Returns `{token, url_path:"/r/{token}", seal, created_at}`. Audit log `receipt.create` (follow existing audit helper usage, resource ids populated).
   - `GET /api/receipts/{token}` — PUBLIC (no auth dependency). 404 unknown; 410 revoked. Increments `view_count` atomically.
     Returns `{payload, canonical, seal, seal_valid, signature_valid, issued_at, revoked:false}`. Headers `Cache-Control: no-store`, `X-Robots-Tag: noindex`.
   - `DELETE /api/receipts/{token}` — creator, workspace owner, or admin; sets `revoked_at`; audit `receipt.revoke`; 204.
   - `GET /api/queries/{qid}/receipts` — access required; list `{token, url_path, seal, created_at, revoked_at, view_count}`.
3. Make sure the public GET is reachable without cookies (check any global auth middleware / CSRF) and not blocked by security headers.

Tests: create → public view verifies; tamper stored canonical/payload → `seal_valid` false; tamper seal → signature false; revoke → 410;
access control (other user 404, viewer allowed, non-creator non-owner revoke 403); public GET with no cookies; unknown token 404;
abstention 422; disabled flag.
