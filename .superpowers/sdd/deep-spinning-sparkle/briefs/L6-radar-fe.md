# L6 — Contradiction Radar frontend

Owned: `frontend/src/pages/WorkspaceDetailPage.tsx` (add tab only), new `frontend/src/components/radar/*`, tests.
Uses `radarApi` (client.ts), `useSourceViewer` (scaffold hook), `diff` package (already a dependency) for word diffs.

Build:
1. WorkspaceDetailPage: new `Radar` tab in `TABS` (~:47) + branch in content switch (~:541) with a badge = open count
   (light `radarApi.get` on page load via react-query). Also support `?tab=radar` in the URL to deep-link (read once on mount; keep local state otherwise).
2. `components/radar/RadarPanel.tsx`:
   - Header "Contradiction Radar" + one-line explainer; "Run full scan" (editors only — reuse how the page decides editor/owner).
   - Latest scan: status; while queued/running poll every 2s (react-query `refetchInterval`) and show progress
     (chunks scanned, pairs checked, found) with a radar-sweep animation (CSS conic-gradient rotation; static under reduced motion).
   - Segmented filter Open / Dismissed / Resolved with counts.
   - Conflict card: side A vs side B (stack on mobile): document name + page, sentence with differing words/numbers highlighted
     (`diffWords`), confidence meter (score %), similarity; actions "View A", "View B" → `useSourceViewer().open(...)`;
     Dismiss / Mark resolved (optimistic react-query mutation, rollback on error, toast) — hidden for viewers.
   - Empty states: never scanned (CTA), scanned & none ("No contradictions across N passages" ✓), failed (error + retry).
3. Accessible: buttons labelled, cards as list items, focus-visible, status via aria-live for scan progress.

Tests: renders cards + diff highlight, filter switch refetches/filters, dismiss calls `setStatus` + optimistic update, running scan
shows progress and polls, viewer role hides actions, tab badge count, `?tab=radar` opens the tab.
