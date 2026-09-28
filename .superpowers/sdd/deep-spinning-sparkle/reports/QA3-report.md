# QA round 3: final gate before merging to main

**STATUS: FAIL.** There are 0 S1 bugs, but **6 S2 issues are open**:
- 1 still broken: R2-4
- 2 partly fixed: R2-3 and R2-7
- 3 new: BUG-R3-1, R3-2 and R3-3

BUG-10 and BUG-15 are also only partly fixed; their residuals are listed below. The admin panel is in good shape: all 16 admin routes load at 1280 and 375, and every flow that changed in round 2 works. Only S3 issues remain there, plus the new R3-3 bug in workspace Members.

| | |
|---|---|
| Build | `feat/truth-suite-demo` @ `5de6c7a` (fix round 2: lanes B2, F2a and F2b, plus CEO commit 6be2967) |
| App | Already running with a fresh seed. Frontend `:5173`, demo workspace `ceb28089-…`. At the start: 6 docs, 4 planted radar contradictions, `warm:true`, model qwen3:4b-instruct. |
| Date | 2026-09-28 |
| Tooling | Playwright MCP (Chromium), with a separate browser context for each logged-out check and each persona. |
| Personas | One-click Analyst and Admin, plus two freshly registered users, `viewer3_qa` and `editor3_qa`, invited **by email** in Members. The password is only in `scratchpad/qa3-creds.txt`. |
| Screenshots | `$QA3` = `/private/tmp/claude-501/-Users-nikunjvaghasiya-SGP-TruthLens-AI--claude-worktrees-user-agent-reach-improve-fd209b/818b146a-b404-4aa6-ab8f-442350d7a541/scratchpad/qa3/` (166 PNGs). The console log and sweep script are in `…/scratchpad/qa3-artifacts/`. |

## Counts

| | Fixed | Partial | Still broken |
|---|---|---|---|
| Round-1 items still open after QA2 (15) | 10 | 5 (**10, 15, 33, 36, 38**) | 0 |
| QA2 new bugs R2-1 … R2-21 (21) | 17 | 2 (**R2-3, R2-7**) | 2 (**R2-4, R2-11**) |
| **Total (36)** | **27** | **7** | **2** |

- **New in round 3:** 11 bugs (S1 0 · S2 3 · S3 8). They are listed at the end.
- **Accepted deferrals (not re-filed):**
  - BUG-22: Regenerate on the detail page runs the comparison re-run.
  - BUG-39: Promote works without an extra confirm for an eval-passed prompt.

## A) Verification of every item that was open after round 2

| Bug | Sev | Verdict | Evidence / observation |
|---|---|---|---|
| BUG-7 | S2 | VERIFIED FIXED | "Which projects in the pipeline are currently under construction?" now **answers** instead of abstaining: 11.0 s, 5 verified and 1 partial, trust 70. Each CSV row is prefixed and cited, e.g. `name: Solheim Solar Park; … status: construction`. The answer lists 4 of the 5 projects under construction; the missing one is filed as **R3-4** (S3). `$QA3/A07-pipeline.png` |
| BUG-8 | S2 | VERIFIED FIXED | Live exhibits and evidence links now show page numbers ("Annual Report 2025, page 1"; "…Results, page 1/page 2"). The press release keeps its subject: "Northwind Renewables Reports Fourth-Quarter and Full-Year 2025 Results". Checked at 375 on `/chat/:id` too. |
| BUG-10 | S2 | **PARTIAL** | Live progress works ("1 of 6 steps complete · 6.8 s elapsed"), and the executive report renders its markdown. **Still raw on the finished case file:**<br>• The **Research ledger** prints `partial_answer` as plain text, so literal `**Aurora Commissioning Date**` and `[source:2][source:3]` appear (8 `**`).<br>• The **Evidence register** shows `[source:1]` as the "span" text for all 22 entries (44 raw markers on the page).<br>The round-2 fix only touched `ReasoningTimeline.tsx`. The raw text comes from `frontend/src/pages/InvestigationPage.tsx:417` (ResearchLedger: `{question.partial_answer}`) and `:413` (EvidenceRegister: `{citation.text}`). `$QA3/C11-investigate-done.png` |
| BUG-15 | S2 | **PARTIAL** | A role-change select now exists in the member menu (Editor/Viewer), and `PUT …/members/{id}` returns 200 (editor3 went viewer → editor). But the menu is **clipped by the member card**, so the select is only half visible and Copy User ID / Remove member can't be reached with a pointer. Filed as **R3-3**. `$QA3/A15-member-menu.png` |
| BUG-16 | S2 | VERIFIED FIXED | Uploaded the round-2 note ("closed the year 2025 with 1,580 employees" / "Kestrel Ridge … commissioned in November 2024"). The auto-scan raised Radar from 4 to **6 (2 of 2 found)** within about 22 s, and a full scan added no false positives. The pairs point at the counterpart sentences in other documents, not at the Annual Report itself:<br>• Employees: Sustainability Report p.2, "employed 1,240 people at year end", which is the same figure as the Annual Report.<br>• Kestrel: press release p.1, "…full twelve months of output in 2025 versus roughly nine months in 2024".<br>The Annual Report's "(commissioned March 2024)" sentence is not listed as a separate pair. The conflicts are detected; the note above is just a precision detail. `$QA3/A16-radar-after-note.png` |
| BUG-17 | S2 | VERIFIED FIXED | Radar "View in document" marks exactly one sentence in DOCX ("Aurora is now expected to commission in the first quarter of 2028."), MD ("Dana Whitfield became Chief Executive Officer in January 2022.") and PDF (the emissions sentence). D-row "Compare the pages" highlights "Revenue in 2025 was €412 million." `$QA3/C09-radar-view-{docx,md,pdf}.png`, `C03-compare-pages.png` |
| BUG-24 | S2 | VERIFIED FIXED | The revenue question was asked once, then regenerated 3 times, then replayed once from cache. **0 of 5 answers picked a side.** Every answer reads "…€412 million in the Annual Report 2025 [2]. However, the … Results document states … €398 million [1]. The sources disagree on the revenue figure." The fresh runs came back identical. `$QA3/C12-regen-{1,2,3}.png` |
| BUG-29 | S3 | VERIFIED FIXED | Figure tables now show real values: revenue "€412 million / €398 million · Difference **€14M**" and emissions "41% / 34% · Difference **7 pts**". No year or comma figures appear. |
| BUG-33 | S3 | **PARTIAL** | Fixed: the tour is now a "Tour n/5" button in the top bar, it closes on Esc and on an outside click, and it is hidden for the non-demo `viewer3.qa@truthlens.dev` and `editor3.qa@truthlens.dev` accounts. **Still broken:** clicking "Go" to a *different* route leaves a ghost panel on screen. Filed as **R3-2** (S2). |
| BUG-36 | S3 | **PARTIAL** | `/admin/audit-log` USER column shows names (demo_admin, viewer3_qa, editor3_qa…). The `/admin` dashboard's embedded **Audit Logs** tab still has a "User ID" column showing `a1023716-0c8…`. Cause: `frontend/src/pages/AdminDashboard.tsx:668,710`. `$QA3/AD-admin-1280.png` |
| BUG-38 | S3 | **PARTIAL** | Fixed: "Uploaded by" shows the name (demo_analyst / demo_admin) on the list and the detail page, and the timeline is green. **Still open:** the list table still scrolls horizontally at 1280 (container 1017 vs 982 px). The last (chevron) column is cut off at x=1290, and sizes wrap ("171 / B"). `$QA3/AD-documents-1280.png` |
| BUG-39 | S3 | VERIFIED FIXED | On the users list, changing the role opens "Change editor3_qa's role to admin? … full administrative access" with Change role / Cancel. Cancel keeps the select on `user` and sends no request. Deactivate opens "Deactivate editor3_qa?" with a confirm. Promoting without an extra confirm is the accepted deferral. `$QA3/AD-users-role-confirm.png`, `AD-users-deactivate-confirm.png` |
| BUG-40 | S3 | VERIFIED FIXED | Added one sentence to the one-line default prompt. The diff shows the whole default as unchanged, plus "**Added:** QA3 test: keep answers under 120 words." Nothing is marked Removed. The draft was deleted afterwards (204). `$QA3/AD-prompt-diff.png` |
| BUG-50 | S3 | VERIFIED FIXED | `/admin` shows "Avg Trust Score **64/100** Fair". A cached replay (179 ms, "Cached 33ms") keeps full audit-trail details: "5 found across 10 documents · Kept the top 5 of 5 · 67 words · Checked 4 claims". `$QA3/A-BUG50-cached-trail.png` |
| BUG-53 | S3 | VERIFIED FIXED | ⌘K "Memorandum" shows "Board Memorandum: … .docx · **DOCX document · ready**", with no MIME string. `$QA3/A53-search.png` |
| R2-1 | S1 | VERIFIED FIXED | As viewer3, `/chats` shows "No chat history" with no Delete buttons, and `DELETE …/queries/{analyst's id}` returns **403**. |
| R2-2 | S2 | VERIFIED FIXED | The tour is a top-bar button. A hit-test sweep checked every visible main/header control on all 37 protected and admin routes at 1280 and 375. With the tour closed, 0 controls are covered (the only overlays were intended modals). Refresh, Invite User, New draft, New Collection, Upload Document and Run Evaluation are all clickable. |
| R2-3 | S2 | **PARTIAL** | This is much better. On the clean 4-contradiction seed:<br>• Revenue: 1 correct D-row.<br>• Emissions: 1 correct D-row.<br>• CEO: 1 correct D-row.<br>• Pipeline and risks: 0 D-rows.<br>That is 4 relevant of 5 D-rows, up from 4 of 11. **The Aurora answer still attaches the revenue conflict** (D2, "Annual Report 2025 vs … Results"), with a "Figures by source €412 million / €398 million · €14M" table, and C1 is chipped "Differs from Annual Report 2025".<br>Cause: `frontend/src/components/ledger/conflicts.ts:53-60`. `isAboutSameFact` accepts **one** shared significant token from `claim.text + claim.evidence`, and a PDF run-on evidence quote (the press-release bullet list contains "€398 million", "onshore wind" and so on) matches almost any contradiction on that page. With the QA note uploaded, the Kestrel pair also attached to the emissions, Aurora and revenue answers through "onshore"/"wind". `$QA3/A-R2-3-aurora-clean.png`, `A-aurora.png` |
| R2-4 | S2 | **STILL BROKEN** | Revenue passes, but **3 of 4 planted-conflict answers still show "Guardrail failed"**:<br>• Emissions C4 "Thus, the two sources provide different values: 41% and 34%." → **UNSUPPORTED 0.00**<br>• CEO C4 "Thus, the start date … is reported as either March 2021 or January 2022." → **CONTRADICTED 0.00** (reproduced on 2 fresh runs)<br>• Aurora C4 "First quarter of 2028" (a list fragment) → **UNSUPPORTED 0.00**, even though its evidence is the exact Q1 2028 sentence<br>Cause: `backend/app/generation/guardrail.py:42`. `_META_DISAGREEMENT_RE` only matches `disagree*|discrepanc*`, so "different values", "either … or …", "conflict", "differ" and "inconsistent" still get scored. Bare list fragments have no subject, so NLI can't entail them. `$QA3/A-emissions.png`, `A-ceo.png`, `A-aurora.png` |
| R2-5 | S2 | VERIFIED FIXED | Admin upload of `qa3-facts.json` returned 202, then **ready · 1 chunk**. The CSV and TXT in the same batch are ready too. |
| R2-6 | S2 | VERIFIED FIXED | Viewer3's stored answer has **no Seal receipt** button. The review-queue actions and "Pause queue" are hidden for the viewer (the owner does see "Pause queue"). The queue was empty in this seed (threshold 0.5), so role-gated card actions were verified from code (`canModerate`, plus a toast on 403 in `ReviewQueuePage.tsx`, commit 2ef1592) and its unit test. `$QA3/A-R2-6-viewer-*.png` |
| R2-7 | S2 | **PARTIAL** | "Compare the key findings … identify conflicts" had live progress and finished in 128 s. The report now says "significant discrepancies exist" and covers **Aurora Q3 2027 vs Q1 2028** and **emissions 41% vs 34%**. However:<br>• Revenue €412M/€398M and CEO 2021/2022 are absent.<br>• `final_report` is **cut off mid-sentence** in its own "3. Contradictions Found" section ("…commission in **Q3 2027** [source"). Only 6,016 characters fit, so the section that should list every conflict is lost.<br>• The Capex section also presents €1.1 B total versus €640–680 M for 2026 as a mismatch, which is not a real conflict.<br>Cause: `backend/app/config.py:191` `INVESTIGATION_SYNTHESIS_MAX_TOKENS = 1280`. The prompt at `backend/app/graph/investigation.py:128` puts Contradictions third, after the long findings. Case `bac615ca-…`. `$QA3/C11-investigate-done.png` |
| R2-8 | S3 | VERIFIED FIXED | Only one vertical scroll container remains (`main#main-content`). `#chat-scroll` is gone, and there is no double scrollbar. |
| R2-9 | S3 | VERIFIED FIXED | The member menu closes on Esc, and there is no full-screen backdrop: the point (400, 300) hits the page, not a scrim. Its clipping is a separate issue (R3-3). |
| R2-10 | S3 | VERIFIED FIXED | The timeline on `/admin/documents/:id` for a ready PDF shows Pending → Processing → Ready, all 3 coloured. `$QA3/AD-doc-detail-1280.png` |
| R2-11 | S3 | **STILL BROKEN** | On `/admin/users/:id` (editor3), a confirmed role change user→admin→user makes "Last Login" flip from "Sep 28, 2026, 09:41 PM" to **"Never"**. `PUT /api/admin/users/{id}/role` returns `last_login_at: null` (while GET returns 16:11:29Z). The frontend merge `{...prev, ...updated}` then overwrites the real value with that null.<br>Cause: `backend/app/api/admin.py:683` builds `UserResponse(...)` without `last_login_at`, and `frontend/src/pages/AdminUserDetailPage.tsx:108` does the merge. `$QA3/AD-user-detail-after-role.png` |
| R2-12 | S3 | VERIFIED FIXED | editor3 registered and never logged in. `/admin/users` shows "Last login: Sep 28, 2026, 09:41 PM". |
| R2-13 | S3 | VERIFIED FIXED | Dashboard Recent Chats shows "What is the capital of Australia? · 1m ago · **Abstained** · 0/100". |
| R2-14 | S3 | VERIFIED FIXED | `/admin/settings` shows App name **TruthLens AI**. Rate Limiting is text only ("Enabled · 30 requests per 60s window — set via server config"), with 0 checkboxes and no Save button. |
| R2-15 | S3 | VERIFIED FIXED | "Upload 3 files" → all 3 show Complete → only "Browse Files / View Documents" remain. There's no "Upload 0 file". |
| R2-16 | S3 | VERIFIED FIXED | Logged out, a passing answer reads "VERIFIED ANSWER RECEIPT · Guardrail passed — 99%". A failing answer reads "**UNVERIFIED** ANSWER RECEIPT · Guardrail failed — 49%". The "Sources disagree" section shows the figures and "Difference: €14M / 7 pts". Verdict names (Partial/Verified) match the ledger. The section is not filtered for relevance, which is filed as **R3-6**. `$QA3/C06-receipt-public-1280.png`, `A-R2-16-receipt-failed.png` |
| R2-17 | S3 | VERIFIED FIXED | "Revoke this receipt" asks "Revoke? Cancel / Confirm". Confirm returns DELETE 204, the receipt is marked REVOKED, and `/r/<token>` returns 410 "Receipt revoked" at 1280 and 375. `$QA3/A-R2-17-revoke-confirm.png` |
| R2-18 | S3 | VERIFIED FIXED | `/admin/golden` "Source workspace" shows **Northwind Renewables — Due Diligence**. Tested with an editor3 promotion: pending → Approve (200) → Delete with confirm (204). `$QA3/AD-golden-pending.png` |
| R2-19 | S3 | VERIFIED FIXED | The API catalog Pipeline panel lists stage names only (Auth … Persist, "8/8 stages"), with 0 "~Ns/~ms" figures. The System Status card is still hard-coded, which is filed as **R3-8**. |
| R2-20 | S3 | VERIFIED FIXED | Sampled 62 times while the risks answer streamed. The caret always sits inside the last `<p>`/`<li>`, about 2 px right of the last glyph on the same line. `$QA3/A-R2-20-caret.png` |
| R2-21 | S3 | VERIFIED FIXED | The revenue question was replayed from cache and then regenerated 3×. The turn is replaced in place: the question appears once on the page. `/queries?mine=true` holds 2 revenue rows: the original, kept because it has a receipt (K4), and the final regeneration. There are no duplicate history entries. |
| BUG-22 | – | ACCEPTED DEFERRAL | Detail-page Regenerate / "Re-run comparison" is unchanged. |

## B) Route × result (1280 and 375)

✓ means it renders, has no page-level horizontal scroll, no page error, and no unexpected 4xx/5xx. The console showed **0 errors across the whole session**; the only warnings were two React Router v7 future-flag warnings. **FAIL** means an S2 bug is open on that route.

| # | Route | 1280 | 375 | Result | Notes |
|---|---|---|---|---|---|
| 1 | `/` | ✓ | ✓ | PASS | "Try the live demo" lands in the demo chat in 0.2 s. No auth calls. |
| 2 | `/login` | ✓ | ✓ | PASS | One-click Analyst reaches the chat in 0.24 s; one-click Admin reaches `/admin`. |
| 3–4 | `/signup`, `/register` | ✓ | ✓ | PASS | Registering 2 users returned 201 → `/workspaces`. |
| 5–7 | `/forgot-password`, `/reset-password`, `…?token=bogus` | ✓ | ✓ | PASS | |
| 8–10 | `/privacy`, `/terms`, `/contact` | ✓ | ✓ | PASS | |
| 11 | `/r/<valid>` (logged out) | ✓ | ✓ | PASS | "Seal intact — verified in your browser", honest header, conflicts section. No `/auth` calls. Extra unrelated conflicts are listed (R3-6). |
| 12 | `/r/<revoked>` | ✓ | ✓ | PASS | 410 → "Receipt revoked", with brand and home link. |
| 13 | `/r/<bogus>` | ✓ | ✓ | PASS | 404 → not-found state. The only console line is the expected 404 resource. |
| 14 | `/nonexistent` | ✓ | ✓ | PASS | 404 page. |
| 15 | logged-out → `/dashboard`, `/admin`, `/admin/settings` | ✓ | ✓ | PASS | Redirects to `/login`. |
| 16 | `/dashboard` | ✓ | ✓ | PASS | "Abstained" label (R2-13). |
| 17–18 | `/workspace`, `/chat` | ✓ | ✓ | PASS | Redirect to `/workspaces` and `/chat/new`. |
| 19 | `/chat/new` | ✓ | ✓ | PASS | |
| 20 | `/chats` | ✓ | ✓ | PASS | Shows only the caller's own chats. The viewer sees none and gets no Delete button (R2-1). |
| 21 | `/chat/:queryId` | ✓ | ✓ | **FAIL** | R2-4 (Guardrail failed on conflict answers), R3-1 (evidence = document title), R2-3 (Aurora). |
| 22 | `/workspaces/:id/queries/:queryId` | ✓ | ✓ | **FAIL** | Same as row 21. The viewer gets no Seal button (R2-6). |
| 23 | `/documents` | ✓ | ✓ | PASS | |
| 24 | `/settings` | ✓ | ✓ | PASS | |
| 25 | `/workspaces` | ✓ | ✓ | PASS | |
| 26 | `/workspaces/:id` (Documents) | ✓ | ✓* | PASS* | Upload returns 202, then ready and auto-scanned. At 375, `<main>` scrolls sideways by 185 px (R3-9). |
| 27 | `…?tab=activity` | ✓ | ✓* | PASS* | R3-9 |
| 28 | `…?tab=radar` | ✓ | ✓* | PASS* | 4/4 planted, 2/2 fresh (BUG-16), full scan about 5 s, sentence-level View in document. R3-9 at 375. |
| 29 | `…?tab=members` | ✓ | ✓* | **FAIL** | Invite by email works. The role select works but the action menu is clipped (R3-3). |
| 30 | `…?tab=settings` | ✓ | ✓* | PASS* | R3-9 |
| 31 | `/workspaces/:id/documents/:docId` | ✓ | ✓* | PASS* | At 375, `<main>` overflows by 12 px from the header row (R3-9). |
| 32 | `…?chunk=` | ✓ | ✓ | PASS | Opens the viewer modal on the right document. |
| 33 | `/workspaces/:id/review-queue` (+ Quarantine) | ✓ | ✓ | PASS | Owner sees "Pause queue"; viewer sees no actions. The queue is empty (all trust ≥ 0.5). |
| 34 | `/workspaces/:id/chat` | ✓ | ✓ | **FAIL** | R2-4, R3-1, R2-3. Streaming, the inline caret, Regenerate in place, the abstention card, Copy/Export/👍 and the single scroll container all work. |
| 35 | `/workspaces/:id/investigate` | ✓ | ✓ | **FAIL** | Live progress works. The report is truncated (R2-7), and the research ledger and evidence register show raw text (BUG-10). |
| 36 | `/workspaces/:id/investigate/:caseId` | ✓ | ✓ | **FAIL** | Same case file as row 35. |
| 37 | `/api-catalog` | ✓ | ✓ | PASS* | No fabricated latencies. The status card is static (R3-8). Analyst is redirected to `/dashboard`. |
| 38 | `/admin` (+ Audit / Evaluation tabs) | ✓ | ✓ | PASS* | 64/100. Refresh is clickable. The Audit tab shows UUIDs (BUG-36). |
| 39 | `/admin/documents` | ✓ | ✓ | PASS* | Uploader names shown. Bulk delete confirms and returns 200. The table scrolls 35 px at 1280 (BUG-38). |
| 40 | `/admin/documents/upload` | ✓ | ✓ | PASS | JSON/CSV/TXT are all ready. No "Upload 0 file". |
| 41 | `/admin/documents/:docId` (+ bogus id) | ✓ | ✓ | PASS | Timeline is green. The bogus id shows "Document not found". |
| 42 | `/admin/collections` | ✓ | ✓ | PASS | New Collection is clickable. Create returns 201; Delete confirms and returns 204. |
| 43 | `/admin/users` | ✓ | ✓ | PASS | Role and Deactivate confirms work (BUG-39). Last login is shown for self-registered users (R2-12). |
| 44 | `/admin/users/invite` | ✓ | ✓ | PASS | Invalid email shows "Invalid email format" plus the native message. |
| 45 | `/admin/users/:userId` (+ bogus) | ✓ | ✓ | PASS* | Role change confirms and returns 200. Last Login then flips to "Never" (R2-11). The bogus id returns the expected pair of 404s. |
| 46 | `/admin/settings` | ✓ | ✓ | PASS | TruthLens AI. Rate limit is read-only. |
| 47 | `/admin/analytics` (Overview / RAGAS / Usage & Cost) | ✓ | ✓ | PASS | All 3 tabs render. No `abstain` model row. "Local models have no API cost". |
| 48 | `/admin/audit-log` | ✓ | ✓ | PASS | USER names shown. The member role change isn't logged (R3-7). |
| 49 | `/admin/prompts` | ✓ | ✓ | PASS | New draft is clickable. Draft returns 201, the diff is sentence-level, Delete confirms and returns 204. |
| 50 | `/admin/golden` | ✓ | ✓ | PASS | Workspace name shown. Approve returns 200; Delete confirms and returns 204. |
| 51 | analyst → every `/admin*` route and `/api-catalog` | ✓ | ✓ | PASS | All 16 redirect to `/dashboard`, at both widths. |

Rows marked `✓*` or PASS* have only an S3 layout or cosmetic issue.

- **Admin summary:** all 16 admin routes (and `/api-catalog`) load at both widths with 0 console errors.
- **The closed tour covers nothing.** The hit-test ran over all of them.
- **Every round-2 admin change behaves as specified:**
  - inline role and Deactivate confirms
  - uploader, audit and golden names
  - timeline, `/100` trust, TruthLens AI, read-only rate limit
  - sentence diff, no "Upload 0", JSON ingestion
  - API catalog without latencies
- **Remaining admin issues are S3 only:** R2-11 (last login → Never), BUG-36 residual on the `/admin` Audit tab, BUG-38 (35 px table scroll), R3-7 and R3-8.
- **Dark theme:** the ledger and Radar are readable (`$QA3/B-dark-*.png`).

## C) Core demo path, end to end: PARTIAL

| Step | Result |
|---|---|
| Landing → "Try the live demo" | ✓ Lands on `/workspaces/ceb28089…/chat` in 0.2 s, with the Tour 0/5 button in the top bar. |
| Suggested revenue question → Claim Ledger | ✓ First prose after 10.4 s, done at 16.4 s. "Answer verified", trust 85, 1 verified and 1 partial. **One D-row, with the real figures "€412 million / €398 million · Difference €14M"**. Emissions later showed "41% / 34% · 7 pts". |
| View in document (sentence highlight) | ✗ The C1 evidence link opened AR p.1 with the **document title** "Northwind Renewables — Annual Report 2025" highlighted, not the revenue sentence. "Why partial" then claims "€412 million (not in source)" (R3-1). "Compare the pages" does highlight "Revenue in 2025 was €412 million." `$QA3/C02-view-in-doc.png` vs `C03-compare-pages.png` |
| Seal receipt → `/r/<token>` logged out | ✓ 201. "VERIFIED ANSWER RECEIPT · Seal intact — verified in your browser · Guardrail passed — 99%". The **SOURCES DISAGREE** section shows revenue with €14M, but it also lists the CEO and emissions pairs (R3-6). No horizontal scroll at 1280 or 375. |
| Radar tab | ✓ **Open 4** / Dismissed 0 / Resolved 0, all 4 planted. |
| Investigation | ◐ Live progress "N of 6 steps complete · X s elapsed", done in 128 s. The report names the Aurora and emissions conflicts, but it is **truncated inside "Contradictions Found"**, and revenue and CEO are missing (R2-7). |
| Tour "Go" (presenter aid) | ✗ "Go → Open Contradiction Radar" navigates, but it leaves a ghost panel over the page (R3-2). |

## Planted-contradiction recall (clean seed)

| Conflict | Radar | Chat ledger | Answer text | Guardrail |
|---|---|---|---|---|
| Revenue €412M vs €398M | ✓ | ✓ 1 D-row, €14M | Both figures (0 of 5 runs picked a side) | passed (85) |
| Emissions −34% vs −41% | ✓ | ✓ 1 D-row, 7 pts | Both figures | **failed** (R2-4) |
| Aurora Q3 2027 vs Q1 2028 | ✓ | ✓, plus a spurious revenue D-row (R2-3) | Both dates | **failed** (R2-4) |
| CEO Mar 2021 vs Jan 2022 | ✓ | ✓ 1 D-row (no figures table, as expected) | Both dates | **failed** (R2-4, 2 of 2 runs) |
| Fresh note (1,580 employees; Kestrel Nov 2024) | ✓ 2/2 | – | – | – |
| Investigation "identify conflicts" | – | – | 2 of 4 (report truncated) | trust 33 |

Chat D-row precision is **4 relevant of 5 (80%)**, up from 36%. The pipeline and risks answers show 0 D-rows.

## Latency (local qwen3:4b-instruct, one question at a time)

| Question | First prose | Done (UI label) |
|---|---|---|
| Revenue (first) | 10.4 s | 16.4 s |
| Revenue, cache hit | – | 0.36 s ("Cached 44ms") |
| Revenue, Regenerate ×3 | – | 9.4 / 8.5 / 8.5 s |
| Pipeline under construction | – | 11.0 s (was an abstention in round 2) |
| Emissions | – | 19.4 s |
| CEO | – | 18.3 s; after the doc set changed, 19.1 s; cache hit 0.18 s |
| Aurora commissioning | – | 17.9 s |
| Key Aurora risks | 9.5 s | 25.0 s |
| Off-corpus (capital of Australia) | – | abstained, 4.6 s (`latency_ms` 4631) |
| **Investigation** (6 steps) | – | **128.3 s** (`latency_ms` 127219; was 135 s) |

Other timings:
- Upload of the note: POST 202 in 1.7 s. It was ready and auto-scanned (Radar 4 → 6) within about 22 s.
- Radar full scan: about 5 s.

## New bugs (round 3)

Format: `BUG-R3-n · Sev · page · steps · expected vs actual · evidence · suspected file:line`. Paths are relative to the worktree root.

**Totals: 11 new bugs: S1 0 · S2 3 · S3 8.**

### S2

**BUG-R3-1 · S2 · chat ledger (live and stored) · the evidence quote and "View in document" pick the document title instead of the fact sentence**
- **Steps:** ask the revenue suggestion. Check C1 "…revenue in 2025 was reported as €412 million in the Annual Report 2025."
- **Expected:** the evidence is "Revenue in 2025 was €412 million.", and "View in document" highlights that sentence. This is how BUG-2 was verified in round 2.
- **Actual:**
  - The evidence quote is "Northwind Renewables — Annual Report 2025" (the title line).
  - `/locate?text=Northwind Renewables — Annual Report 2025` highlights the title block.
  - "Why partial" marks "revenue … €412 million" as **(not in source)**.
  - The same thing happens on other answers:
    - Emissions C1: evidence is the press-release title.
    - Aurora C2: evidence is "Date: 8 December 2025".
    - CEO C1: evidence is "Before joining Northwind Renewables, Dana spent eleven years…".
- **Evidence:** `$QA3/C02-view-in-doc.png`, `C01-revenue-ledger.png`, `A-emissions.png`, `A-aurora.png`.
- **Suspected cause:** `backend/app/generation/guardrail.py:337-339`. The evidence sentence is `overlaps.index(max(overlaps))`, a word-plus-number overlap, and ties go to the **first** sentence. The title shares northwind, renewables, annual, report and 2025 (6 in all). The fact sentence shares revenue, 2025, 412 and million (6). They tie, so the title wins.
- **Why it's new:** this is a regression exposed by the BUG-24 prompt change (`backend/app/generation/generator.py:156-158`), which makes claims name their source document.
- **Fix idea:** weight shared numbers higher, or ignore words from the document title and file name, or skip heading-only sentences.

**BUG-R3-2 · S2 · app shell, demo tour · "Go" to another route leaves a ghost tour panel that can't be dismissed and blocks clicks**
- **Steps:** as a demo analyst, open the chat, click "Tour 0/5", then click **Go** on "Open Contradiction Radar". It reproduced 3 of 3 times, from `/chat/:id` and from `/workspaces/:id/chat`.
- **Expected:** the panel closes on Go (BUG-33 and R2-2 contract).
- **Actual:**
  - The page navigates, but `#demo-tour-panel` stays rendered (opacity 1) while the toggle says `aria-expanded="false"` and `localStorage` says `collapsed:true`.
  - Esc and outside clicks no longer close it, because the listeners are only attached while the tour state is open.
  - It **intercepts pointer events** over x 676–996 / y 50–312, which covers the page header and stat cards.
  - Only clicking the Tour button twice, or reloading, clears it.
  - "Go" to the same route does close it.
- **Evidence:** `$QA3/B-tour-after-go.png`, `B-tour-ghost-repro.png`, `B-tour-ghost-after-go.png`.
- **Suspected cause:** `frontend/src/components/DemoTour.tsx:214-270`. `<AnimatePresence>` exit is interrupted when `<Link onClick={collapse}>` (`:257-264`) changes the route in the same tick, so the exiting node is never removed.
- **Fix idea:** drop the exit animation, key the panel on the location, or navigate after collapsing.

**BUG-R3-3 · S2 · workspace Members tab · the member action menu is clipped by its card, so the role select and "Remove member" can't be reached with a pointer (BUG-15 residual)**
- **Steps:** owner → `?tab=members` → "Member actions" (…) on any member.
- **Expected:** a full menu with Role, Copy User ID and Remove member.
- **Actual:**
  - The menu (`absolute top-10`, about 137 px tall) sits inside a card with `overflow-hidden` that is about 100 px tall.
  - Only "ROLE" and the top edge of the select are visible.
  - Copy User ID and Remove member are hidden, and the element under them is the card itself.
  - The role change still works via keyboard or `selectOption` (PUT 200). Removing a member is impossible with a mouse.
- **Evidence:** `$QA3/A15-member-menu.png`, `A15-member-menu-2.png`.
- **Suspected cause:** `frontend/src/pages/WorkspaceDetailPage.tsx:1310` (card `overflow-hidden`) and `:1359` (menu). This came from 64f552a, which removed the backdrop but kept the menu inside the clipped card.
- **Fix idea:** portal or `fixed` positioning for the menu, or drop `overflow-hidden` on the card.

### S3

- **BUG-R3-4 · S3 · chat, pipeline suggestion.** The answer lists 4 of the 5 projects under construction (Solheim, Lindholm, Aurora, Fjellheim) and misses **Ashford Solar** (UK, 60 MW, construction), yet shows "Answer verified". Each CSV row is its own chunk and only the top 5 reranked chunks reach the model; one of those slots went to Meridian (early development). Evidence: `$QA3/A07-pipeline.png`, `backend/app/demo/corpus/project-pipeline.csv`. Suspected: `backend/app/ingestion/loader.py:178-186` (one row per chunk) and `backend/app/config.py:69` `RETRIEVAL_RERANK_K = 5`. The brief's "group a few rows per chunk" was not done.
- **BUG-R3-5 · S3 · chat "Read as prose".** When an answer has claims, the whole answer renders as a single `<p>` of spans, so markdown is lost. The revenue answer reads "…revenue figure. - €412 million ² - €398 million ¹ The sources…", with list bullets inline, and multi-paragraph and list answers become one run-on paragraph. Evidence: `$QA3/C13-prose-list-inline.png`. Suspected: `frontend/src/components/ledger/ProseAnswer.tsx:134-174`.
- **BUG-R3-6 · S3 · `/r/:token` receipt.** "Sources disagree" lists **every** open contradiction that touches a cited chunk. The revenue receipt also shows the CEO and emissions pairs, and the Aurora receipt shows 5 pairs (revenue, CEO, emissions, Kestrel and Aurora). The chat for the same answer shows 1 D-row. The public artifact tells readers about unrelated disagreements. Evidence: `$QA3/C06-receipt-public-1280.png`, `A-R2-16-receipt-failed.png`. Suspected: `backend/app/api/receipts.py:85`, which calls `backend/app/radar/__init__.py:48-66` (`open_conflicts_for_chunks`, which uses `or_(chunk_a in …, chunk_b in …)` with no claim-level relevance filter). Suggested fix: reuse the R2-3 pairing.
- **BUG-R3-7 · S3 · audit.** Changing a workspace member's role (`PUT /workspaces/{id}/members/{user_id}` → 200, editor3 viewer → editor) writes **no audit row**. The audit log jumps from `workspace.add_member` to `user.login`, and there's no "workspace update member" action in the filter. Suspected: `backend/app/api/workspaces.py:293-325` (`update_member_role` never adds an `AuditLog`).
- **BUG-R3-8 · S3 · `/api-catalog`.** The "System Status" card is hard-coded: API Server "Operational", WebSocket "Connected", "2 Active" background jobs, whatever the real state is. The Quick Test curl targets `https://api.truthlens.ai`, a host that doesn't exist for this local app. This is the same class as BUG-44/R2-19 (fabricated live data). Suspected: `frontend/src/components/api-catalog/RightPanel.tsx:110-140` (LiveStatus) and `:78` (curl).
- **BUG-R3-9 · S3 · 375 px workspace detail.** The tab bar (`w-fit`, 550 px) makes `<main>` itself scroll sideways by **185 px** on all 5 tabs, so the whole page pans. On `/workspaces/:id/documents/:docId`, the "Open document / Workspace" header row overflows by 12 px. The page-level check passes because `<main>` is the scroller. Evidence: `$QA3/R375-ws-main-scrolled.png`. Suspected: `frontend/src/pages/WorkspaceDetailPage.tsx:369-374` (tabs wrapper has no `overflow-x-auto`) and `frontend/src/components/ui.tsx:637`.
- **BUG-R3-10 · S3 · 375 px demo tour.** The popover is anchored `right-0` under the button, which sits at x=201, so it renders at **x = −53**. The heading reads "enter tour", and the step checkboxes and numbers are off-screen. The "Tour 0/5" label also wraps onto 2 lines in the 56 px top bar. Evidence: `$QA3/B-tour-375.png`. Suspected: `frontend/src/components/DemoTour.tsx:222`.
- **BUG-R3-11 · S3 · live chat Seal dialog.** After sealing, reopening "Seal receipt" in the same live conversation shows only the "Receipt sealed" state. The just-created receipt is filtered out of "Existing receipts", so it can't be **revoked from the chat**; the user has to open the stored `/queries/:id` page. Suspected: `frontend/src/components/SealReceiptButton.tsx:129` (`activeExisting = existing.filter(r => r.token !== created?.token)`) together with `:141` (`!created` hides the list).

## Remaining S1/S2 (one line each)

- **R2-4 (S2, still broken):** 3 of 4 planted-conflict answers end with "Guardrail failed". "Different values: 41% and 34%", "either March 2021 or January 2022" and the bare "First quarter of 2028" are scored UNSUPPORTED or CONTRADICTED. Cause: `guardrail.py:42`, whose regex only covers `disagree*` and `discrepanc*`.
- **R2-3 (S2, partial):** the Aurora answer still attaches the revenue conflict with a €412M/€398M figure table. Cause: `conflicts.ts:53-60` accepts a single shared token.
- **R2-7 (S2, partial):** the investigation report is truncated mid-sentence in "Contradictions Found" (`INVESTIGATION_SYNTHESIS_MAX_TOKENS=1280`), and only 2 of 4 conflicts appear.
- **BUG-10 (S2, partial):** on the case file, the Research ledger prints raw `**…**` and `[source:N]`, and the Evidence register shows `[source:N]` as its span text (`InvestigationPage.tsx:413,417`).
- **BUG-R3-1 (S2, new):** the ledger evidence and "View in document" highlight the document title instead of the fact sentence, because of the overlap tie-break at `guardrail.py:337-339`. It breaks the demo's "View in document" step.
- **BUG-R3-2 (S2, new):** tour "Go" to another route leaves a ghost panel that can't be dismissed and blocks clicks (`DemoTour.tsx:214-270`).
- **BUG-R3-3 (S2, new; BUG-15 residual):** the member action menu is clipped by its card, so Remove member and the role select can't be reached (`WorkspaceDetailPage.tsx:1310/1359`).

## Side effects / cleanup

- **Deleted** (admin bulk delete, confirm, 200): `QA3 Workforce Note.txt`, `qa3-admin.txt`, `qa3-facts.json`, `qa3-assets.csv`. The workspace is back to **6 docs**.
- **Radar:** back to **4 open / 0 / 0**.
- **Receipts:** both test receipts (revenue and Aurora) were revoked (204).
- **Removed:** the QA3 prompt draft (204), the QA3 collection (204), and the golden entry (approved, then deleted, 204).
- **Reverted:** editor3's global role went user → admin → user.
- **Left in place, as in round 2:**
  - Users `viewer3_qa` (workspace viewer) and `editor3_qa` (workspace editor, set with the new role control).
  - The analyst's QA queries: 9 rows, including the original revenue answer kept by K4 because it had a receipt.
  - 1 investigation case file (`bac615ca-…`).
- **Browser:** closed. `.playwright-mcp/` was emptied and removed. The console log and the sweep script were moved to `scratchpad/qa3-artifacts/`.
