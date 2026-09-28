# Exhaustive Playwright sweep — whole app (branch feat/truth-suite-demo after all lanes merged)

User's ask: "test this whole project with playwright browser — check UI, UX, function, everything should work properly."
Goal: click EVERY page, button, link, tab, modal, form, export and keyboard path; confirm no console errors, no 4xx/5xx for
legitimate actions, every action produces the expected outcome, UX is clear. File one `BUG-n` per defect in
`../reports/QA-playwright-bugs.md`: `BUG-n · S1/S2/S3 · page · steps · expected vs actual · evidence (screenshot path in your
scratch dir, console/network line) · suspected file:line (use graft ask/grep)`. S1 = broken feature/crash/data loss/security,
S2 = wrong behaviour or confusing UX on a main path, S3 = polish.

## Boot (demo mode — also tests the demo pack itself)
- `./run.sh --demo` from the repo root (log any friction as bugs: missing steps, crashes, slow first answer, unclear output).
  If run.sh itself is broken, record S1 and boot manually with the demo env overrides it documents.
- Demo accounts: use the one-click Analyst/Admin buttons on /login (never type or print passwords).
- Extra users for role checks: register `viewer.qa@truthlens.dev` + `editor.qa@truthlens.dev` via /register (generate a password,
  keep it in your scratch notes only). Owner (analyst) adds them to the demo workspace as viewer/editor in Members tab.

## Route inventory — visit ALL (from frontend/src/App.tsx)
Public: `/`, `/login`, `/signup`, `/register`, `/forgot-password`, `/reset-password`, `/privacy`, `/terms`, `/contact`,
`/r/<token>` (valid, revoked, bogus), `/nonexistent` (404).
Protected: `/dashboard`, `/workspace`, `/chat`, `/chat/new`, `/chats`, `/chat/:queryId`, `/documents`, `/settings`, `/workspaces`,
`/workspaces/:id` (tabs documents/activity/members/settings/**radar**), `/workspaces/:id/documents/:docId` (+`?chunk=`),
`/workspaces/:id/review-queue`, `/workspaces/:id/chat`, `/workspaces/:id/investigate`, `/workspaces/:id/queries/:queryId`.
Admin: `/api-catalog`, `/admin`, `/admin/documents`, `/admin/documents/upload`, `/admin/documents/:docId`, `/admin/collections`,
`/admin/users`, `/admin/users/invite`, `/admin/users/:userId`, `/admin/settings`, `/admin/analytics` (all tabs), `/admin/audit-log`,
`/admin/prompts`, `/admin/golden`.

## Per-page checklist
1. Renders without console errors (check console after load; ignore Vite HMR noise).
2. Every visible control used once: buttons, links, tabs, menus, tooltips (hover), modals (open → cancel → confirm), forms with valid
   AND invalid input (validation shown), Escape closes overlays, Enter submits chat, keyboard Tab order sane + visible focus.
3. Role gating: viewer can't edit/scan/upload; plain user redirected from admin routes; logged-out → /login; `/r/<token>` works logged out.
4. Network: no 5xx; 4xx only for intentionally invalid input; downloads/exports carry Content-Disposition.
5. Responsive: every page at 1280×800 AND 375×812 — no horizontal page scroll, nav/sidebars usable, drawers become sheets.
6. Theme: key pages in dark and light (toggle) — contrast readable, no invisible text.

## Feature deep checks (must all PASS)
- **Demo pack**: landing "Try the live demo" logs in + lands in demo chat; login one-click Analyst → chat, Admin → /admin;
  warm-up toast shows then clears; suggested questions are Northwind-specific and clicking SENDS; presenter tour steps + links work,
  checkboxes persist on reload, Hide works; first answer latency noted (seconds).
- **Truth Lens**: ask each suggested question; answer streams; claim summary chip counts match ledger; toggle lens → spans colored by
  verdict at correct text; hover/focus claim → evidence card; "View in document" opens viewer; ledger click scrolls + flashes;
  toggle persists across reload; history page `/chat/:queryId` shows markdown (no raw `[source:N]`) + lens.
- **Source viewer**: from evidence sidebar, hover card, radar, doc detail page, `?chunk=` deep link. PDF page renders, highlight boxes
  sit ON the cited passage (screenshot proof), page nav, zoom, download original, Esc closes + focus returns; DOCX/MD/CSV → text mode
  with mark; mobile sheet.
- **Truth Receipt**: Seal receipt → warning copy → create → link + copy + QR; open link in a fresh logged-out context → "Seal intact —
  verified in your browser" + issuer valid; content matches the chat answer; Download PDF (print dialog/`window.print` invoked;
  check print CSS via emulated print media screenshot); revoke → link shows revoked state; bogus token → not-found state.
- **Contradiction Radar**: Radar tab badge; planted conflicts found (revenue €412M vs €398M; emissions −34% vs −41%; Aurora Q3 2027
  vs Q1 2028; CEO since March 2021 vs January 2022) — record which are found/missed; diff highlight; View A/B open viewer on the right
  passage; dismiss/resolve + filter counts; run full scan → progress → done; viewer role sees no actions; upload a new doc with a
  fresh conflicting fact → auto scan picks it up; chat source from a conflicted chunk shows the conflict note.
- **Regression of existing features**: chat stop/retry/regenerate/copy/export/feedback, abstention card on off-corpus question,
  review queue (+ quarantine tab), investigations, comparisons, admin prompts/analytics/usage (no `abstain` model row)/audit export/
  documents bulk ops/upload/golden set, settings, password change, logout.

## Tooling
Playwright MCP (`mcp__plugin_playwright_playwright__*`) or the `playwright-cli` skill. Screenshots only in your scratch dir. Use graft
(`graft ask "<symptom>" --source`) to point each bug at file:line. Don't fix code — report only.

## Report
`../reports/QA-playwright-report.md`: route × result table (PASS/FAIL/SKIP + note), feature deep-check table, bug list, console-error
summary, planted-contradiction recall, first-answer latency. Return STATUS, counts (routes visited/passed, bugs S1/S2/S3), top 5 bugs.
