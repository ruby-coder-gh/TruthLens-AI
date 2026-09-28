# QA round 2: new and regression bugs (branch `feat/truth-suite-demo` @ `5a210ca`, demo mode, fresh seed)

- **Date:** 2026-09-28.
- **Tester:** QA lead, Playwright MCP.
- **Screenshots:** `$QA2` = `/private/tmp/claude-501/-Users-nikunjvaghasiya-SGP-TruthLens-AI--claude-worktrees-user-agent-reach-improve-fd209b/818b146a-b404-4aa6-ab8f-442350d7a541/scratchpad/qa2/`.
- **Paths:** relative to the worktree root.
- **Format:** `BUG-R2-n · Sev · page · steps · expected vs actual · evidence · suspected file:line`.
- **Scope:** round-1 bugs that are still open or only partly fixed are **not** repeated here. They are marked STILL BROKEN or PARTIAL in `QA2-verification.md` (BUG-7, 8, 10, 15, 16, 17, 24, 29, 33, 36, 38, 39, 40, 50, 53).

**Totals: 21 new bugs: S1 1 · S2 6 · S3 14.**

## S1

**BUG-R2-1 · S1 · `/chats` (+ API) · a viewer can permanently delete any workspace member's chats**
- **Steps:**
  1. Owner (demo analyst) asks questions.
  2. Invite `viewer2_qa` as **Viewer** and log in as viewer2.
  3. Open `/chats`.
- **Expected:** the viewer sees only their own history, or at least can't delete other people's queries (viewer is a read role, and every other viewer write returns 403).
- **Actual:**
  - `/chats` lists all 10 of the analyst's chats, each with a **Delete** button.
  - Delete → confirm sent `DELETE /api/workspaces/{ws}/queries/d0bb3e26-…` and got **204**. The analyst's chat and its answer are gone.
  - No audit row is written (`query.delete` isn't an audit action).
  - The page is labelled "Chat History", which implies your own chats.
- **Evidence:** network `204 DELETE …/queries/d0bb3e26-b9c0-4ae5-92fc-b3bf91d7426e` made as viewer2. Chat History for viewer2 lists the analyst's queries while their sidebar Recent says "No chats yet". (This was flagged "out of scope" in `progress.md` and is still open.)
- **Suspected cause:**
  - `backend/app/api/queries.py:390-403`: `delete_query` only depends on `check_workspace_access`, with no owner or role check.
  - `frontend/src/pages/ChatHistoryPage.tsx:35`: Delete is rendered for every row.

## S2

**BUG-R2-2 · S2 · every admin page + chat detail (demo personas) · the "Demo tour" pill covers header action buttons**
- **Steps:** log in with one-click Admin (or Analyst). Open `/admin`, `/admin/documents`, `/admin/collections`, `/admin/users`, `/admin/analytics` and `/admin/prompts` at 1280 and 375.
- **Expected:** the floating tour pill never covers a control.
- **Actual:** the pill (`fixed right-4 top-[4.5rem] z-40`) sits on the page-header action row. A hit-test sweep (elementFromPoint on each control) found:
  - **Fully covered:** Refresh (`/admin`), Invite User (`/admin/users`), New draft (`/admin/prompts`), and New Collection at 375.
  - **Partly covered:** Upload Document, New Collection at 1280, Run Evaluation, and Refresh Data.
  - At 375 on an empty `/admin/collections`, **there is no other way to create a collection with a pointer**.
  - It also covers "Back to history" on `/chat/:id` at 375, and ledger text and row chevrons while scrolling.
- **Evidence:**
  - Playwright: `<button aria-controls="demo-tour-panel"> … intercepts pointer events` when clicking "New Collection" and "New draft".
  - Hit-test: New Collection btn `[1126,80,130×28]` vs pill `[1131,72,133×34]`.
  - Screenshots: `$QA2/170-collections-pill-blocks-create.png`, `A_admin_documents-1280.png`, `A_admin_collections-375.png`, `R_WS_queries_…-375.png`.
- **Suspected cause:** `frontend/src/components/DemoTour.tsx:169` (position). Round-1 BUG-21 moved the pill from bottom-left to top-right, straight into the header action column. Suggested fixes: dock it in the top bar, or offset it below the page header.

**BUG-R2-3 · S2 · chat ledger (live + stored) · conflict D-rows list unrelated conflicts, show nonsense figures, and "Compare the pages" highlights the whole page**
- **Steps:** ask the revenue question, or any question whose answer cites Annual Report page 1, such as "What installed capacity did Northwind report at the end of 2025?".
- **Expected:**
  - Only the contradiction that is relevant to the claims appears. For revenue that is one D-row: €412M (AR) vs €398M (press release), "Difference €14M".
  - "Compare the pages" highlights the two conflicting sentences.
- **Actual:**
  1. **Every open radar contradiction that touches any cited chunk is attached.**
     - The revenue answer shows 3 conflicts: D1 AR↔Sustainability (the emissions conflict), D2 Leadership↔AR (the CEO conflict), and D3 press release↔AR (revenue).
     - C1 "revenue was €412 million" is chipped "Differs from Leadership Team".
     - The installed-capacity answer, which has no conflict, also shows "3 conflict".
     - Across the 4 planted questions, only 4 of 11 D-rows are relevant.
  2. **Figures come from the first number in the claim text**, not from the conflicting radar sentences:
     - D3 "Reports … Results `,` / Annual Report 2025 `2025` / Difference **2,025 pts**"
     - D2 "Leadership Team 2022 / Annual Report 2025 / **3 pts**"
     - Capacity: "2022 vs 1.8 → **2,020.2 pts**"
     - Emissions (41% vs 34%) shows **no** figure table at all, because the units differ after "2025" is extracted.
  3. "Compare the pages" locates by the claim text (e.g. "Given that the Annual Report is a primary source…"), which is not in the PDF, so the viewer falls back to highlighting the whole page. It also opens only one side.
- **Evidence:** `$QA2/22-q1-ledger-1.png`, `22-q1-ledger-2.png`, `64-ceo-Drows.png`, `51-compare-D3.png`, `222-Drow-375.png`; `/locate?text=Given that the Annual Report is a primary source…`.
- **Suspected cause:**
  - `frontend/src/components/ledger/conflicts.ts:20-31`: `pairClaimConflicts` keys on page-sized `chunk_id`s, so every contradiction in AR p.1 matches.
  - `conflicts.ts:66`: `FIGURE_RE` `[\d,]+` matches a lone "," and years.
  - `frontend/src/components/ledger/ClaimLedger.tsx:250-252`: uses `claim.text` before `contradiction.a/b.sentence`.
  - `ClaimLedger.tsx:266`: `highlightText: textA` is the claim, not the source sentence.
  - Suggested fix: pair on the radar sentence appearing in the claim's evidence/sentence window, and diff the radar sentences.

**BUG-R2-4 · S2 · chat ledger / guardrail · every planted-conflict answer ends "Guardrail failed" because the honest "sources disagree" sentences are graded UNSUPPORTED or CONTRADICTED**
- **Steps:** ask the emissions, CEO, Aurora and revenue questions.
- **Expected:** after BUG-24 the prompt tells the model to state both figures and say the sources disagree. That correct, both-sides answer should verify, or at least not be marked as a failure.
- **Actual:**
  - All 4 conflict answers show a red "Guardrail failed" with trust 50–59 (faithfulness 7–30).
  - The meta or hedge claims are what fail:
    - CEO C5 "…either March 2021 or January 2022, with the sources disagreeing" → **CONTRADICTED 0.00**
    - Aurora C3 "Thus, there is a discrepancy: the official reports state Q3 2027, while the internal board memorandum states Q1 2028" → **CONTRADICTED 0.00**
    - "The sources disagree on the exact reduction" and "The two sources disagree on the exact start date" → **UNSUPPORTED 0.00**
  - All of these also land in the review queue. The product flags its most honest answers as failed.
- **Evidence:** `$QA2/63-ceo-done.png`, `63-emissions-done.png`, `61-aurora-done.png`, `64-ceo-Drows.png`.
- **Suspected cause:** `backend/app/generation/guardrail.py:132-139` (`_verdict`), together with claim extraction (`:85-106`). Each claim is checked against one premise, and multi-source or meta "sources disagree" sentences have no single entailing premise. Suggested fixes: exempt or recognise disagreement statements that are backed by an open radar contradiction, or verify them against both premises.

**BUG-R2-5 · S2 · `/admin/documents/upload` (and workspace upload) · JSON files are accepted and reported "Complete", then fail ingestion**
- **Steps:** on `/admin/documents/upload`, pick `qa2-facts.json` (valid JSON) → Upload.
- **Expected:** it indexes like the other formats, which the UI and `/documents` copy advertise ("PDF, DOCX, TXT, MD, CSV, JSON").
- **Actual:**
  - POST returns 202 and the upload page says **"Complete"**.
  - `/admin/documents` then shows `qa2-facts.json · JSON · failed · 0 chunks`, and the detail API returns `status: failed` with no error message.
  - The CSV and TXT files from the same batch succeed.
- **Evidence:** `$QA2/161-admin-upload-done.png`; row `qa2-facts.json JSON failed 0 71 B`.
- **Suspected cause:**
  - `backend/app/ingestion/loader.py:35-46`: there's no `application/json` branch, so it raises "Unsupported mime type".
  - `backend/app/api/documents.py:62,120`: JSON is allowed at upload.
  - The BUG-23 fix exposed this. The upload page also shows "Complete" for a failed document.

**BUG-R2-6 · S2 · review queue + chat (viewer role) · viewers are offered editor-only actions that fail silently or with the wrong message**
- **Steps:** log in as viewer2 (Viewer member). Open `/workspaces/:id/review-queue` → click **Mark reviewed**. Open a stored answer → **Seal receipt** → Create.
- **Expected:** the actions are hidden or disabled for viewers, as the Upload fix (BUG-14) does. If an action is attempted anyway, a clear message is shown.
- **Actual:**
  - The review queue shows Mark reviewed, Dismiss, Promote to golden set and Re-run query. Mark reviewed → `PATCH … 403` with **no toast and no inline error**; the card just stays.
  - Seal receipt is offered. Create returns `403` and the dialog says **"Viewer role cannot update workspace review state"**, which is the wrong feature.
- **Evidence:** network `403 PATCH …/review-queue/2f2f9efa-…` and `403 POST /api/queries/{id}/receipts`; dialog text.
- **Suspected cause:**
  - `frontend/src/pages/ReviewQueuePage.tsx:359-376` uses `try/finally` with no `catch`, so the rejection is unhandled, and the buttons around `:582` are not gated by role.
  - `frontend/src/components/SealReceiptButton.tsx` has no role gate.
  - `backend/app/core/deps.py:230`: the generic message is reused by `backend/app/api/receipts.py:74`.

**BUG-R2-7 · S2 · `/workspaces/:id/investigate` · the "identify conflicts" case file says there are no conflicts and endorses one side**
- **Steps:** Investigation → suggested prompt "Compare the key findings across these documents and identify conflicts." → Create case file. It takes 135 s.
- **Expected:** the report surfaces the 4 planted contradictions that Radar already holds (revenue, emissions, Aurora date, CEO start).
- **Actual:**
  - The executive summary says "largely consistent, with **no substantive contradictions or conflicts identified**".
  - It lists "a 41% reduction in emissions intensity" as consensus.
  - It calls the Q3 2027 date "an outdated or preliminary reference". That picks a side, which is the opposite of the product promise.
  - Trust is 41, but nothing in the UI flags the report.
- **Evidence:** `$QA2/122-investigate-done.png`; case `83c04722-96ca-4a84-8b66-754383943196`.
- **Suspected cause:** `backend/app/graph/investigation.py:111` (`SYNTHESIS_PROMPT`) and `_synthesize_node` (`:452`). There's no "disagreeing sources" instruction like the one BUG-24 added to the answer prompt, and no radar contradictions are fed into the synthesis.

## S3

- **BUG-R2-8 · S3 · live chat.** Two nested vertical scroll containers draw a double scrollbar at the right edge: `<main>` has overflow-y-auto (scrollHeight 1603) and `#chat-scroll` has overflow-y-auto (scrollHeight 1875). Evidence: `$QA2/21-q1-done.png`, where two scrollbars are visible. Suspected: `frontend/src/components/Layout.tsx:551` and `frontend/src/pages/ChatPage.tsx:479`.
- **BUG-R2-9 · S3 · workspace Members tab.** The "Member actions" menu (Copy User ID / Remove member) doesn't close on Escape; only a backdrop click closes it. While it's open, its `fixed inset-0 z-30` backdrop blocks the other controls. Suspected: `frontend/src/pages/WorkspaceDetailPage.tsx:1310-1319`.
- **BUG-R2-10 · S3 · `/admin/documents/:docId`.** The processing timeline shows every step grey (not done) for a `ready` document, because `STATUS_ORDER` lacks `ready`, so `currentIdx` is -1. Suspected: `frontend/src/pages/AdminDocumentDetailPage.tsx:20,185`.
- **BUG-R2-11 · S3 · `/admin/users/:id`.** After a confirmed role change, "Last Login" flips to "Never" until reload. The PUT response (`UserResponse`) lacks `last_login_at` and replaces the page state. Suspected: `frontend/src/pages/AdminUserDetailPage.tsx:87,102` and `backend/app/api/admin.py:~681`.
- **BUG-R2-12 · S3 · `/admin/users`.** A self-registered user shows "Last login: Never" even though registration signs them in. `register` doesn't stamp `last_login_at`; only `login` does. Suspected: `backend/app/api/auth.py:121` vs `:206`.
- **BUG-R2-13 · S3 · `/dashboard` Recent Chats.** An abstained query shows "abstain" as the model name ("2m ago · abstain"). `/chats` was fixed (BUG-41), but the dashboard wasn't. Suspected: `frontend/src/pages/UserDashboard.tsx:208`.
- **BUG-R2-14 · S3 · `/admin/settings`.** Two problems:
  - About shows the legacy app name **"VeritasRAG"**.
  - The Rate Limiting card renders an enabled checkbox and a Save button while stating "set via server config, not editable here".
  - Suspected: `backend/app/config.py:21` (`APP_NAME`) and `frontend/src/pages/AdminSettingsPage.tsx:~245-262`.
- **BUG-R2-15 · S3 · `/admin/documents/upload`.** After the batch finishes, the button reads **"Upload 0 file"**. Suspected: `frontend/src/pages/AdminUploadPage.tsx:386`.
- **BUG-R2-16 · S3 · `/r/:token` receipt.** Three problems:
  - The receipt omits the conflict (D) rows the chat showed ("3 conflict"), so a reader never learns the sources disagree.
  - The header reads "Verified Answer Receipt" even when the badge says "Guardrail failed — 30%".
  - Verdict names differ from the chat ("Supported" vs "VERIFIED").
  - Evidence: `$QA2/43-receipt-public.png`, `44-receipt-print.png`. Suspected: `frontend/src/pages/ReceiptPage.tsx:266`.
- **BUG-R2-17 · S3 · Seal receipt dialog.** "Revoke this receipt" revokes immediately (irreversible; the public link dies) with no confirm. Suspected: `frontend/src/components/SealReceiptButton.tsx:200`.
- **BUG-R2-18 · S3 · `/admin/golden`.** The "Source workspace" column shows a raw workspace UUID instead of the name. Suspected: `frontend/src/pages/AdminGoldenPage.tsx:209`.
- **BUG-R2-19 · S3 · `/api-catalog`.** The "Pipeline" side panel shows static made-up stage latencies ("Generation ~2s", "Rerank ~150ms"), while real answers take 8–25 s. This is a BUG-44 residual. Suspected: `frontend/src/components/api-catalog/data.ts:1250`.
- **BUG-R2-20 · S3 · live chat streaming.** The blinking caret renders on its own line under the streamed prose, instead of at the end of the text. Evidence: `$QA2/62-emissions-stream-2.png`. Suspected: `frontend/src/components/ledger/ProseAnswer.tsx:87`.
- **BUG-R2-21 · S3 · live chat Regenerate.** Regenerate appends a second copy of the question and answer to the conversation, and creates a separate history entry each time. After 2 regenerations, the sidebar Recent and `/chats` show 3 identical "What installed capacity…" chats. Expected: replace the answer in place, or group it as a version. Suspected: `frontend/src/pages/ChatPage.tsx:436`.
