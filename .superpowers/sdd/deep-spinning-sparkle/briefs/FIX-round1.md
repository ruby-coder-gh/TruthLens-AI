# Fix round 1 — all 62 QA bugs (user: "fix all bugs … test also admin panel")

Bug details (steps, expected/actual, evidence, suspected file:line): `../reports/QA-playwright-bugs.md` and `../reports/QA-playwright-report.md`.
Rules: `COMMON.md` (graft first, TDD — a failing test per bug where testable, commits with Co-Authored-By, stay in owned files).
16 GB RAM, 5 lanes run at once: vitest on changed files while iterating, your lane's full gate ONCE at the end
(frontend: `npm run typecheck && npm run lint && npm run test:run && npm run build`; backend lane: targeted pytest dirs + ruff, NOT the
full suite). No live app is running during this round — verify by tests + reasoning; QA round 2 re-checks in the browser.
If a bug turns out to be not-a-bug or needs a product decision, say so in the report instead of guessing. Report: per bug ID →
fixed (commit) / not reproducible / deferred (why).

## Cross-lane contracts (implement exactly)
- C1 locate by text: `GET /api/workspaces/{wid}/documents/{doc}/chunks/{chunk}/locate?text=<evidence sentence>` — when `text` is given,
  search its fragments on the page first and return rects for just that text (fallback: whole chunk as today). (B builds; F1b calls.)
  `SourceTarget` gains optional `highlightText?: string` (F1b adds to SourceViewerContext; F1a passes `claim.evidence` from ledger rows).
- C2 add member by email: `POST /api/workspaces/{wid}/members` accepts `{email, role}` as an alternative to `{user_id, role}`
  (404 "No user with that email" if unknown). (B builds; F2 uses email in the Members tab.)
- C3 my recent chats: `GET /api/queries?mine=true&page_size=N` returns only the caller's queries. (B builds; F2 sidebar uses it.)
- C4 viewers may READ the quarantine list (`GET …/review-queue/quarantine` → 200 for viewers; mutations stay editor-only). (B; F2 fixes copy.)
- C5 receipts list: keep backend `{data:[…]}`; `receiptApi.listForQuery` must unwrap `.data` (F1b edits client.ts for this only).
- C6 admin settings: the backend schema (`backend/app/schemas/analytics.py` settings models + the admin settings endpoint) is the
  source of truth — F3 makes the page read/write exactly those fields and show server values; B verifies the endpoint persists them.
- C7 CSV ingestion: one chunk per ~row group with the header repeated as "Column: value; …" text so rows are retrievable (B). The demo
  corpus is reseeded in QA round 2.
- C8 Trust display is 0–100 everywhere in the UI (F2 dashboard/history; F1a ledger already /100).

## Lanes and owned files
- **B — backend** (`backend/**`): BUG-1 (verify list shape only), 7 (C7), 9 (backend markdown export: `[source:N]` → `[N]` + source list),
  11 (C6 backend side), 15 (C2), 16 (fresh conflicting upload not detected — reproduce with a small 2-doc test through the real
  auto-scan path + real models if cached; fix root cause), 17 (C1), 19 (admin total chunks), 24 (default prompt: when sources disagree,
  state both figures with citations and say they disagree — don't pick one), 34 (C4), 35 (demo-login + login set `last_login_at`),
  59 (C3), 60 (reject/flag exact-duplicate upload in a workspace by content hash → 409 with a clear message), 10 (backend side only if the
  investigation API can report per-step progress cheaply; otherwise say so).
- **F1a — chat + ledger** (`frontend/src/pages/ChatPage.tsx`, `ChatDetailPage.tsx`, `components/ledger/**`, `utils/docTitle.ts`, their tests):
  BUG-4 (chat side: citations inline, no orphan periods, while streaming and in prose view), 5 (show the conflict note/row when a cited
  source has `conflicts > 0` even if the partner isn't cited — use radar contradiction data for the partner sentence + doc), 6 (verified
  shield only when guardrail passed; otherwise honest state), 8 (short titles everywhere in chat/ledger/exhibits; page numbers on fresh
  answers), 9 (chat Copy/Export client-side text without raw markers), 22 (stored answer pages = same ledger view, tally chips, action bar),
  26 (PARTIAL score display), 27 (D1/D2 labels), 28 (score-bar fill class — no runtime-built Tailwind classes), 29 (difference with unit/
  currency), 31 (Regenerate on every answer), 32 (avatar initials consistent with sidebar), 50 (chat part: cached answers' audit record,
  Stop step text), 52 (mobile composer), C1 caller side (pass `highlightText: claim.evidence`).
- **F1b — receipts + source viewer** (`components/SealReceiptButton.tsx`, `pages/ReceiptPage.tsx`, `components/receipt/**`,
  `components/source-viewer/**`, `context/SourceViewerContext.tsx`, `api/client.ts` receipts unwrap only): BUG-1 (C5), 2 (geometry —
  backend rects are top-left origin PDF points; don't flip), 4 (receipt page citations inline), 9 (receipt page markers), 17 (C1 viewer
  side: request with `text`, highlight that), 47 (receipt status screens: brand + home link).
- **F2 — shell + user pages** (`components/Layout.tsx`, `GlobalSearch.tsx`, `DemoTour.tsx`, `ui.tsx`, `pages/*` except Chat*, Receipt*,
  Admin*; `context/AuthContext.tsx`; `api/client.ts` auth-refresh logic only): BUG-3, 13 (search modal close/focus/Esc), 10 (investigation
  report markdown + citations rendering + progress UI), 12 (delete confirm + invalidate sidebar Recent), 14 (hide upload for viewers),
  15 (C2 UI: invite by email), 20/21/33 (tour copy for Claim Ledger, pill position not covering sidebar account row, Esc closes, only for
  demo accounts, re-openable), 25 (375 overflow), 30 (workspace stats + refresh after upload/member add), 34 (copy), 41, 45, 46, 48 (avoid
  noisy 401s on public pages if cleanly possible — else explain), 49, 50 (dashboard trust /100), 51, 53, 54, 55, 56, 57 (if on a user page;
  else F3), 58, 59 (C3), 60 (show the 409 duplicate message), 61, 62 (radar reopen + undo toast), 9 (review queue / search / comparison /
  golden-prefill marker stripping in non-admin pages).
- **F3 — admin pages** (`frontend/src/pages/Admin*.tsx`, `components/api-catalog/**`, `pages/ApiCatalogPage.tsx`, their tests;
  `api/client.ts` admin methods only): BUG-11 (C6 UI), 18 (collections edit/delete/add docs — whatever the API supports), 19 (UI side if
  needed), 23 (admin upload accepts CSV/JSON — same list as backend), 35 (`last_login_at`), 36 (audit action filter includes new actions),
  37 (poll while reindexing), 38 (doc detail/list: uploader name, chunks/tags/quarantine, type labels), 39 (confirm role change / promote /
  rollback; "restore built-in default"), 40 (line diff — `diff` package is installed), 42 ("—" when no eval), 43 (cost footnote reflects
  configured pricing / local model), 44 (API catalog lists current endpoints incl. receipts/radar/demo/viewer, no fake uptime), 57 (usage
  date validation), 9 (golden prefill / admin views marker stripping).
