# Implement design C "Claim Ledger" in the real app

The user compared three prototypes and chose **C · Claim Ledger**. Visual + interaction spec =
`artifacts/ui-prototypes/chat-redesign/c-claim-ledger.html` (open it, read its CSS tokens/markup/JS — it is the source of truth for
look and behaviour; states 1–5, light/dark, 375px). Context on why: `briefs/DESIGN-chat-redesign.md` (problems 1–6 must all be gone).
Common rules: `briefs/COMMON.md` (graft first, TDD, commits with Co-Authored-By, no new deps). Frontend only — do NOT touch backend/.
The machine has 16 GB RAM shared with a running demo + local LLM: run vitest on changed files while iterating, the full frontend gate
(`npm run typecheck && npm run lint && npm run test:run && npm run build`) once at the end. Never run backend tests.

## Backend facts you build against (already merged)
- WS `progress` frames: `{phase: "retrieval"|"ranking"|"generation"|"guardrail", progress, found?, kept?, words?, elapsed_ms?}`;
  `sources` items carry `conflicts` (open Radar contradictions on that chunk); `guardrail` carries `claims: Claim[]` +
  `unsupported_claims`; `trust_score` `{score, components{retrieval_quality, faithfulness, relevance, source_authority}}`;
  `complete` `{latency_ms, model_used, ...}`; `error` codes include `EMPTY_ANSWER` (retryable) and `CANCELLED`.
- `Claim` type in `src/api/types.ts` (text, start, end, verdict supported|partial|unsupported|contradicted, entailment, contradiction,
  source_index 1-based, chunk_id, document_id, document_name, page_number, evidence). `QueryDetail.claims` for history.
- Radar: `radarApi.get(workspaceId, 'open')` → contradictions with `a/b {document_id, document_name, chunk_id, page_number, sentence}`.
- Source viewer: `useSourceViewer().open({workspaceId, documentId, chunkId, documentName, pageNumber})` (drawer already built).
- Citations arrive as `[source:N]` (backend now splits merged ones; still parse `[source:1:2]`/`[source:1, 2]` defensively).
- Demo corpus doc names all start with "Northwind Renewables — …" → short titles must strip the shared prefix + extension.

## Lane D2 — tokens, fonts, app shell (owns `src/index.css`, `src/components/Layout.tsx`, `src/components/ui.tsx`, other pages' styling)
1. Port C's palette (light "paper" + dark blue-black) and type (IBM Plex Sans; Plex Sans Condensed for stamps/column heads;
   Plex Mono for hashes; tabular numerals for figures) into `index.css`, keeping existing token NAMES so every page re-skins.
   Add C's new tokens (verdict inks/tints, stamp, rule colours). Update the Google Fonts import. Keep the `opacity: 0.99` WAAPI rule.
2. `Layout.tsx` shell per C: ONE top bar (TruthLens mark; inside a workspace the workspace name as a breadcrumb/switcher with doc
   count; global search ⌘K; theme toggle) — the old second search row disappears. Sidebar per C: "New chat", nav (Dashboard, Chat
   History, My Documents, Workspaces, Review Queue, Settings), "Recent" chats (from existing history API), user menu at the bottom;
   collapses to icons on narrower screens, drawer on mobile.
3. Sweep EVERY other page (landing, auth, dashboard, workspaces + tabs incl. Radar, documents, review queue, investigate, admin
   pages, receipt page, 404) for regressions from the new tokens: hard-coded colours/gradients/purple glows, contrast in both themes,
   fonts. Fix at the token level first; touch page files only where a hard-coded value fights the system. Screenshot-free: reason from
   code + grep for hex/rgb/`purple|violet|indigo` classes.
4. Tests: update/keep green; add a Layout test for the single header + workspace breadcrumb.

## Lane D1 — chat as a Claim Ledger (owns `src/pages/ChatPage.tsx`, `src/pages/ChatDetailPage.tsx`,
`src/components/truth-lens/*`, new `src/components/ledger/*`, `src/utils/docTitle.ts`, their tests; may stop using
`EvidenceSidebar` in chat — don't delete the file)
1. Remove the chat-local header (VeritasRAG title, "Chat active" pill, Sources button, panel toggle). Centred ~880px conversation
   column, composer docked beneath it at the same width ("Ask about the <workspace> documents", doc-scope chip). D2 owns the top bar.
2. Live run: "How this answer was verified" audit trail driven by the progress frames (Searching → N found; Ranking → top K of N;
   Writing → word count; Verifying → x of n claims), live timers, aria-live; exhibits skeleton until sources arrive. NEVER show a
   "no evidence" state while running. After completion it collapses to a one-line record ("4 steps, 7.8 s") that expands.
3. Answer streams as prose, then when `guardrail.claims` arrive it settles into the **Claim Ledger** (C's animation: stamps press in,
   reduced-motion respected). Toggle "Claim ledger | Read as prose" (persist in localStorage with try/catch; prose view keeps
   citation chips + small verdict icons). No claims (e.g. model offline, abstention) → prose only, no ledger.
4. Ledger rows: No. (C1…), verdict stamp (VERIFIED / PARTIAL / UNSUPPORTED / CONTRADICTED, icon + word) + score bar, claim text
   (figures emphasised), evidence quote + "[n] Short title, page p" link → source viewer. Expandable row: side-by-side claim vs
   source with shared words underlined and claim words absent from the evidence flagged "(not in source)"; "View in document".
5. Conflicts: fetch open Radar contradictions for the workspace once; when two claims' chunks form a contradiction pair (or a claim's
   source has `conflicts > 0` and the pair partner is another cited chunk) draw C's red bracket + "≠" between the rows and a
   "Differs from C4" note; show the D-row detail (both figures + difference when numeric).
6. Summary chips (3 verified · 1 partial · 1 conflict), Exhibits list (48px rows: [n], short title, page, one relevance number,
   conflict flag or "Not cited"), Trust totals block (score + 4 components, accounting-rule styling), actions row (Seal receipt,
   Copy, Export, 👍/👎, Regenerate), `EMPTY_ANSWER`/errors → clear message + Retry, abstention card kept, reconnect badge/stop/cancel
   kept, empty state with `SuggestedQuestions` (click sends).
7. `ChatDetailPage`: same ledger/prose/exhibits/trust from stored data (audit record shows latency only).
8. `src/utils/docTitle.ts`: `shortDocTitle(name, allNames?)` — strip extension, shared "Company — " prefix, trim; full name on hover.
9. Tests: rewrite/extend `ChatPage.test.tsx`, `ChatDetailPage.test.tsx`; unit tests for docTitle, ledger row rendering, conflict
   pairing, prose/ledger toggle, audit trail from progress frames, EMPTY_ANSWER retry.

## Both
Match C closely but production-grade (React + Tailwind v4 idioms already in the repo). Accessibility: AA contrast, focus visible,
verdict never colour-only, keyboard (rows expand with Enter, Esc closes), 44px touch targets on mobile. Report per COMMON.md with
branch, commits, gate output, and a list of anything from C you could not implement.
