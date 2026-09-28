# QA Playwright report: full-app sweep (demo mode)

**STATUS: FAIL (3 S1 blockers).** Receipt sealing crashes the app, PDF highlights are drawn mirrored, and the search modal locks the UI after you pick a result.

| | |
|---|---|
| Build | `feat/truth-suite-demo` @ `68ccdfb` |
| Stack | frontend `:5173` (Vite) and backend `:8000`, both running from this worktree |
| Demo workspace | `ae7efa84-…` (6 docs) |
| Date | 2026-09-28 |
| Tooling | Playwright MCP (Chromium). One browser, plus isolated contexts for the logged-out, viewer and editor checks. |
| Viewports | 1280×800, 375×812, plus 768, 900 and 1024 for the rail and drawer |
| Screenshots | `$QA` = `/private/tmp/claude-501/-Users-nikunjvaghasiya-SGP-TruthLens-AI--claude-worktrees-user-agent-reach-improve-fd209b/818b146a-b404-4aa6-ab8f-442350d7a541/scratchpad/qa/` (~210 PNGs) |
| Raw logs, downloads, snapshots | `…/scratchpad/qa-artifacts/` |
| Bug list | `QA-playwright-bugs.md` (62 bugs: S1 3 · S2 22 · S3 37) |

## Summary

| Metric | Result |
|---|---|
| Routes visited | **43**, each at 1280 and 375. That is 13 public (including `/r` valid, revoked and bogus), 16 protected and 14 admin. |
| Routes passed | **34 PASS** (several with S3 notes) and **9 FAIL** |
| Bugs | **S1 3 · S2 22 · S3 37** |
| Planted contradictions, Radar | **4/4 found**: revenue, emissions, Aurora, CEO |
| Planted contradictions, chat ledger | **2/4** get a conflict row (emissions, CEO). Revenue and Aurora are missed (BUG-5). |
| Fresh conflicting upload (2 conflicts) | **0/2** detected by auto-scan or full scan (BUG-16) |
| First answer | **11.3 s** (revenue question, demo analyst) |
| Console | 97 errors: 90 are 401s from `/auth/me`/`/auth/refresh` on logged-out pages, 6 are expected 404s from bogus-id checks, and 1 is a 409 from the prompt eval gate. There were also 2 React render crashes (BUG-1) and 340 React Router future-flag warnings. No 5xx for any legitimate action. |

## Route × result

| Route | 1280 | 375 | Result | Notes |
|---|---|---|---|---|
| `/` | ✓ | ✓ | PASS | Features/Workflow scroll works. "Try the live demo" logs in and lands in the demo chat in 132 ms. BUG-48, BUG-58 |
| `/login` | ✓ | ✓ | PASS | Empty and wrong-credential validation OK. One-click Analyst → workspace chat; Admin → `/admin` |
| `/signup`, `/register` | ✓ | ✓ | PASS | Required-field validation. Registered viewer_qa and editor_qa |
| `/forgot-password` | ✓ | ✓ | PASS | BUG-45 (duplicate error, icon layout) |
| `/reset-password` (none / bogus token) | ✓ | ✓ | PASS | Handles a missing token, a mismatch, and "Invalid or expired reset token" |
| `/privacy`, `/terms`, `/contact` | ✓ | ✓ | PASS | Static pages; `/contact` has no form |
| `/r/<valid>` (logged out) | ✓ | ✓ | PASS | "Seal intact — verified in your browser"; Download PDF calls `window.print`; print CSS OK. BUG-4 citation split |
| `/r/<revoked>` | ✓ | – | PASS | Returns 410 and shows "Receipt revoked". BUG-47 |
| `/r/<bogus>` | ✓ | ✓ | PASS | Returns 404 and shows "Receipt not found". BUG-47 |
| `/nonexistent` | ✓ | ✓ | PASS | BUG-46 copy |
| logged-out → any protected route | ✓ | ✓ | PASS | Redirects to `/login` |
| `/dashboard` | ✓ | ✓ | PASS | BUG-50 (trust scale) |
| `/workspace` → `/workspaces` | ✓ | ✓ | PASS | |
| `/chat` → `/chat/new` | ✓ | ✓ | PASS | Workspace picker |
| `/chats` | ✓ | ✓ | PASS | Pin/unpin OK. BUG-12 (delete without confirm), BUG-41 |
| `/chat/:queryId` | ✓ | ✓ | **FAIL** | Seal receipt crashes (BUG-1). BUG-22 |
| `/workspaces/:id/queries/:queryId` | ✓ | ✓ | **FAIL** | Same page as above (BUG-1, BUG-22) |
| `/documents` | ✓ | ✗ | PASS | Filter chips and search OK. 375 overflow (BUG-25) |
| `/settings` | ✓ | ✓ | PASS | Password mismatch, short-password and wrong-current checks OK. BUG-56 |
| `/workspaces` | ✓ | ✗ | PASS | New-workspace validation and Esc OK. 375 overflow (BUG-25) |
| `/workspaces/:id` (Documents / Activity / Radar / Members / Settings) | ✓ | ✓ | **FAIL** | Viewer sees Upload (BUG-14). Invite needs a UUID (BUG-15). BUG-30, BUG-54, BUG-55 |
| `/workspaces/:id/documents/:docId` | ✓ | ✓ | **FAIL** | Viewer opens, but highlights are mirrored (BUG-2) |
| `…/documents/:docId?chunk=` | ✓ | – | **FAIL** | Deep link opens the viewer on the right doc and page; highlight wrong (BUG-2). A bogus chunk is ignored gracefully |
| `/workspaces/:id/review-queue` (+ Quarantine) | ✓ | ✓ | PASS | Mark reviewed and Promote to golden OK. BUG-9, BUG-34, BUG-51 |
| `/workspaces/:id/chat` | ✓ | ✓ | **FAIL** | BUG-1 crash, BUG-4 streaming. The rest of the ledger works |
| `/workspaces/:id/investigate` | ✓ | ✓ | **FAIL** | Case file is created (241.8 s), but the report renders raw markdown (BUG-10). Export .md and Audit Bundle work, with Content-Disposition |
| `/api-catalog` (admin) | ✓ | ✓ | PASS | BUG-44 (stale). Non-admin is redirected to `/dashboard` |
| `/admin` | ✓ | ✓ | PASS | Refresh works; Audit and Evaluation tabs work. BUG-19, BUG-42 |
| `/admin/documents` | ✓ | ✓ | PASS | Search, tag filter, select-all, bulk tag/untag, reindex confirm and delete confirm all OK. BUG-37, BUG-38 |
| `/admin/documents/upload` | ✓ | ✓ | PASS* | .txt reaches `ready` in about 1 s. CSV is rejected (BUG-23) |
| `/admin/documents/:docId` | ✓ | ✓ | PASS | Delete confirm OK. Page is thin (BUG-38) |
| `/admin/collections` | ✓ | ✓ | **FAIL** | Create only; no edit, delete or add-document (BUG-18) |
| `/admin/users` | ✓ | ✓ | PASS | List and search OK |
| `/admin/users/invite` | ✓ | ✓ | PASS | Invalid email is rejected (duplicate native + custom message). A valid invite goes through (201) |
| `/admin/users/:userId` | ✓ | ✓ | PASS | Role change and deactivate/activate work. BUG-35, BUG-39 |
| `/admin/settings` | ✓ | ✓ | **FAIL** | Saves do nothing (BUG-11) |
| `/admin/analytics` (Overview / RAGAS / Usage & Cost) | ✓ | ✓ | PASS | Usage group-by (user, workspace, model), sort and date range work. CSV has Content-Disposition. **No `abstain` model row** ✓. BUG-43, BUG-57 |
| `/admin/audit-log` | ✓ | ✓ | PASS | Action and resource filters, row expand, pagination, CSV and JSON export (with Content-Disposition). New rows are present: `receipt.create`, `radar.scan`, `auth.demo_login`. BUG-36 |
| `/admin/prompts` | ✓ | ✓ | PASS | Full cycle works: draft, then promote blocked (409 "no eval run"), smoke eval (16.5 s, passes), promote, second draft, promote, rollback ×2, delete. BUG-39, BUG-40 |
| `/admin/golden` | ✓ | ✓ | PASS | Promoting from the review queue as admin auto-approves. Pending/Approved/All filters and Delete confirm work |
| Plain user and viewer → `/admin/*` | ✓ | – | PASS | Redirects to `/dashboard` |

Breakpoints: the rail appears at 1024 (64 px) and the drawer below 1024. Neither causes a horizontal page scroll. The drawer closes on Esc but doesn't trap focus (BUG-61). The mobile viewer is a full-screen sheet.
Themes: dark mode checked on the ledger, D-row, radar, dashboard and receipt. A contrast scan found no text below 3:1.
Keyboard: the skip link works, the Tab order is sane, and focus rings are visible on every stop sampled (30 stops).

## Feature deep checks

| Area | Check | Result |
|---|---|---|
| Demo pack | Landing "Try the live demo" logs in and opens the demo chat | PASS (132 ms) |
| | One-click Analyst → chat; Admin → `/admin` | PASS |
| | Warm-up toast | SKIP (backend already warm; `warm:true`) |
| | Suggested questions are Northwind-specific and clicking sends | PASS, but 1 of 6 abstains (BUG-7) |
| | Tour: steps, "Go" links, checkboxes persist on reload, Hide | PASS. Stale copy (BUG-20), Esc / no restore (BUG-33), overlap (BUG-21) |
| Claim Ledger | Audit trail shows live steps, then collapses to "4 steps, 11.3 s" | PASS |
| | Answer streams as prose, then settles into the ledger | PASS, with the citation split (BUG-4) |
| | "Claim ledger / Read as prose" toggle persists (`truthlens:answer-view`) | PASS |
| | Rows: stamp, score, claim, quote, source link → viewer | PASS. Bar invisible (BUG-28), 0.00 on PARTIAL (BUG-26), long names (BUG-8) |
| | Row expand ("Why verified / partial") | PASS |
| | Conflict rows and "Differs from Cn" cross-links flash the target row | PASS for emissions and CEO. Literal "D" (BUG-27), unit missing (BUG-29), coverage gap (BUG-5) |
| | Exhibits, trust totals | PASS |
| | Seal receipt | **FAIL** (BUG-1) |
| | Copy | Partial: copies raw `[source:N]` (BUG-9) |
| | Export | PASS: downloads `.md`, but with raw markers |
| | 👍/👎 | PASS: 201 and a toast, but no pressed state or `aria-pressed` |
| | Regenerate | Only offered on cached answers (BUG-31) |
| | Stop → Retry | PASS: cancel frame sent, "Stopped before verification", Retry works (32 s) |
| | Abstention card (off-corpus question) | PASS (3.5 s); the evidence score is repeated twice |
| | Stored-answer pages show the same as live | Partial (BUG-22) |
| Source viewer | Opens from ledger, exhibit, radar, doc detail and `?chunk=` | PASS |
| | PDF renders; page nav, zoom, Download (named file) | PASS |
| | Highlight on the cited passage | **FAIL**: mirrored and chunk-wide (BUG-2, BUG-17) |
| | Esc closes and focus returns to the trigger | PASS |
| | DOCX and MD open in text mode with a mark | PASS (mark covers the whole chunk) |
| | Mobile | PASS (full-screen sheet) |
| Truth Receipt | Seal from the UI | **FAIL** (crash) |
| | Receipt created through the API, then opened logged out | PASS: "Seal intact — verified in your browser" |
| | Issuer shown | PASS ("TruthLens AI") |
| | Content matches the chat answer | Partial: the D-row is not included, verdict names differ ("Supported" vs "Verified"), BUG-4 |
| | Download PDF | PASS (`window.print` called once) |
| | Print media | PASS: clean layout with QR and seal hash |
| | Revoke (API), then open | PASS (410, "Receipt revoked") |
| | Bogus token | PASS |
| | UI copy link, QR and revoke | Untestable, blocked by BUG-1 |
| Contradiction Radar | Tab badge "Radar (4)" | PASS |
| | 4/4 planted conflicts found | PASS |
| | Diff highlight on the differing figure | PASS |
| | View A/B opens the viewer | PASS, highlight wrong (BUG-2) |
| | Dismiss and resolve update Open/Dismissed/Resolved counts and the badge | PASS. No reopen (BUG-62) |
| | Full scan: progress, then done | PASS (about 4 s; 17 chunks, 48 pairs) |
| | Viewer role sees no actions | PASS (API returns 403) |
| | Upload a new conflicting doc; auto-scan picks it up | **FAIL**: scan runs but finds 0 (BUG-16) |
| | Chat source from a conflicted chunk shows a conflict note | Partial: live exhibits tag "Conflict", ledger note missing (BUG-5), stored view drops the tag (BUG-22) |
| Regression | Review queue and quarantine | PASS (BUG-9, BUG-34, BUG-51) |
| | Investigations | Report renders raw markdown (BUG-10) |
| | Comparisons ("Re-run comparison") | PASS (8 s), raw markers |
| | Admin prompts, analytics, usage (no `abstain` row), audit export, bulk document ops, upload, golden set | PASS (see route table) |
| | Settings, password change | PASS (see route table) |
| | Logout | PASS; Back after logout stays on `/login` |
| Role gating | Viewer can't upload, scan or edit (server-side) | PASS |
| | Viewer UI hides Upload | **FAIL** (BUG-14) |
| | Editor sees Radar actions; Settings are owner-only | PASS |
| | Logged-out → `/login`; plain user → no admin | PASS |

## Per-question answer latency
Local qwen3:4b-instruct, measured end to end in the browser from click to verification complete. Questions were asked one at a time.

| Question | First token | Done | UI shows | Tokens | Tally | Conflict row |
|---|---|---|---|---|---|---|
| Revenue 2025 (first answer) | – | 11.5 s | 11.3 s | ~26 (9 words) | 1 verified | ✗ (BUG-5) |
| Aurora commissioning | 6.6 s | 15.4 s | 15.2 s | 117 | 2 verified, 2 partial | ✗ |
| Emissions vs 2020 | 7.4 s | 17.5 s | 17.1 s | 178 | 2 verified, 2 partial, 1 unsupported, 1 conflict | ✓ D (41% vs 34%, "7") |
| CEO + start date | 7.5 s | 14.7 s | 14.4 s | 87 | 2 verified, 1 partial, 1 contradicted, 1 conflict | ✓ D (no figures) |
| Pipeline under construction | – | 3.6 s | abstained | 1 | – | – (BUG-7) |
| Key Aurora risks | 6.0 s | 17.4 s | 17.1 s | 234 | 4 verified, 2 partial | – |
| Off-corpus ("capital of Australia") | – | 3.5 s | abstained | – | – | – |
| Free text "Summarise the Aurora memo in detail" (after Stop → Retry) | – | 32.1 s | 32.0 s | long | 12 verified | – |
| Repeat of the revenue question (cache hit) | – | 0.25 s | 43 ms "Cached" | – | – | – |
| Investigation (5 sub-questions) | – | 241.8 s | – | – | trust 40 | – |

## Visual fidelity vs `c-claim-ledger.html` (top gaps)
Prototype rendered locally: `$QA/P4-proto-ledger.png`, `P5-proto-ledger-light.png`, `P6-proto-ledger-mid.png`, `P8-proto-inprogress.png`.

1. **Conflict treatment.**
   - Prototype: a red bracket on the left links the conflicting rows; "≠ Differs from C4" chips sit next to an underlined figure; the D1 row carries a short-titled source table and "Difference €14M".
   - App: a literal "D"; full document names; a difference with no unit ("7"); only a row tint; no bracket.
   - Conflicts are often absent altogether (BUG-5/27/29/8).
2. **Verdict score bars.**
   - Prototype: a coloured bar per verdict (green 0.97, amber 0.62).
   - App: bars render empty grey (BUG-28), and PARTIAL rows show 0.00 (BUG-26), which reads as "no support".
3. **Ledger layout.**
   - The column header row (No. / Verdict / Claim in the answer / Evidence in the source) is missing.
   - The evidence link is centred and uses the full name ("[2] Northwind Renewables — Annual Report 2025, page 1") instead of left-aligned "[1] Annual Report 2025, page 3".
4. **Exhibits.**
   - Prototype: short titles, a page number per row, "Conflicts with [2]", "5 passages ranked from 16", and skeleton rows while ranking.
   - App: long names; no page numbers on fresh answers (cached answers show them); a bare "Conflict" with no counterpart; no exhibits skeleton during streaming.
5. **In-progress state and stored view.**
   - Prototype: a vertical timeline connector, per-step durations ("0.4 s"), hollow pending dots, "Verifying claims", and prose skeletons.
   - App: flat grey dots, no per-step timing, "Verified claims" while still pending, and prose broken by block citations (BUG-4).
   - Stored answers use the legacy "Chat Detail" chrome with no tally chips or action bar (BUG-22).
   - Minor: the account row shows "User" instead of "Analyst" with a "…" menu, and the tour pill covers it.

## Console / network summary
- **401s (90).** `GET /api/auth/me` + `POST /api/auth/refresh` fire on every logged-out page (BUG-48). One wrong-current-password check produced 401 → refresh → 401 (BUG-56).
- **404s (6, all intentional).** Bogus receipt token, bogus document id, and member lookup by email.
- **409 (1, intentional).** Prompt promote blocked by the eval gate.
- **403s (intentional).** Every viewer write attempt was rejected correctly (upload, scan, radar PATCH, receipt create), and the viewer quarantine read also returned 403 (BUG-34).
- **Render crashes.** 2, both `TypeError: existing.filter is not a function` in SealReceiptButton (BUG-1).
- **5xx.** None.
- **Warnings.** Only the React Router v7 future-flag warnings.
- **Downloads with Content-Disposition.** Usage CSV, audit CSV, audit JSON, and investigation audit bundle (.zip). The chat Markdown export and the case-file .md are client-side blobs with sensible names.
- **`/api/health/ready`.** Once per session while warm; CEO #6 was not reproduced (see bug file).

## Side effects left in the demo DB (cleanup notes)
- **Added:** users viewer_qa, editor_qa (members of the demo workspace as viewer/editor) and invite.qa@example.test; 9 analyst queries and 1 comparison; 1 investigation case file.
- **Prompts:** v2 is active with default content (hash e6a3e4340696, identical to the built-in default).
- **Reindexed:** the Project Pipeline CSV.
- **Reverted:**
  - Workspace docs are back to 6; the QA uploads were deleted.
  - Radar statuses were reopened; the 4 contradictions are open.
  - The QA collection, QA golden entry and prompt v1 were deleted.
  - The CEO query review status was set to reviewed.
  - The test receipt was revoked.
  - The "capital of Australia" chat was deleted (as the Delete test).
- **Credentials:** the QA test password is kept only in the scratch notes (`scratchpad/qa-creds.txt`).
