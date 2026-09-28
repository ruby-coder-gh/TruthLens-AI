# QA round 4: final recheck before merging to main

**STATUS: FAIL.** There are 0 S1 bugs, but **4 S2 issues are still open**:
- **R2-4** (partly fixed): the CEO answer still ends with "Guardrail failed". This happened on 2 of 2 fresh runs.
- **R2-3** (still broken): the Aurora answer still shows the revenue conflict row, with the €412M / €398M table.
- **BUG-10** (partly fixed): the Evidence register still prints raw `[source:N]` markers.
- **R3-2** (still broken): clicking tour "Go" to another page still leaves a ghost panel that blocks clicks.

Everything else in scope works:
- R2-7, R3-1, R3-3, R2-11, R3-7, BUG-36, R3-5, R3-9, R3-10 and R3-11 are all verified fixed.
- The admin panel is clean: all 16 admin routes (plus `/api-catalog`) load at 1280 with 0 JS console errors.
- The demo path works end to end.

| | |
|---|---|
| Build | `feat/truth-suite-demo` @ `99a4cc7` (fix round 3: lanes F3r `c9f912d` and B3 `99a4cc7`) |
| App | Already running with a fresh seed. `:5173`, demo workspace `db54884b-a083-460b-9f92-176a96fd301b`. At the start: 6 docs, Radar 4 open / 0 / 0, `warm:true`, model qwen3:4b-instruct. |
| Date | 2026-09-28 |
| Tooling | Playwright MCP (Chromium), with a separate browser context for every logged-out check. Real local LLM, one question at a time. |
| Personas | One-click Analyst (workspace owner) and Admin, plus a freshly registered `viewer4_qa` invited **by email**. Its password is only in `scratchpad/qa4-creds.txt`. |
| Screenshots | `$QA4` = `/private/tmp/claude-501/-Users-nikunjvaghasiya-SGP-TruthLens-AI--claude-worktrees-user-agent-reach-improve-fd209b/818b146a-b404-4aa6-ab8f-442350d7a541/scratchpad/qa4/` (69 PNGs). Console logs are in `…/scratchpad/qa4-artifacts/`. |

## Verdicts

### S2 items

| Item | Verdict | Evidence |
|---|---|---|
| **R2-4** (no "Guardrail failed" when an answer honestly reports both values) | **PARTIAL (still open)** | **3 of 4 now pass:**<br>• Revenue: "Answer verified", trust 85.<br>• Emissions: "Answer verified", 4/4 verified. C4 "…either 34% or 41%…" is VERIFIED 1.00.<br>• Aurora: "Answer verified", trust 76.<br>**The CEO answer still fails, on 2 of 2 fresh runs:**<br>• Run 1: C4 "Thus, the start date of Dana Whitfield's tenure as CEO is disputed:" → **CONTRADICTED 0.00** (trust 48).<br>• Run 2 (Regenerate): C4 "Thus, the sources provide conflicting information:" → **UNSUPPORTED 0.00**.<br>Both answers list both dates correctly (March 2021 [2] / January 2022 [1]) and say "The sources disagree". CEO is a demo suggested question. `$QA4/S2-ceo.png`, `S2-ceo-regen.png` |
| **R2-3** (Aurora answer has no revenue row; revenue shows €14M; emissions shows 7 pts) | **STILL BROKEN** | Revenue shows 1 D-row, €14M ✓. Emissions shows 1 D-row, 7 pts ✓.<br>**Aurora is unchanged from round 3:**<br>• D2 "Annual Report 2025 vs … Results" has the table "€412 million / €398 million · Difference €14M".<br>• C1 is chipped "Differs from Annual Report 2025".<br>• The stored page `/workspaces/:id/queries/58ca5d97…` also shows 2 D-rows.<br>The cause is below. `$QA4/S2-aurora.png` |
| **R2-7** (investigation report is complete and lists all 4 planted conflicts) | **VERIFIED FIXED** | "Compare the key findings … identify conflicts" finished in **192.7 s**. `final_report` is 8,601 characters and ends cleanly on the closing "*Note: …*" line; nothing is truncated. "2. Contradictions Found" lists all 4: revenue €412M/€398M, CEO March 2021/January 2022, Aurora Q3 2027/Q1 2028, and emissions 34%/41%. Each is also covered in Detailed Findings. The Capex item is now framed as "distinct figures", not a conflict. Case `f89da79a-845d-45b7-ad3e-845b54a5c567`. `$QA4/S2-investigate-done.png` |
| **BUG-10** (finished case file shows no raw `**` or `[source:N]`) | **PARTIAL (still open)** | **Research ledger: fixed.** It renders as markdown, with 0 `**`, and citations appear as [1] and [2].<br>**Evidence register: still broken.** S1–S12 each show `“[source:1]”`, `“[source:2]”` and so on as the quoted span: **12 raw markers**, confirmed again after a reload. `$QA4/S2-BUG10-evidence-register.png` |
| **R3-1** (revenue "View in document" highlights the revenue sentence; "Why partial" doesn't claim €412M is missing) | **VERIFIED FIXED** | C1 evidence is now "Revenue in 2025 was €412 million." "View in document" calls `/locate?text=Revenue in 2025 was €412 million.`, and the PDF viewer boxes exactly that sentence on AR p.1, not the title. In "Why C1 is partial", **412 and million are underlined as in source**; only Northwind, Renewables', reported, as, the, Annual and Report are flagged. `$QA4/D02-view-in-doc-revenue.png`<br>Residual on another answer, filed as R4-1 (S3): Aurora C2 evidence is still "Date: 8 December 2025". |
| **R3-2** (tour "Go" to another page leaves no ghost panel; header stays clickable) | **STILL BROKEN** | Reproduced 4 of 4 times: workspace chat → Radar, `/chat/:id` → Radar, Radar → chat, and a repeat check at a normal 61 fps.<br>• After Go, `#demo-tour-panel` stays mounted at **opacity 1 for more than 3 s**.<br>• The toggle reads `aria-expanded="false"`.<br>• `elementFromPoint(800,150)` hits the panel, so it covers the page header and title area (x 676–996, y 50–312).<br>• The top-bar controls themselves are still clickable.<br>• When the tour is opened normally, Esc and outside clicks do close it. `$QA4/R3-2-after-go-verify.png`, `R3-2-after-go-{1,2,3}.png` |
| **R3-3** (Members action menu fully visible; role change and Remove member clickable) | **VERIFIED FIXED** | The menu is portaled to `<body>` at 170×137 px. All 3 controls pass the hit-test: Role select, Copy User ID and Remove member.<br>• Role change viewer → editor with a pointer: `PUT …/members/:id` returned **200** and the card updated to EDITOR.<br>• A pointer click on Remove member removed the member (audit `workspace.remove_member`).<br>• Remove member has **no confirm**, filed as R4-2 (S3). `$QA4/R3-3-member-menu.png` |

### S3 items

| Item | Verdict | Evidence |
|---|---|---|
| R2-11 | **VERIFIED FIXED** | On `/admin/users/:id` (viewer4_qa), role user → admin → user went through both confirms. Both `PUT …/role` responses carry `last_login_at`, and "Last Login" stayed "Sep 28, 2026, 11:40 PM" throughout. `$QA4/R2-11-user-detail-after-role.png` |
| R3-7 | **VERIFIED FIXED** | Audit row `workspace.member_role_update · demo_analyst · workspace_member#7e3c6412 · {"user_id":…,"old_role"…}` appears on both `/admin/audit-log` and the `/admin` Audit tab. Minor: the Action filter has no option for it (R4-3). `$QA4/R3-7-audit-log.png` |
| R3-4 | **STILL BROKEN** | The answer lists **4 of 5** (Solheim, Lindholm, Aurora, Fjellheim) and **misses Ashford Solar**, yet shows "Answer verified". Latency 10.0 s.<br>• The new summary chunk exists (#24): "status = Construction: Aurora, Fjellheim Repowering, Solheim Solar Park, Ashford Solar, Lindholm Solar".<br>• It was **not retrieved**: the top 5 were 4 row chunks plus Nordvik.<br>• Its header is the storage UUID, "Bea4A6B7 9718 48F8 Af30 30368087Ab8F — status = …", and it lacks the "project pipeline … construction/permitting status" line that row chunks carry. `$QA4/S3-pipeline.png` |
| BUG-36 | **VERIFIED FIXED** | The `/admin` dashboard Audit Logs tab now has a **User** column with names (demo_admin, demo_analyst, viewer4_qa). `$QA4/BUG36-admin-dash-audit.png` |
| BUG-38 | **PARTIAL** | The table container at 1280 is still **scrollWidth 1008 vs clientWidth 982, so it scrolls by 26 px** (was 35). The last cell's right edge sits at x=1281, and the chevron column is cut off behind a visible horizontal scrollbar. Sizes no longer wrap ("918 B", "139.5 KB"). The page and `<main>` themselves don't scroll. `$QA4/BUG38-admin-docs-1280.png` |
| R3-5 | **VERIFIED FIXED** | In "Read as prose", the pipeline answer renders a real `<ul>` with 4 `<li>`. The CEO answer's list also stays on separate lines. `$QA4/S3-R3-5-prose-pipeline.png` |
| R3-6 | **PARTIAL** | The revenue receipt shows only the revenue pair (€14M) ✓. The **Aurora receipt still lists the unrelated revenue pair** next to the Aurora pair: 2 pairs, down from 5. It shares the R2-3 relevance function. `$QA4/R3-6-aurora-receipt.png` |
| R3-8 | **PARTIAL** | Fixed: "API Server: Operational" now comes from `useReady` (`/health/ready`), and the WebSocket row is gone.<br>Still fabricated:<br>• "**Background Jobs 2 Active**" with a pulsing dot comes from static `CATALOG_STATS`.<br>• Quick Test still shows `curl -X POST https://api.truthlens.ai/…`.<br>`$QA4/R3-8-api-catalog.png` |
| R3-9 | **VERIFIED FIXED** | At 375 px, all 5 workspace tabs show `document`, `body` and `<main>` horizontal overflow = **0**. The tablist scrolls on its own (`overflow-x:auto`, 221 px). Residual: `/workspaces/:id/documents/:docId` `<main>` still overflows by 12 px (header row, S3 carry-over). `$QA4/R3-9-members-375.png`, `R3-9-docdetail-375.png` |
| R3-10 | **VERIFIED FIXED** | At 375 px the popover sits at x=16 to 359 (inside the viewport). The heading reads "Presenter tour" in full, the checkboxes are at x=33, and the "Tour 0/5" button is a single line (30 px). `$QA4/R3-10-tour-375.png` |
| R3-11 | **VERIFIED FIXED** | Right after sealing, the same dialog lists the new receipt under "Existing receipts for this answer" with a revoke button.<br>• Revoke → "Revoke? Cancel / Confirm" → **DELETE 204**, and the row shows REVOKED. Tested on the Aurora receipt immediately after creating it, and on the revenue receipt.<br>• `/r/<token>` then returns **410 "Receipt revoked"**. `$QA4/D03-seal-created.png`, `R3-11-revoke-0.png` |

## Regression smoke at 1280

**Protected and admin routes (37), as Admin, a workspace editor:** all render with doc/main horizontal overflow of 0, **0 JS console errors, 0 page errors**, and no 4xx/5xx. The one exception is the expected pair of 404s on `/admin/users/<bogus>`. The routes:
- `/dashboard`, `/workspace` → `/workspaces`, `/chat` → `/chat/new`, `/chats`, `/chat/:id`, `/documents`, `/settings`
- `/workspaces/:id` and all 5 tabs
- `…/documents/:docId` (+`?chunk=`), `…/review-queue`, `…/chat`, `…/investigate`, `…/investigate/:caseId`, `…/queries/:id`
- `/api-catalog`
- All admin routes: `/admin`, `/admin/documents`, `/admin/documents/upload`, `/admin/documents/:id` (+ bogus id), `/admin/collections`, `/admin/users`, `/admin/users/invite`, `/admin/users/:id` (+ bogus id), `/admin/settings`, `/admin/analytics`, `/admin/audit-log`, `/admin/prompts`, `/admin/golden`
- The Analytics Overview / RAGAS / Usage tabs and the `/admin` Evaluation tab were also clicked, with 0 errors.

Screenshots: `$QA4/R_admin*-1280.png`.

**Public and logged-out routes (16), in a clean context:** all render with 0 JS errors:
- `/`, `/login`, `/signup`, `/register`, `/forgot-password`, `/reset-password`, `…?token=bogus`, `/privacy`, `/terms`, `/contact`
- `/r/<valid>`, which shows "Seal intact"
- `/r/<bogus>`, which returns 404 and the not-found state
- `/nonexistent`, which shows the 404 page
- Logged-out `/dashboard`, `/admin` and `/admin/settings`, which redirect to `/login`
- `/r/<revoked>` was checked separately and returns 410.

**Console summary for the whole session:** 0 JS errors. The only `Failed to load resource` lines were:
- the expected `/admin/users/<bogus>` 404 pair;
- 2 × 404 from my own API probes;
- one 401 pair (`/auth/me`, `/auth/refresh`) on the very first landing load in the persistent browser profile. This did not happen again in any clean context.

The warnings were the 2 known React Router v7 future-flag warnings.

### Demo path: PASS, apart from the tour aid

| Step | Result |
|---|---|
| Landing → "Try the live demo" | ✓ Reached `/workspaces/db54884b…/chat` in **185 ms**. |
| Suggested revenue question → ledger | ✓ First prose at **12.3 s**, done at **19.3 s** (UI "18.5 s"). "Answer verified", trust 85/100, 1 verified + 1 partial, and 1 D-row with "€412 million / €398 million · Difference €14M". |
| View in document | ✓ The PDF viewer boxes "Revenue in 2025 was €412 million." (R3-1). |
| Seal receipt → `/r/<token>` logged out | ✓ POST 201, with link, QR and existing-receipt row. Logged out: "VERIFIED ANSWER RECEIPT · Seal intact — verified in your browser · Guardrail passed — 99%", and "Sources disagree" shows **only** the revenue pair (€14M). No `/auth` calls and no horizontal scroll at 1280 or 375. `$QA4/D04-receipt-public-1280.png` |
| Radar tab | ✓ **Open 4** / Dismissed 0 / Resolved 0, all 4 planted pairs. `$QA4/D06-radar.png` |
| Tour "Go" (presenter aid) | ✗ Leaves a ghost panel (R3-2). |

## Latency (local qwen3:4b-instruct, one question at a time)

| Question | First prose | Done (wall) | UI label |
|---|---|---|---|
| Revenue | 12.3 s | 19.3 s | 18.5 s |
| Emissions | 9.9 s | 19.5 s | 18.9 s |
| CEO | 10.7 s | 19.3 s | 18.8 s |
| CEO, cache replay | – | 0.56 s | Cached |
| CEO, Regenerate | – | 16.0 s | – |
| Aurora commissioning | 8.4 s | 19.0 s | 18.5 s |
| Pipeline under construction | – | 10.0 s | `latency_ms` 10033 |
| **Investigation** (6 steps) | – | **192.7 s** | `latency_ms` 187923 |

- The investigation is **about 47% slower** than round 3 (128 s). This comes from the synthesis budget being raised to 2048 tokens, and is filed as R4-5.
- Landing → demo chat: 185 ms.
- One-click Admin → `/admin`: 44 ms.

## Root causes for the open items (file:line)

Paths are relative to the worktree root.

- **R2-4, CEO (S2).** The lead-in sentence of a list is scored as a claim on its own:
  - `backend/app/generation/guardrail.py:42`: `_META_DISAGREEMENT_RE` only matches `disagree*|discrepanc*`. "…provide conflicting information:" and "…is disputed:" are not excluded, even though they are the same kind of meta statement.
  - `guardrail.py:48-54`: `_ALTERNATIVES_CUE_RE` has no `disput*`. Also, `_alternative_values` requires 2 or more numbers inside the lead-in sentence itself.
  - `guardrail.py:177`: `if len(text) > 15` drops the list items "March 2021" and "January 2022" (10 and 12 characters) **before** `_merge_fragment_spans` (`:208-219`) can fold them into the lead-in. The fragment merge therefore only works for items longer than 15 characters, such as "First quarter of 2028".
  - Suggested fix: treat a claim ending in ":" that is followed by list items as a meta lead-in (exclude it the same way as `_META_DISAGREEMENT_RE` at `:433-436`), and/or run the fragment merge before the length filter.
- **R2-3 and R3-6 (S2 / S3).** `frontend/src/components/ledger/conflicts.ts:64-73`:
  - `isAboutSameFact` builds its token pool from `claim.text` **plus `claim.evidence`** (`:65`) and returns `true` on a single shared number (`:69`).
  - Aurora C1's evidence is the press-release bullet run-on ("• Full-year revenue of €398 million … • … Q3 2027"), so "398" matches the revenue contradiction's side B.
  - The public receipt uses the same test through `isConflictRelevantToClaims` (`:80-85`).
  - Suggested fix: match numbers against `claim.text` only, or require the shared number to be one of the contradiction's disputed figures **and** to appear in the claim text.
- **BUG-10, Evidence register (S2).**
  - `frontend/src/pages/InvestigationPage.tsx:420-423`: `citationExcerpt` falls back to `chunk?.excerpt`, but the API's `sub_questions[].retrieved_chunks[]` carry **`content`**, not `excerpt`. Live payload keys are `chunk_id`, `document_id` and `content`, stored raw by `backend/app/graph/investigation.py:411`.
  - As a result the fallback always yields `citation.text`, which is `[source:N]`.
  - `frontend/src/api/types.ts:345` types these items as `Source[]`, so the unit test mocked `excerpt` and passed.
  - Suggested fix: read `chunk?.excerpt ?? chunk?.content`.
- **R3-2 (S2).** `frontend/src/components/DemoTour.tsx:234-241`: `<AnimatePresence>` plus `motion.div exit={{opacity:0,y:-8}}` is unchanged.
  - The round-3 change only added a close-on-route-change during render (`:152-156`), and "Go" still does `<Link onClick={collapse}>` (`:277-280`).
  - The exit animation is still interrupted by the same-tick route change, so the panel is never removed.
  - Suggested fix (the round-3 suggestion was not applied): drop the `exit` and `AnimatePresence`, key the panel on `location.pathname`, or `navigate()` after the collapse commits.
- **R3-4 (S3).**
  - `backend/app/ingestion/loader.py:158-159`: `_csv_title()` uses `path.stem`, which is the **storage UUID filename**, so the summary chunk header is "Bea4A6B7 9718 …".
  - `:166-193`: `_csv_summary_pages` doesn't include the CSV's own description line (the `#` comment that row chunks prepend).
  - Together these rank the summary chunk out of the top 5 (`backend/app/config.py:69` `RETRIEVAL_RERANK_K = 5`).
  - The unit test presumably used a real `project-pipeline.csv` filename, so it passed.
  - Suggested fix: pass the document's `original_filename`/title into the loader and prepend the description line.
- **BUG-38 (S3).** `frontend/src/pages/AdminDocumentsPage.tsx:334`: the table inside `overflow-x-auto` is still 26 px wider than its container at 1280.
- **R3-8 (S3).** `frontend/src/components/api-catalog/RightPanel.tsx`:
  - `:80` hard-codes the curl host `https://api.truthlens.ai`.
  - `:150-156` renders "Background Jobs {CATALOG_STATS.backgroundJobs} Active" with a live pulse from static catalog data.

## New findings (round 4). All S3.

- **R4-1 · S3 · chat ledger, Aurora answer.** The evidence for C2 ("…Board Memorandum dated 8 December 2025 states … first quarter of 2028…") is the memo header "**Date: 8 December 2025**", not "Aurora is now expected to commission in the first quarter of 2028."
  - This is an R3-1 residual. `_pick_evidence` ranks numeric overlap first: the header shares 8 and 2025, while the fact sentence shares only 2028.
  - `_is_heading_like`, which already classifies "Date: …" as heading-like because it has no terminal period, is only consulted to break ties.
  - Location: `backend/app/generation/guardrail.py:293-301`.
  - Suggested fix: exclude heading-like lines before ranking, not only on ties.
- **R4-2 · S3 · workspace Members.** "Remove member" removes immediately with no confirm, unlike revoke, deactivate and delete elsewhere in the app. Location: `frontend/src/pages/WorkspaceDetailPage.tsx:1444-1448` (`removeMemberMutation.mutate` on click).
- **R4-3 · S3 · audit filters.** The new `workspace.member_role_update` action has no entry in the Action filter lists: `frontend/src/pages/AdminDashboard.tsx:98-99` and `frontend/src/pages/AdminAuditLogPage.tsx:36-37`.
- **R4-4 · S3 · chat ledger, CEO answer.** The claim text reads "According to source, she became CEO…" and "However, source states…". Stripping the `[source:N]` marker from "source [source:1]" leaves a dangling "source". The marker strip is at `backend/app/generation/guardrail.py:176`. Cosmetic.
- **R4-5 · S3 · investigation latency.** It rose from 128 s to **188–193 s** after `INVESTIGATION_SYNTHESIS_MAX_TOKENS` went from 1280 to 2048 (`backend/app/config.py:191`). The report is complete now, but the demo takes more than 3 minutes. Consider about 1600 tokens, or putting Contradictions first, which the prompt already does.

## Side effects / cleanup

- **Receipts:** both receipts I created (revenue and Aurora) were revoked (DELETE 204), and both `/r/<token>` links now return 410.
- **`viewer4_qa`:**
  - Registered (201), then invited by email as viewer (201).
  - Workspace role changed to editor (200), then removed from the workspace.
  - Global role went user → admin → user.
  - **Deactivated** (`PUT …/status` 200). The account still exists, inactive. Delete it from `/admin/users/feb5f7fa-…` if you want it gone.
- **Workspace state:** 6 docs, Radar 4 open / 0 / 0 (untouched), members back to demo_analyst and demo_admin.
- **Left in place (as in round 3):**
  - The analyst's 5 QA chat queries. They show in "Recent", and the revenue answer is cached, so the demo revenue question will replay from cache.
  - Investigation case `f89da79a-…`.
  - The CEO answer (trust 48) is in the **Review Queue (count 1)**, and the sidebar shows a "1" badge.
  - Reseed before a live demo if a pristine state matters.
- **Browser and files:** the browser is closed. `.playwright-mcp/` was removed from the worktree, and its console logs were moved to `scratchpad/qa4-artifacts/`. No code was changed.
