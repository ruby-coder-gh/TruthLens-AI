# Fix round 2 — close everything QA round 2 left open

QA2 results: `../reports/QA2-verification.md` (still-broken 7/16/53; partial 8/10/15/17/24/29/33/36/38/39/40/50) and
`../reports/QA2-new-bugs.md` (R2-1 … R2-21). Screenshots referenced as `$QA2/…` are in the session scratchpad `qa2/` folder.
Rules: `COMMON.md` (graft first, TDD — failing test first per bug where testable, commits with Co-Authored-By, owned files only).
16 GB RAM, 3 lanes at once, no live app during the round: frontend vitest on changed files, full frontend gate once at the end;
backend targeted pytest + ruff (never the full suite). Report per bug ID: fixed (commit) / not reproducible / needs decision (why).

## Contracts (implement exactly)
- K1 sources frame (WS `sources` items) and stored `response_sources` expose `page_number` when known (from chunk metadata). (B2; F2a shows it — BUG-8)
- K2 text-mode locate: `GET …/chunks/{chunk}/locate?text=…` in `mode:"text"` returns `highlight: {start, end} | null` — character
  offsets of `text` inside `content` (whitespace-insensitive match). PDF mode unchanged. (B2; F2a marks only that span — BUG-17)
- K3 display names: documents list + detail include `uploaded_by_name` (username, else email); audit-log rows include `user_name`;
  golden entries include `workspace_name`. (B2; F2b shows them — BUG-36, 38, R2-18)
- K4 regenerate: WS query payload accepts optional `replaces_query_id`; after the new answer is saved, the backend deletes the replaced
  query if it belongs to the caller and has no receipts (otherwise keeps it). (B2; F2a sends it and replaces the turn in place — R2-21)
- K5 receipts carry conflicts: receipt payload gains `conflicts: [{a:{document_name,page_number,sentence}, b:{…}, score}]` — open Radar
  contradictions involving the answer's cited chunks. (B2; F2a renders them on /r/:token — R2-16)
- K6 query deletion authz: DELETE a query → allowed for the query's author, workspace owner/editor, or admin; viewers get 403 for others'
  queries. `/chats` lists the caller's own queries (use `mine=true`). (B2 backend; F2a/F2b hide Delete where not allowed — R2-1)

## Lane B2 — backend (`backend/**`, `.env.example`)
R2-1 (K6), BUG-7 (pipeline question abstains: make CSV row chunks retrievable for "projects … under construction" — e.g. prefix each row
chunk with the document title + a short table description and group a few rows per chunk; verify with the REAL embedder+reranker in a
small repro that the question's top rerank score clears `SUFFICIENCY_MIN_RERANK_SCORE`), BUG-16 (reproduce with the exact QA note:
"closed the year 2025 with 1,580 employees" vs "employed 1,240 people at year end"; "Kestrel Ridge … commissioned in November 2024" vs
"March 2024" — trace which radar stage drops each pair (neighbour k, sentence sim, same-subject, NLI) with real models and fix the root
cause without reintroducing the known false positives in tests/test_radar), R2-4 (sentences that only assert that sources disagree /
a discrepancy exists are meta-statements: exclude them from claim scoring like the "I cannot find…" refusal, or verify them against
Radar — the guardrail must not fail an honest conflict answer), R2-5 (JSON loader: flatten to "key.path: value" lines, or reject JSON
consistently in both upload paths — choose loader), R2-7 (investigation synthesis gets the workspace's open Radar contradictions for
the retrieved documents as explicit context so "identify conflicts" reports them), BUG-24 (strengthen the disagreement instruction; add a
cheap post-check: if two cited sources are an open Radar pair and the answer names only one figure, append the other with its citation),
R2-12 (register stamps last_login_at), R2-14 (APP_NAME default "TruthLens AI" in config + .env.example), K1, K2, K3, K4, K5.
Also update the local demo env file `backend/.env` APP_NAME line if present (untracked; do not commit it).

## Lane F2a — chat, receipt, viewer, radar, search (frontend: `pages/ChatPage.tsx`, `ChatDetailPage.tsx`, `components/ledger/**`,
`components/SealReceiptButton.tsx`, `pages/ReceiptPage.tsx`, `components/receipt/**`, `components/source-viewer/**`,
`context/SourceViewerContext.tsx`, `components/radar/**`, `components/GlobalSearch.tsx`, `pages/ReviewQueuePage.tsx`,
`pages/ChatHistoryPage.tsx`, `pages/InvestigationPage.tsx`, `api/client.ts` + `types.ts` for the fields above)
R2-3 (show a conflict row only when the contradiction's sentences are about a claim in this answer — shared numbers/keywords with a
claim or its evidence — never every contradiction on the page; parse figures properly: ignore years/commas, keep currency/unit/scale so
the difference reads €14M / 7 pts; "Compare the pages" passes each side's sentence as `highlightText`), BUG-8 (K1 page numbers on live
answers; press-release title), BUG-10 (reasoning-trace sub-answers render markdown + citations like the report), BUG-17 (Radar "View in
document" passes the sentence; text mode marks only the K2 span), BUG-29, BUG-53 (strip the MIME from the combined snippet), R2-6 (viewers:
hide review-queue actions and Seal receipt; if an action 403s show the real message), R2-8 (single scroll container), R2-16 (receipt: K5
conflict section, header wording honest when guardrail failed, same verdict names as the ledger), R2-17 (confirm before revoke), R2-20
(caret inline at the end of the text), R2-21 (K4 + replace the turn in place), R2-1 UI (hide Delete where K6 forbids; /chats = mine),
BUG-50 residual in chat if any.

## Lane F2b — admin + shell + other pages (frontend: `pages/Admin*.tsx`, `components/api-catalog/**`, `pages/ApiCatalogPage.tsx`,
`components/Layout.tsx`, `components/DemoTour.tsx`, `pages/WorkspaceDetailPage.tsx`, `pages/UserDashboard.tsx`, `components/ui.tsx`,
their tests; `api/client.ts` + `types.ts` only for K3 fields / member role method)
R2-2 + BUG-33 (move the demo tour out of the floating corner: a "Tour n/5" button in the top bar opening a popover that closes on "Go",
Esc and outside click; show only for the two seeded demo accounts analyst@truthlens.dev / admin@truthlens.dev — not every @truthlens.dev
address), BUG-15 + R2-9 (member role-change control using the existing `PUT /workspaces/{id}/members/{user_id}`, menu closes on Esc,
backdrop doesn't block), BUG-36/38/R2-18 (K3 names; admin documents table fits 1280 without horizontal scroll), BUG-39 (users-list
inline role change + Deactivate confirm), BUG-40 (diff falls back to word-level when either side is a single line), BUG-50 (admin Avg
Trust on /100), R2-10 (timeline treats `ready` as complete), R2-11 (keep `last_login_at` after role change), R2-13 (dashboard abstain
label), R2-14 UI (rate-limit card read-only, no dead Save), R2-15 ("Upload 0 file" copy), R2-19 (no fabricated latencies in the API
catalog pipeline panel — show stage names only or real config values).
