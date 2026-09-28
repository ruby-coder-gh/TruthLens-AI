# QA round 2: verification of the 62 round-1 bugs, plus a full re-sweep

**STATUS: FAIL.** 1 S1 and 6 new S2 bugs are open, and several round-1 S2 bugs are still broken or only partly fixed. See `QA2-new-bugs.md`.

| | |
|---|---|
| Build | `feat/truth-suite-demo` @ `5a210ca` (all 5 fix lanes, plus follow-up G and lane H) |
| App | Already running with a fresh seed. Frontend `:5173`, backend `:8000`, demo workspace `b728acaf-…` (6 docs, CSV = 12 row chunks, 4 planted contradictions, `warm:true`) |
| Date | 2026-09-28 |
| Tooling | Playwright MCP (Chromium), with isolated contexts for the logged-out checks. Personas: demo analyst (owner), demo admin, `viewer2_qa` (viewer) and `editor2_qa` (editor). Both QA users were registered and invited **by email**. The password is kept only in the scratch notes (`scratchpad/qa2-creds.txt`). |
| Viewports | 1280×800 and 375×812 for every route. 768 and 1024 for the drawer and rail. |
| Screenshots | `$QA2` = `/private/tmp/claude-501/-Users-nikunjvaghasiya-SGP-TruthLens-AI--claude-worktrees-user-agent-reach-improve-fd209b/818b146a-b404-4aa6-ab8f-442350d7a541/scratchpad/qa2/` (~200 PNGs). Console logs are in `…/scratchpad/qa2-artifacts/`. |

## Verdict counts (62 round-1 bugs)

| Verdict | Count | IDs |
|---|---|---|
| VERIFIED FIXED | **46** | 1 2 3 4 5 6 9 11 12 13 14 18 19 20 21 23 25 26 27 28 30 31 32 34 35 37 41 42 43 44 45 46 47 48 49 51 52 54 55 56 57 58 59 60 61 62 |
| PARTIAL | **12** | 8 10 15 17 24 29 33 36 38 39 40 50 |
| STILL BROKEN | **3** | 7 16 53 |
| ACCEPTED DEFERRAL | **1** | 22 (the only residual is the accepted "detail-page Regenerate = comparison re-run") |

The other two accepted deferrals are not counted in that row:
- **BUG-16** (synonym gap): the fresh test used plain, non-synonym wording and still missed 0/2, so it is filed as STILL BROKEN.
- **BUG-39** (promote without an extra confirm): that part behaves as accepted, but a non-deferred part is still open, so it is filed as PARTIAL.

## Per-bug verification

| Bug | Sev | Verdict | Evidence / observation |
|---|---|---|---|
| BUG-1 | S1 | VERIFIED FIXED | Seal → warning copy → `POST 201` → link, copy button, QR and "Open receipt". Reopening lists existing receipts with a Revoke button (`DELETE 204`). Logged out, the page shows "Seal intact"; after revoke it shows "Receipt revoked". No render error. `$QA2/41-seal-created.png`, `46-seal-revoked.png`, `47-receipt-revoked-375.png` |
| BUG-2 | S1 | VERIFIED FIXED | The ledger `[2] Annual Report 2025, page 1` link highlights exactly "Revenue in 2025 was €412 million." (sentence-level, not mirrored). `$QA2/50-viewer-C1.png` |
| BUG-3 | S1 | VERIFIED FIXED | Picking a ⌘K result navigates, the dialog and scrim are gone, and the sidebar is clickable afterwards. `$QA2/72-search-after-pick.png` |
| BUG-4 | S2 | VERIFIED FIXED | While streaming, "…Sustainability Report ¹. However…" stays inline, and the scan found 0 orphan paragraphs across 3 answers. The receipt page is inline too, though it leaves a space before the superscript. `$QA2/62-emissions-stream-2.png`, `43-receipt-public-375.png` |
| BUG-5 | S2 | VERIFIED FIXED | A conflict D-row now appears for all 4 planted questions, even when only one side is cited. The rows are noisy, though: they include unrelated conflicts and wrong figures (new **R2-3**). `$QA2/22-q1-ledger-2.png` |
| BUG-6 | S2 | VERIFIED FIXED | A failed guardrail now reads "Guardrail failed" with a red shield, and "Answer verified" appears only on passing answers (risks, capacity). `$QA2/22-q1-ledger-0.png` |
| BUG-7 | S2 | **STILL BROKEN** | "Which projects in the pipeline are currently under construction?" still abstains ("best evidence score 0.09, searched 5 chunks across 4 documents", 5.7 s). The CSV now has 12 row chunks (`name: Aurora; …; status: construction`), but they are never retrieved. `$QA2/61-pipeline-done.png` |
| BUG-8 | S2 | PARTIAL | Short titles now appear everywhere ("Annual Report 2025"), and 375 px no longer truncates everything to "Northwind Renewables — 20…". Two gaps remain: live answers still omit the page number on several cited PDF exhibits (revenue [3]; Aurora [1]–[3]), while the stored view shows them, and the press release shortens to the verb-first "Reports Fourth-Quarter and Full-Year 2025 Results". `$QA2/21-q1-done.png`, `61-aurora-done.png` |
| BUG-9 | S2 | VERIFIED FIXED | `[n]` markers everywhere: Copy, client Export, backend `/api/queries/{id}/export`, Review-queue card, ⌘K snippet, comparison original and rerun, and golden prefill. The only `[source:N]` left is in the investigation reasoning trace (see BUG-10). |
| BUG-10 | S2 | PARTIAL | A real background job with live "N of 6 steps complete · X s elapsed" progress, taking **135.3 s** (was 241.8 s). The executive report renders its markdown. The reasoning-trace sub-answers still show raw `**…**` and `[source:2][source:4]` (8 `**` and 38 `[source:N]` on the page), because `frontend/src/components/ReasoningTimeline.tsx:191` renders `partial_answer` as plain text. `$QA2/121-investigate-progress.png`, `122-investigate-done.png` |
| BUG-11 | S2 | VERIFIED FIXED | The page shows server values (VeritasRAG, 50 MB, 0.70/0.40). `PUT {max_upload_size_mb:51}` and `{0.75,0.4}` return 200, and the values persist after reload. Both were reverted. |
| BUG-12 | S2 | VERIFIED FIXED | Delete now opens a confirm dialog, and the sidebar Recent list updates live (3 → 2 entries). `$QA2/70-delete-confirm.png` |
| BUG-13 | S2 | VERIFIED FIXED | ⌘K focuses the search input, and Esc closes the dialog. |
| BUG-14 | S2 | VERIFIED FIXED | The viewer sees no Upload button, drop zone or file input. `$QA2/200-viewer-docs.png` |
| BUG-15 | S2 | PARTIAL | Invite by email works: an unknown address gets "No user with that email" (404), and viewer and editor added by email return 201. The member menu has "Remove member", but there is still **no role-change control**, and the menu doesn't close on Esc (R2-9). `$QA2/82-invite-unknown.png`, `84-member-menu.png` |
| BUG-16 | S2 | **STILL BROKEN** | Uploaded a note: "closed the year 2025 with 1,580 employees" (Annual Report says 1,240) and "Kestrel Ridge… commissioned in November 2024" (Annual Report says March 2024). The auto-scan (1 chunk, 4 pairs) found 0, and a full scan (27 chunks, 89 pairs) found 0 new. The wording is not a synonym case, so this goes beyond the accepted residual. `$QA2/100-upload-note.png` |
| BUG-17 | S2 | PARTIAL | Ledger PDF evidence is now sentence-level (C1 contract works). Three paths still highlight the whole chunk or page: Radar "View in document" (`RadarPanel.tsx:116-123` passes no `highlightText`), every DOCX/MD text-mode view (backend `api/documents.py:622-643` ignores `text`), and the D-row "Compare the pages" (uses the claim text). `$QA2/91-radar-view-docx.png`, `92-radar-view-pdf-398.png`, `51-compare-D3.png` |
| BUG-18 | S2 | VERIFIED FIXED | Create, Edit (PUT 200), Documents → Add/Remove (PUT 200 / DELETE 204) and Delete with confirm (204) all work. An empty name is blocked by the native `required` check. `$QA2/171-collection-created.png`, `172-collection-docs.png` |
| BUG-19 | S3 | VERIFIED FIXED | "Total Chunks Indexed 27". `$QA2/A_admin-1280.png` |
| BUG-20 | S2 | VERIFIED FIXED | Step 2 now reads "Review the Claim Ledger's claims and verdicts", and step 4 (seal) works. `$QA2/130-tour-open.png` |
| BUG-21 | S2 | VERIFIED FIXED | The pill moved to the top right, and the account row is fully visible. The new position occludes header actions, which is filed as **R2-2**. |
| BUG-22 | S2 | ACCEPTED DEFERRAL | The stored page matches live: same ledger, tally chips, Conflict tags and full action bar (Seal, Copy, Export, 👍/👎, Regenerate). Regenerate there runs the comparison re-run, as accepted. The legacy "Chat Detail" header remains (cosmetic). `$QA2/30-stored-q1.png` |
| BUG-23 | S2 | VERIFIED FIXED | The admin upload accepts `.pdf,.docx,.txt,.md,.csv,.json`, and CSV + JSON + TXT each return 202. JSON then fails ingestion (new **R2-5**). |
| BUG-24 | S2 | PARTIAL | Emissions, CEO, Aurora and 2 later revenue runs state both figures. The **first revenue answer still picks a side**: "…appears to be an error… Therefore, the correct revenue figure is €412 million". That is 1 of 6 conflict answers. `$QA2/22-q1-ledger-1.png` |
| BUG-25 | S2 | VERIFIED FIXED | At 375, `/workspaces` and `/documents` cards fit and names truncate. `$QA2/R_workspaces-375.png`, `R_documents-375.png` |
| BUG-26 | S2 | VERIFIED FIXED | PARTIAL rows no longer show a misleading 0.00; the score is hidden. |
| BUG-27 | S3 | VERIFIED FIXED | Rows are labelled D1/D2/D3. |
| BUG-28 | S3 | VERIFIED FIXED | The score bar for 1.00 renders a green fill. |
| BUG-29 | S3 | PARTIAL | A unit is now always shown, but it is attached to wrong numbers: "Difference 2,025 pts" (`,` vs `2025`), "3 pts" (2022 vs 2025) and "2,020.2 pts". The real €14M and 7-point gaps never appear (R2-3). |
| BUG-30 | S3 | VERIFIED FIXED | Shows "AI Queries 10" and "Storage 450.5 KB", and the counts refresh after an upload (6 → 7) and a member add (2 → 4). |
| BUG-31 | S3 | VERIFIED FIXED | Regenerate appears on every live answer and reran with fresh retrieval (10.7 s). |
| BUG-32 | S3 | VERIFIED FIXED | The question avatar and the sidebar both show "DA". |
| BUG-33 | S3 | PARTIAL | Esc closes the tour and it can be reopened. Two gaps remain: the panel **stays open after "Go"** and covers the stat cards (`$QA2/131-tour-after-go.png`), and it still shows for the non-demo `viewer2_qa` and `editor2_qa`, because `isDemoAccount` treats every `@truthlens.dev` email as a demo account (`DemoTour.tsx:23-25`). |
| BUG-34 | S3 | VERIFIED FIXED | The viewer's Quarantine tab shows "No quarantined content" with no 403. |
| BUG-35 | S3 | VERIFIED FIXED | Last login shows on the users list and detail page (demo_analyst 05:34). New side issue **R2-11**. |
| BUG-36 | S3 | PARTIAL | The action and resource filters now include receipt/radar/prompt/demo/bulk/compare. The USER column still shows a truncated UUID ("6b791f59-f13…"). |
| BUG-37 | S3 | VERIFIED FIXED | After a reindex the row polls pending → ready in about 4 s without a reload. |
| BUG-38 | S3 | PARTIAL | Fixed: type labels TXT/CSV/MD/DOCX/JSON, a chunk list on the detail page, and tags. Still open: **"Uploaded by" shows a raw UUID** on the list and the detail page, and the list table still scrolls horizontally at 1280 (1022/972). The processing timeline is all grey (R2-10). `$QA2/A_admin_documents-1280.png` |
| BUG-39 | S3 | PARTIAL | Now confirmed: detail-page role change ("Change role"), Rollback, Delete, and the new "Restore built-in default". Promote without an extra confirm is the accepted deferral. **Still open:** the `/admin/users` list's inline role select promoted viewer2 to **admin instantly with no confirm**, and list Deactivate is instant (`AdminUsersPage.tsx:184`). Both were reverted. |
| BUG-40 | S3 | PARTIAL | The diff is now line-based. The built-in prompt is a single line, so adding one line still shows the entire prompt as Removed plus identical Added. The symptom persists for the real prompt. `$QA2/191-prompt-diff.png` |
| BUG-41 | S3 | VERIFIED FIXED | `/chats` shows an "Abstained" badge. The dashboard still prints "abstain" as the model name (R2-13). |
| BUG-42 | S3 | VERIFIED FIXED | Shows "No evaluation data" and "—". |
| BUG-43 | S3 | VERIFIED FIXED | Footnote: "Local models have no API cost — no pricing is configured". |
| BUG-44 | S3 | VERIFIED FIXED | Lists 117 HTTP endpoints + 2 WS, including receipts, radar and demo, with no uptime figure. The static pipeline latencies remain (R2-19). |
| BUG-45 | S3 | VERIFIED FIXED | One "Invalid email format", the icon sits inline, and the success state shows one "Back to login". `$QA2/B45-*.png` |
| BUG-46 | S3 | VERIFIED FIXED | Now reads "Use one of the links below". |
| BUG-47 | S3 | VERIFIED FIXED | The bogus and revoked receipt screens both show the brand and "Go to TruthLens home". `$QA2/pub_r_bogus-token-123-375.png`, `47-receipt-revoked-375.png` |
| BUG-48 | S3 | VERIFIED FIXED | 15 public routes × 2 widths made zero `/auth/me` or `/auth/refresh` calls. There was one 401 pair, only while a stale session hint was present. |
| BUG-49 | S3 | VERIFIED FIXED | `prefers-color-scheme: dark` on a first visit gives `data-theme=dark`, and sidebar collapse survives a reload. `$QA2/B49-dark-first-visit.png` |
| BUG-50 | S3 | PARTIAL | Fixed: the dashboard shows 60/100, history shows /100, a cached answer (160 ms) keeps its trust components, and Stop reads "Stopped during step 3 of 4". Still open: the **`/admin` "Avg Trust Score 0.49 Poor"** is on a 0–1 scale, which violates C8 (`AdminDashboard.tsx:1164-1167`). The cached audit trail says "4 steps, 0.0 s" with empty step details. |
| BUG-51 | S3 | VERIFIED FIXED | The "1 to review" badge clears after Mark reviewed. |
| BUG-52 | S3 | VERIFIED FIXED | At 375 the composer has no scrollbar and the send button is aligned. `$QA2/R_WS_chat-375.png` |
| BUG-53 | S3 | **STILL BROKEN** | ⌘K "Memorandum" shows "Board Memorandum…docx · application/vnd.openxmlformats-officedocument.wordprocessingml.document · ready". `GlobalSearch.tsx:15-23` only maps a snippet that is a bare MIME type, but `backend/app/api/search.py:102` sends "filename · mime · status". |
| BUG-54 | S3 | VERIFIED FIXED | `?tab=activity|radar|members|settings|documents` deep-links work. |
| BUG-55 | S3 | VERIFIED FIXED | An empty name shows the toast "Workspace name is required". `$QA2/85-ws-settings-empty.png` |
| BUG-56 | S3 | VERIFIED FIXED | The toggle is labelled "Show passwords". A wrong current password gives a single 401 (no refresh retry) and "Current password is incorrect". |
| BUG-57 | S3 | VERIFIED FIXED | Reversed dates show 'The "From" date is after the "To" date — pick a valid range.' |
| BUG-58 | S3 | VERIFIED FIXED | 0 `a button` / `button a` nestings on the landing page. |
| BUG-59 | S3 | VERIFIED FIXED | The sidebar Recent list uses `mine=true` (admin sees "No chats yet"). `/chats` still lists every member's chats (see R2-1). |
| BUG-60 | S3 | VERIFIED FIXED | A duplicate upload returns 409 with the toast "An identical file is already uploaded as …". `$QA2/101-duplicate-upload.png` |
| BUG-61 | S3 | VERIFIED FIXED | The 375 drawer traps focus: 22 Tabs stayed inside `#app-sidebar`, and Esc closes it. |
| BUG-62 | S3 | VERIFIED FIXED | Dismissed and Resolved items have a Reopen button, and the counts go back to 4/0/0. There is no undo toast, by design (see the code comment). `$QA2/94-radar-dismissed-view.png` |

## Route × result (1280 and 375)

✓ means it renders, has no horizontal page scroll, no page error, and no unexpected 4xx/5xx. **FAIL** means an S1 or S2 bug is open on that route.

| # | Route | 1280 | 375 | Result | Notes |
|---|---|---|---|---|---|
| 1 | `/` | ✓ | ✓ | PASS | No nested a/button. No auth calls. |
| 2 | `/login` | ✓ | ✓ | PASS | One-click Analyst lands in the chat in 1.0 s; Admin lands on `/admin` in 1.7 s. |
| 3 | `/signup` | ✓ | ✓ | PASS | |
| 4 | `/register` | ✓ | ✓ | PASS | Registration returns 201, or 409 for a duplicate. |
| 5 | `/forgot-password` | ✓ | ✓ | PASS | BUG-45 fixed. |
| 6 | `/reset-password` (no token) | ✓ | ✓ | PASS | |
| 7 | `/reset-password?token=bogus` | ✓ | ✓ | PASS | |
| 8–10 | `/privacy`, `/terms`, `/contact` | ✓ | ✓ | PASS | |
| 11 | `/r/<valid>` (logged out) | ✓ | ✓ | PASS | "Seal intact". Print CSS OK. `window.print` called once. The receipt omits conflict rows (R2-16). |
| 12 | `/r/<revoked>` | ✓ | ✓ | PASS | Returns 410 and shows "Receipt revoked" with brand and home link. |
| 13 | `/r/<bogus>` | ✓ | ✓ | PASS | 404 "Receipt not found". |
| 14 | `/nonexistent` | ✓ | ✓ | PASS | |
| 15 | logged-out → `/dashboard`, `/admin`, `/admin/settings` | ✓ | ✓ | PASS | Redirects to `/login`. |
| 16 | `/dashboard` | ✓ | ✓ | PASS | 60/100. Shows "abstain" as the model name (R2-13). |
| 17 | `/workspace` → `/workspaces` | ✓ | ✓ | PASS | |
| 18 | `/chat` → `/chat/new` | ✓ | ✓ | PASS | |
| 19 | `/chat/new` | ✓ | ✓ | PASS | |
| 20 | `/chats` | ✓ | ✓ | **FAIL** | A viewer sees every member's chats with Delete, and the delete succeeds (R2-1, S1). |
| 21 | `/chat/:queryId` | ✓ | ✓ | **FAIL** | Ledger D-rows are wrong (R2-3). At 375 the pill covers "Back to history" (R2-2). |
| 22 | `/workspaces/:id/queries/:queryId` | ✓ | ✓ | **FAIL** | Same page as row 21. |
| 23 | `/documents` | ✓ | ✓ | PASS | BUG-25 fixed. |
| 24 | `/settings` | ✓ | ✓ | PASS | BUG-56 fixed. |
| 25 | `/workspaces` | ✓ | ✓ | PASS | |
| 26 | `/workspaces/:id` (Documents) | ✓ | ✓ | PASS* | Viewer upload hidden. Duplicate upload returns 409. The tab bar scrolls inside itself at 375. |
| 27 | `…?tab=activity` | ✓ | ✓ | PASS | |
| 28 | `…?tab=radar` | ✓ | ✓ | **FAIL** | 4/4 planted found, 0 false positives, full scan in about 3 s, Reopen works. The fresh conflicting upload scored 0/2 (BUG-16), and View A/B highlights the whole chunk (BUG-17). |
| 29 | `…?tab=members` | ✓ | ✓ | PASS* | Invite by email works. No role change control, and the menu doesn't close on Esc (R2-9). |
| 30 | `…?tab=settings` | ✓ | ✓ | PASS | Owner only. Editor sees "Only the workspace owner…". |
| 31 | `/workspaces/:id/documents/:docId` | ✓ | ✓ | PASS | |
| 32 | `…?chunk=` | ✓ | ✓ | PASS | Opens the viewer on the right doc and page with a chunk-level mark, which is expected with no claim. |
| 33 | `/workspaces/:id/review-queue` (+ Quarantine) | ✓ | ✓ | **FAIL** | A viewer is offered Mark reviewed / Dismiss / Promote, which return a silent 403 (R2-6). |
| 34 | `/workspaces/:id/chat` | ✓ | ✓ | **FAIL** | R2-3, R2-4, BUG-7, BUG-24 (partial). Stop, Retry, Regenerate, Copy, Export and 👍 work. |
| 35 | `/workspaces/:id/investigate` | ✓ | ✓ | **FAIL** | Background job with progress (135 s). The report says there are no conflicts (R2-7). The trace shows raw markdown (BUG-10). |
| 36 | `/workspaces/:id/investigate/:caseId` (new route) | ✓ | – | PASS* | Deep link loads the case file. Exports carry Content-Disposition (zip). |
| 37 | `/api-catalog` | ✓ | ✓ | PASS | Non-admin users are redirected to `/dashboard`. |
| 38 | `/admin` (+ Audit / Evaluation tabs) | ✓ | ✓ | **FAIL** | The pill fully covers **Refresh** (R2-2). Avg trust is on the 0–1 scale (BUG-50). |
| 39 | `/admin/documents` | ✓ | ✓ | **FAIL** | The pill covers Upload Document (R2-2). Uploader shows a UUID (BUG-38). Tag, filter and reindex polling all work. |
| 40 | `/admin/documents/upload` | ✓ | ✓ | **FAIL** | JSON is accepted, then fails ingestion, while the page shows "Complete" (R2-5). |
| 41 | `/admin/documents/:docId` (+ bogus id) | ✓ | ✓ | PASS* | Chunks are listed. Timeline is all grey (R2-10). A bogus id shows "Document not found" with Retry. |
| 42 | `/admin/collections` | ✓ | ✓ | **FAIL** | The pill fully covers **New Collection**. At 375 on the empty state there is no other create path (R2-2). The CRUD itself works. |
| 43 | `/admin/users` | ✓ | ✓ | **FAIL** | The pill covers Invite User (R2-2). The inline role select promotes to admin with no confirm (BUG-39). |
| 44 | `/admin/users/invite` | ✓ | ✓ | PASS | Invalid email shows both the native and the custom message. |
| 45 | `/admin/users/:userId` (+ bogus) | ✓ | ✓ | PASS* | Role change is confirmed. Last login then flips to "Never" (R2-11). A bogus id gives two expected 404s. |
| 46 | `/admin/settings` | ✓ | ✓ | PASS | Values persist. Shows "VeritasRAG" (R2-14). |
| 47 | `/admin/analytics` (Overview / RAGAS / Usage & Cost) | ✓ | ✓ | **FAIL** | The pill covers Run Evaluation / Refresh Data (R2-2). Date validation and group-by work. CSV has Content-Disposition. No `abstain` model row. |
| 48 | `/admin/audit-log` | ✓ | ✓ | PASS* | Filters work. The USER column shows a UUID (BUG-36). CSV and JSON exports have Content-Disposition. |
| 49 | `/admin/prompts` | ✓ | ✓ | **FAIL** | The pill fully covers **New draft**. The full cycle works: draft → diff → smoke eval (11 s, pass) → promote → Restore built-in default → Rollback confirm → Delete. |
| 50 | `/admin/golden` | ✓ | ✓ | PASS | The pending entry from the analyst was approvable and deleted with a confirm. The workspace column shows a UUID (R2-18). |
| 51 | analyst or viewer → `/admin`, `/admin/users`, `/api-catalog` | ✓ | ✓ | PASS | Redirects to `/dashboard`. |

- **Breakpoints:** at 768 the drawer appears (menu button, drawer off-canvas); at 1024 the 64 px rail appears. No horizontal scroll at either.
- **Dark theme:** ledger, radar, dashboard and case file are readable. `$QA2/230-dark-*.png`
- **Role gating (server):** the viewer is correctly denied on upload, scan, radar, receipts and review, with one exception: the viewer **can delete other members' queries** (R2-1).

## Feature deep checks

| Area | Result |
|---|---|
| Demo pack | "Try the live demo" and one-click personas OK. Suggested questions send. Tour steps and "Go" links work, but Go leaves the panel open (BUG-33). |
| Claim Ledger | The audit trail runs live and then collapses. Answers stream inline. The ledger/prose toggle persists. Expand, cross-links, exhibits and trust totals work. Seal, Copy, Export, 👍 (201, no pressed state) and Regenerate work. Stop → "Stopped during step 3 of 4" → Retry (7.7 s) works. The abstention card shows for off-corpus questions (4.9 s). Conflict D-rows are broken (R2-3). |
| Source viewer | PDF sentence highlight is correct from the ledger. Esc closes it and returns focus to the trigger. Radar, DOCX, MD and "Compare the pages" still highlight the whole chunk (BUG-17). |
| Truth Receipt | Create, copy, QR, logged-out "Seal intact", print CSS, revoke → 410 and bogus → 404 all work. A viewer is offered Seal and gets the wrong error copy (R2-6). |
| Contradiction Radar | 4/4 planted found, 0 false positives, diff highlight works, dismiss/resolve/reopen and counts are correct, full scan takes about 3 s, and the viewer gets no actions. A fresh upload scored 0/2 (BUG-16). |
| Regression | Review queue and quarantine OK. Investigations and comparisons OK (no markers). Prompts, analytics, usage, audit export, bulk tag/reindex/delete, upload, golden, settings, password change and logout (Back stays on `/login`) all OK. |

## Planted-contradiction recall

| Conflict | Radar | Chat ledger (live) | Answer text |
|---|---|---|---|
| Revenue €412M vs €398M | ✓ | ✓ D3 (press release ↔ AR), but figures show "`,` vs 2025 · 2,025 pts". 2 unrelated D-rows also attached. | 1st run **picks a side** (BUG-24). Later runs state both. |
| Emissions −34% vs −41% | ✓ | ✓ D1 (C2 vs C1), but **no figure table** (the unit mismatch comes from extracting "2025"). 2 unrelated D-rows also attached. | States both ✓ |
| Aurora Q3 2027 vs Q1 2028 | ✓ | ✓ D1 (press release ↔ Board memo). The revenue conflict is also attached. | States both ✓ |
| CEO Mar 2021 vs Jan 2022 | ✓ | ✓ D2 (C1 vs C2), with no figures. 2 unrelated D-rows also attached. | States both ✓. The both-sides claim is graded CONTRADICTED (R2-4). |
| Fresh upload (employees, Kestrel) | ✗ 0/2 | – | – |

- **Radar:** 4/4 recall with 0 false positives.
- **Chat recall:** 4/4, but precision is only **4 relevant of 11 D-rows (~36%)**, and the non-conflict capacity question also shows 3 conflict rows.
- **Investigation:** "identify conflicts" found **0/4** (R2-7).

## Per-question latency

Local qwen3:4b-instruct, one question at a time, measured from click to the "N steps, X s" label.

| Question | First prose | Done (UI) | Tally | Trust |
|---|---|---|---|---|
| Revenue 2025 (first answer) | – | **18.0 s** | 1 verified · 2 partial · 1 unsupported · 3 conflict | 58 |
| Aurora commissioning | – | 18.5 s | 1 verified · 1 partial · 1 unsupported · 1 contradicted · 2 conflict | 50 |
| Pipeline under construction | – | abstained 5.7 s | – | 0 |
| Emissions vs 2020 | ~9.1 s | 15.0 s | 2 verified · 2 partial · 1 unsupported · 3 conflict | 59 |
| CEO + start date | ~8.7 s | 13.5 s | 1 verified · 1 partial · 1 unsupported · 2 contradicted · 3 conflict | 50 |
| Key Aurora risks | – | 24.7 s | 5 verified · 4 partial ("Answer verified") | 72 |
| Off-corpus (capital of Australia) | – | abstained 4.9 s | – | 0 |
| Installed capacity, after Stop → Retry | – | 7.7 s | 1 verified · 1 partial · 3 conflict (false) | 77 |
| Regenerate (capacity) | – | 10.7 s | – | – |
| Revenue re-ask after the doc set changed | – | 15.1 s | 1 verified · 1 partial · 2 unsupported | 53 |
| Revenue repeat (cache hit) | – | 160 ms (UI "Cached 32ms") | trust components kept | 53 |
| Re-run comparison (revenue) | – | ≈3 s | 58 → 47 | – |
| **Investigation** "Compare key findings / identify conflicts" (6 steps) | – | **135.3 s** (`latency_ms` 135317; was 241.8 s) | – | 41 |
| Prompt smoke eval | – | ≈11 s | pass | – |

## Console / network

- **5xx:** none.
- **Render or page errors:** none. Route sweeps captured `pageerror` and got 0.
- **Expected 4xx:**
  - 404s from the bogus-id checks.
  - 409s from a duplicate register and a duplicate upload.
  - 401 from the wrong-password check.
  - 403s on viewer writes (review PATCH, receipt POST).
  - 401 bursts from my own raw `fetch` polling after the access token expired. These are not app bugs; the app's own client refreshed correctly.
- **Warnings:** only React Router v7 future-flag warnings.
- **Downloads with Content-Disposition:** usage CSV, audit CSV and JSON, investigation zip, and query `.md` export.

## Side effects / cleanup

- **Deleted** (admin bulk delete with confirm): QA uploads `QA2 Workforce Note.txt`, `qa2-admin.txt`, `qa2-facts.json`, `qa2-assets.csv`. The workspace is back to **6 docs**.
- **Radar:** back to **4 open / 0 / 0**.
- **Reverted or removed:**
  - The test receipt was revoked.
  - The QA collection was deleted.
  - The QA golden entry was deleted.
  - Prompt v1 was restored to the built-in default and deleted, so there are **no prompt versions**.
  - Admin settings were reverted to 50 MB and 0.70/0.40.
  - viewer2 was demoted back to user.
  - editor2 was re-activated.
- **Left in place, as in round 1:**
  - Users `viewer2_qa` (viewer member) and `editor2_qa` (editor member).
  - About 11 analyst queries, one of which was deleted by the viewer during the R2-1 test.
  - 1 comparison and 1 investigation case file.
  - The CEO query's review status is set to reviewed.
- **Browser:** closed. Temporary login scripts were removed from `.playwright-mcp/`, and the console logs were moved to `scratchpad/qa2-artifacts/`.
