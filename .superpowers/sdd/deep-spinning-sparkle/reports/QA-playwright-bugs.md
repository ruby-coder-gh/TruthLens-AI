# QA Playwright sweep — bug list (branch feat/truth-suite-demo @ 68ccdfb, demo mode)

Date 2026-09-28. Tester: QA lead (Playwright MCP, Chromium, 1280×800 + 375×812 + 768/900/1024).
Screenshots: `$QA` = `/private/tmp/claude-501/-Users-nikunjvaghasiya-SGP-TruthLens-AI--claude-worktrees-user-agent-reach-improve-fd209b/818b146a-b404-4aa6-ab8f-442350d7a541/scratchpad/qa/`
File:line paths are relative to the worktree root. Format: `BUG-n · Sev · page · steps · expected vs actual · evidence · suspected file:line`.

**Totals: 62 bugs — S1 3 · S2 22 · S3 37.**

## S1 — broken feature / crash / blocks the UI

**BUG-1 · S1 · live chat + `/chat/:id` + `/workspaces/:id/queries/:id` · Seal receipt crashes the whole app**
Steps: ask any question (or open any stored answer) → click **Seal receipt**.
Expected: warning copy → create → link + copy + QR. Actual: full-page "Render Error — TypeError: existing.filter is not a function at SealReceiptButton (SealReceiptButton.tsx:84)". Reproduced in live chat and on the stored-answer page; blocks the whole receipt UI flow (create, copy link, QR, revoke) and tour step 4.
Evidence: `$QA/61-seal-render-error.png`; console `TypeError: existing.filter is not a function`; `GET /api/queries/{id}/receipts` → `200 {"data":[]}`.
Root cause: backend returns a `ListResponse` envelope (`backend/app/api/receipts.py:116`), the client types it as a bare array (`frontend/src/api/client.ts:745-746`), and `setExisting` stores the object (`frontend/src/components/SealReceiptButton.tsx:34-38`), which then crashes on `.filter` (`:84`).

**BUG-2 · S1 · source viewer (every PDF entry point) · highlight boxes are mirrored vertically and don't sit on the cited passage**
Steps: in the ledger, click the evidence link `[2] … Annual Report 2025, page 1` (or open from Exhibits, Radar "View in document", doc-detail Passage N, or a `?chunk=` deep link).
Expected: boxes cover the cited passage. Actual: 13–27 boxes are scattered over the page. **Passage 2** is the "Financial Highlights" table at the *bottom* of the page, but its boxes are drawn at the *top*. The table-column pattern (Revenue | €412M | €356M) appears over the "Dear shareholders" lines, which proves a y-flip.
Evidence: `$QA/84-doc-passage2-viewer.png`, `$QA/26-viewer-top.png`, `$QA/71-radar-viewA.png`.
Root cause: `backend/app/ingestion/locate.py:84` returns PyMuPDF `search_for` rects, whose origin is top-left with y pointing down. `frontend/src/components/source-viewer/geometry.ts:15-39` documents them as bottom-left PDF space and flips them again through `convertToViewportPoint`.

**BUG-3 · S1 · global search (⌘K) · after you pick a result the modal can't be closed, so the app is blocked until reload**
Steps: click Search → type "revenue" → click a result.
Expected: modal closes and the page navigates. Actual: the page navigates, but the modal and scrim stay on top. Esc, the X button and a scrim click do nothing, and every click underneath is blocked (Playwright: "bg-scrim … intercepts pointer events"). Reproduced twice from /dashboard and from the chat.
Evidence: `$QA/97-search-stays-open.png`, `$QA/99-search-stuck-repro.png`.
Suspected: `frontend/src/components/GlobalSearch.tsx:72-79` (`setOpen(false)` and `navigate()` in the same tick) together with the `AnimatePresence` exit in `frontend/src/components/ui.tsx:389-396`. The exit animation is orphaned by the route change.

## S2 — wrong behaviour / confusing UX on a main path

**BUG-4 · S2 · live chat (streaming) + public receipt `/r/:token` · every `[n]` citation sits on its own line and leaves orphan periods** (CEO #1 confirmed)
Streaming renders "…third quarter of 2027 / ²³⁴ / . However…"; the receipt page renders the same splits for the stored answer.
Evidence: `$QA/30-q2-stream-3.png`, `$QA/63-receipt-public.png`.
Root cause: `frontend/src/components/ledger/ProseAnswer.tsx:42-50` (`withCitationsBlock` renders each text segment as its own `<ReactMarkdown>`, which becomes a block `<p>`). The same pattern appears in `frontend/src/pages/ReceiptPage.tsx:61-92`.

**BUG-5 · S2 · chat ledger · a planted contradiction is hidden when the answer cites only one side**
Steps: ask "What was Northwind Renewables' revenue in 2025?".
Expected: a conflict note or row (€412M vs €398M). Actual: C1 "€412 million" is VERIFIED 1.00 and trust is 86/100, with no conflict row or note. Exhibit [1] (press release, €398M, relevance 94) is only tagged "Conflict" in the list. The Aurora answer has the same problem: the prose mentions Q3 2027 and Q1 2028, but the ledger has no D-row.
Evidence: `$QA/23-q1-why.png`, `$QA/21-q1-done.png`, `$QA/32-q2-ledger.png`.
Root cause: `frontend/src/components/ledger/conflicts.ts:14-24` only pairs a contradiction when *both* chunks are cited by claims.

**BUG-6 · S2 · chat ledger · says "Answer verified" with a green shield when the guardrail failed**
The emissions answer has `guardrail_passed=false`, faithfulness 38% and trust 61. The chat status reads "Answer verified: Checked 5 claims…" while the public receipt for the same answer says "Guardrail failed — 38%".
Evidence: `$QA/51-chat-detail.png` vs `$QA/63-receipt-public.png`.
Code: `frontend/src/components/ledger/AuditTrail.tsx:149` always prefixes "Answer verified".

**BUG-7 · S2 · demo chat · a suggested question always abstains**
"Which projects in the pipeline are currently under construction?" returns "No sufficient evidence — best evidence score 0.09" in 3.6 s. `project-pipeline.csv` has 5 rows with status `construction`, but it is ingested as a single chunk (`chunk_count: 1`).
Evidence: `$QA/44-q5-projects.png`.
Suspected: `backend/app/ingestion/loader.py:147` (`_load_csv`, whole file becomes one chunk) together with the sufficiency gate in `backend/app/retrieval/sufficiency.py:96`.

**BUG-8 · S2 · ledger / exhibits / D-row · full document names are shown; at 375 px every exhibit reads "Northwind Renewables — 20…"** (CEO #2 confirmed)
Evidence: `$QA/32-q2-ledger.png`, `$QA/91-ledger-375-D.png`.
Root cause: `frontend/src/utils/docTitle.ts:14-24`. `sharedPrefix` only strips a prefix that *every* name shares, and "Board Memorandum: …" and "Northwind Renewables Reports …" break it, so nothing is shortened.

**BUG-9 · S2 · Copy / Export / Review queue / search / comparison / golden prefill · raw `[source:N]` markers leak**
- Clipboard after "Copy response" = "…€412 million [source:2]."
- The exported `.md` contains `[source:2]`.
- The Review-queue card shows "…March 2021 [source:2]. Note: While source [source:1]…".
- Search snippets and the comparison original/rerun show the same markers.
- The golden-set reference answer is prefilled with them.

Evidence: `$QA/RQ-1.png`, `$QA/96-search-results.png`, `$QA/CMP-1.png`.
Code: `frontend/src/pages/ChatPage.tsx:442-445`, `frontend/src/pages/ReviewQueuePage.tsx:174,550`, `frontend/src/components/GlobalSearch.tsx:117`.

**BUG-10 · S2 · `/workspaces/:id/investigate` · the case-file report renders raw markdown, and the run takes about 4 min with no progress**
The report shows 48 raw `**bold**`, 78 raw `[source:N]` and literal `---` lines. The run took 241.8 s behind a static "Investigating… Building your case file" with no progress indicator.
Evidence: `$QA/INV-4-rawmd.png`, `$QA/INV-3.png`.
Code: `frontend/src/pages/InvestigationPage.tsx:80-93` (hand-rolled line renderer with no inline markdown or citations).

**BUG-11 · S2 · `/admin/settings` · saving does nothing and the page shows made-up values**
The UI shows workspace name "TruthLens AI", trust 0.75/0.50 and model selects. The backend returns `app_name "VeritasRAG"` and thresholds 0.7/0.4. Saving sends `{trust_threshold_high, trust_threshold_medium}`, `workspace_name`, `llm_model` and similar fields that the backend ignores. PUT returns 200 with the values unchanged, and after a reload the UI shows its hard-coded defaults again.
Evidence: `$QA/ADM-settings.png`; PUT body vs response in the report.
Code: `frontend/src/pages/AdminSettingsPage.tsx:17,64-70,170,201,301-302` vs `backend/app/schemas/analytics.py:36-48` and `backend/app/api/admin.py:1239-1245`.

**BUG-12 · S2 · `/chats` · Delete chat deletes immediately with no confirmation, and the sidebar still lists the deleted chat**
One click sends `DELETE …/queries/{id}` (204) with no dialog. The chat stays in the sidebar "Recent" list until reload.
Code: `frontend/src/pages/ChatHistoryPage.tsx:56` (`handleDelete`). The Recent query is not invalidated.

**BUG-13 · S2 · ⌘K search · focus lands on the Close button, so typing does nothing; Esc from the input doesn't close**
Code: `frontend/src/components/ui.tsx:350-355` (`focusFirst` focuses the first focusable element, the X button, which overrides `autoFocus` on the input at `GlobalSearch.tsx:97`).
Evidence: `$QA/95-search.png`.

**BUG-14 · S2 · workspace Documents tab (viewer role) · Upload button and drop zone are shown to viewers**
The server correctly rejects the upload with 403 "Viewer role cannot upload documents", but the UI offers the action.
Evidence: `$QA/VW-1-docs.png`.
Code: `frontend/src/pages/WorkspaceDetailPage.tsx:534,639` (`DocumentsTab` gets no role; `isOwner`/`myRole` are computed at `:391-393` but not passed down).

**BUG-15 · S2 · workspace Members tab · "Invite member" needs a raw User ID (UUID)**
Entering `viewer.qa@truthlens.dev` gives "User not found: viewer.qa@truthlens.dev", and an owner has no way to look up another user's UUID. The tab also has no role-change or remove controls.
Evidence: `$QA/MEM-2-email.png`.
Code: `frontend/src/pages/WorkspaceDetailPage.tsx:1106,1360`.

**BUG-16 · S2 · Contradiction Radar · a fresh conflicting upload is not detected**
Uploaded a note with "1,580 employees" (Annual Report says 1,240) and "Kestrel Ridge commissioned November 2024" (Annual Report says March 2024). The auto-scan ran (scope = new doc, 1 chunk, 4 pairs) and found 0; a follow-up full scan also found nothing new.
Suspected: radar thresholds or neighbour selection, `backend/app/config.py:221-225` (`RADAR_NEIGHBOURS=4`, `RADAR_MIN_SIMILARITY=0.55`, `RADAR_SENTENCE_PAIRS=3`) with page-sized chunks.

**BUG-17 · S2 · source viewer · the "highlight" covers the whole chunk (≈ whole page or document), not the cited sentence**
Chunks are page-sized (Annual Report 4 chunks, CSV 1). DOCX/MD text mode marks the whole memo from the top, so Radar "View B" does not point at "Aurora is now expected to commission in the first quarter of 2028".
Evidence: `$QA/72-radar-viewB-docx.png`, `$QA/73-radar-viewB-md.png`.
Code: the viewer locates `content=chunk text` (`backend/app/ingestion/locate.py:94`); it should use the claim or radar sentence.

**BUG-18 · S2 · `/admin/collections` · only Create works**
Cards have `cursor:pointer` but clicking does nothing. There is no edit, delete or add-document action, and an empty-name Create silently does nothing. (The QA collection was deleted through the API.)
Evidence: `$QA/ADM-coll-1.png`.
Code: `frontend/src/pages/AdminCollectionsPage.tsx:123-241`.

**BUG-20 · S2 · presenter tour · step 2 copy is stale**
"2. Turn on Truth Lens and hover a claim": there is no Truth Lens toggle after the Claim Ledger redesign. Step 4 (seal a receipt) hits BUG-1.
Code: `frontend/src/components/DemoTour.tsx:122`.

**BUG-21 · S2 · app shell · the "Demo tour" pill covers the sidebar account row** (CEO #5 confirmed)
On desktop the username and role are hidden; only the sign-out icon shows. At 375 px it overlaps the composer's bottom edge.
Evidence: `$QA/11-demo-after-8s.png`, `$QA/TOUR-375.png`.
Code: `frontend/src/components/DemoTour.tsx:142` (`fixed bottom-4 left-4 z-40`).

**BUG-22 · S2 · stored answer pages `/chat/:id` and `/workspaces/:id/queries/:id` differ from the live answer**
- No claim-summary chips (e.g. "2 verified · 2 partial · 1 conflict").
- No Copy, Export, 👍/👎 or Regenerate.
- Exhibits lose their "Conflict" tags.
- The page uses the legacy "Chat Detail / Review question, response, and sources" chrome with no composer.

Evidence: `$QA/51-chat-detail.png` vs `$QA/41-q3-conflict-row.png`.
Code: `frontend/src/pages/ChatDetailPage.tsx:147-223`.

**BUG-23 · S2 · `/admin/documents/upload` · CSV and JSON are rejected**
Multi-select of `.txt` + `.csv` uploads only the `.txt`; the CSV gets an "Unsupported file type" toast. The accept list is `.pdf,.docx,.xlsx,.txt,.md`, although the backend and the workspace upload accept CSV (the demo corpus includes one). The copy also disagrees across pages (landing says CSV; /documents says CSV+JSON; admin says XLSX).
Evidence: `$QA/ADM-upload-1.png`.
Code: `frontend/src/pages/AdminUploadPage.tsx:31,178`.

**BUG-24 · S2 · answer quality (prompt) · the CEO answer picks a side**
The answer ends "Therefore, the correct answer is March 2021", which contradicts the product promise "TruthLens shows both and doesn't pick one". The ledger stamps that claim CONTRADICTED and trust is 0.47. Answers are also verbose: 87–234 tokens, and list-intro sentences such as "The key risks … are:" become PARTIAL 0.00 claims.
Evidence: `$QA/43-q4-ceo.png`, `$QA/45-q6-risks.png`.
Code: the default answer prompt (`backend/app/api/admin_prompts.py` registry default).

**BUG-25 · S2 · `/workspaces` and `/documents` at 375 px · cards overflow horizontally**
Card right edges sit at 465 px and 615 px, so they are clipped with an inner horizontal scroll. Long names don't truncate (`min-w-0` is missing).
Evidence: `$QA/R375_workspaces.png`, `$QA/R375_documents.png`.

**BUG-26 · S2 · ledger · PARTIAL rows show an entailment score of ~0.00** (CEO #4 confirmed)
Emissions C5 PARTIAL 0.00, Aurora C2 PARTIAL 0.02, C4 0.03. The verdict comes from the support *ratio*, but the UI displays best *entailment*.
Code: `backend/app/generation/guardrail.py:132-139` (partial when `ratio >= 0.5` even at entailment ≈ 0) and `frontend/src/components/ledger/ClaimLedger.tsx:136`.

## S3 — polish

- **BUG-19 · S3 · `/admin`** — "Total Chunks Indexed 0" is hard-coded; 15–17 chunks exist. `backend/app/api/admin.py:200`.
- **BUG-27 · S3 · ledger** — conflict rows are labelled with a literal "D", so two conflict rows would both read "D" instead of D1/D2 (CEO #3; confirmed in code, and only one D per answer appeared this run). `frontend/src/components/ledger/ClaimLedger.tsx:232`.
- **BUG-28 · S3 · ledger** — the score-bar fill is invisible. The class is built at runtime (`textClass.replace('text-','bg-')` → `bg-v-supported`), so Tailwind never generates it and the computed background is transparent. `ClaimLedger.tsx:130`. `$QA/33-scorebar-zoom.png`.
- **BUG-29 · S3 · ledger D-row** — "Difference 7" has no unit (should be "7 pts"; the prototype shows "€14M"). `ClaimLedger.tsx:252`.
- **BUG-30 · S3 · workspace header/stats** — "AI Queries —" and "Storage Used —" are hard-coded (CEO #7). The Documents/Members stats and "6 documents" header go stale after an upload or member add. `frontend/src/pages/WorkspaceDetailPage.tsx:197-198`.
- **BUG-31 · S3 · chat** — Regenerate only appears for cached answers; the prototype has it on every answer. `frontend/src/pages/ChatPage.tsx:793`.
- **BUG-32 · S3 · chat** — the question avatar shows "DE" while the sidebar shows "DA" for demo_analyst (`slice(0,2)` of the username). `ChatPage.tsx:127`.
- **BUG-33 · S3 · presenter tour** — Esc doesn't close the popover. The panel stays open over the content after "Go". Once hidden there is no way to bring it back. Non-demo users (viewer_qa, editor_qa) also see "Demo tour 0/5". `frontend/src/components/DemoTour.tsx`.
- **BUG-34 · S3 · review queue (viewer)** — the Quarantine tab says "Viewer role cannot update workspace review state" for a *read* (403 on `GET …/review-queue/quarantine`).
- **BUG-35 · S3 · `/admin/users/:id`** — "Last Login: Never" always shows. The page reads `user.last_login`, but the API field is `last_login_at` (`frontend/src/pages/AdminUserDetailPage.tsx:19,197`). Demo-login never sets `last_login_at` (`backend/app/api/demo.py:80` vs `auth.py:206`).
- **BUG-36 · S3 · `/admin/audit-log` + `/admin` Audit tab** — the action filter lacks the new rows present in the data: `receipt.create/revoke`, `radar.scan/update`, `auth.demo_login`, `document.bulk_*`, `query.compare`, `prompt.*`. The resource filter lacks receipt/radar/prompt. The USER column shows a truncated UUID. `frontend/src/pages/AdminAuditLogPage.tsx:~20-40`, `AdminDashboard.tsx:~100`.
- **BUG-37 · S3 · `/admin/documents`** — after a bulk reindex the row shows "pending" for 30+ s after the server is already ready; there is no polling.
- **BUG-38 · S3 · admin documents** — detail page: "Uploaded by" is blank, and there is no chunk list, tags or quarantine badge ("Chunks are loaded on demand"). List: uploaded-by shows a raw UUID, type shows "FILE" for CSV/MD, names truncate to the same prefix, and the table scrolls horizontally at 1280.
- **BUG-39 · S3 · admin** — user role change to admin and prompt promote/rollback run with no confirmation. Once any prompt is promoted there is no "restore built-in default"; you have to create a copy.
- **BUG-40 · S3 · `/admin/prompts`** — "Diff vs active" shows the whole prompt as Removed + Added instead of a line diff. `$QA/ADM-prompt-diff.png`.
- **BUG-41 · S3 · `/chats`** — abstained queries show an "abstain" model badge. `frontend/src/pages/ChatHistoryPage.tsx:30`.
- **BUG-42 · S3 · `/admin` Evaluation tab** — RAGAS metrics show 0% when no eval has ever run (should be "—").
- **BUG-43 · S3 · `/admin/analytics` Usage** — the cost footnote quotes gpt-4o-mini rates while the model is local qwen3 ($0.0000). `AdminAnalyticsPage.tsx:150`.
- **BUG-44 · S3 · `/api-catalog`** — static and stale: 28 endpoints, a fake "Uptime 99%", and no receipts/radar/demo/source-viewer APIs.
- **BUG-45 · S3 · `/forgot-password`** — "Invalid email format" appears twice (banner and field). The "Send reset link" icon stacks above the label. The success state shows "Back to login" twice. `ForgotPasswordPage.tsx:20,108,169`; `$QA/09-forgot-invalid.png`.
- **BUG-46 · S3 · 404** — copy reads "Use one links below". `frontend/src/pages/NotFoundPage.tsx:32`.
- **BUG-47 · S3 · `/r/<bogus>` and revoked** — status screens have no brand or home link (dead end). `$QA/02-receipt-bogus-375.png`.
- **BUG-48 · S3 · all public pages** — every logged-out page load fires `/api/auth/me` + `/api/auth/refresh`, which produces 2 console 401 errors (90 of the 97 console errors this session).
- **BUG-49 · S3 · theme/shell** — first visit ignores `prefers-color-scheme: dark`. The sidebar collapse state isn't persisted across reload.
- **BUG-50 · S3 · consistency** — the dashboard shows Avg Trust 0.47 (0–1 scale) while the ledger shows 86/100. Cached answers show "1 steps, 0.0 s" and drop the trust sub-scores. Stop shows "after 2 of 4 steps" while in step 3. `AuditTrail.tsx:142`.
- **BUG-51 · S3 · sidebar** — the Review Queue badge stays "1 to review" after "Mark reviewed" (query not invalidated). `frontend/src/components/Layout.tsx:229-230`.
- **BUG-52 · S3 · mobile composer (375)** — the placeholder textarea shows a scrollbar, and the send button floats mid-row. `$QA/R375_workspaces_WS_chat.png`.
- **BUG-53 · S3 · global search** — document results show the raw MIME type "application/vnd.openxmlformats-officedocument…".
- **BUG-54 · S3 · workspace tabs** — Documents/Activity/Members/Settings aren't in the URL; only `?tab=radar` deep-links.
- **BUG-55 · S3 · workspace Settings** — saving an empty name silently does nothing, with no validation message.
- **BUG-56 · S3 · `/settings`** — the password-visibility toggle has no accessible name. A wrong current password triggers 401 → token refresh → retry → 401.
- **BUG-57 · S3 · Usage** — an inverted date range (from > to) silently shows "No usage recorded" with no validation.
- **BUG-58 · S3 · landing** — `<a><button>` nesting (invalid interactive nesting) on Get Started, Launch Workspace and Sign in.
- **BUG-59 · S3 · sidebar Recent** — for admin it lists other users' chats (all workspace queries), but the label implies your own.
- **BUG-60 · S3 · upload** — an identical duplicate file upload is accepted with no warning.
- **BUG-61 · S3 · mobile drawer** — it doesn't trap focus; Tab goes to the header behind the scrim.
- **BUG-62 · S3 · Radar** — dismissed or resolved items can't be reopened from the UI, and there's no undo toast (restored through the API during QA). `$QA/74-radar-dismissed.png`.

## Brief "already seen" items — verdicts
| # | Item | Verdict |
|---|------|---------|
| 1 | streaming `[n]` on own line | **Confirmed** → BUG-4 (also on receipt page) |
| 2 | full doc names in ledger links | **Confirmed** → BUG-8 |
| 3 | two conflict rows both "D" | **Confirmed in code** (literal "D") → BUG-27; only one D per answer appeared this run |
| 4 | PARTIAL score 0.00 | **Confirmed** (0.00/0.02/0.03) → BUG-26 |
| 5 | Demo tour pill covers account row | **Confirmed** → BUG-21 |
| 6 | `/api/health/ready` ~21× burst | **Not reproduced while warm**: 1 call per session, 0 extra over 8 SPA navigations + 15 s idle. `useReady.ts:10-29` polls every 5 s while cold, so ~21 calls over a ~100 s warm-up is expected behaviour, not a remount loop. |
| 7 | "AI Queries —" / "Storage Used —" | **Confirmed** (hard-coded) → BUG-30 |
| 8 | verbose answers / latency | **Confirmed**: 87–234 tokens, 11.3–17.3 s per answer → BUG-24; latency table in report |
