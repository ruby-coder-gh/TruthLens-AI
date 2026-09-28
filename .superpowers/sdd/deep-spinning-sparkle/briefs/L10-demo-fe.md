# L10 — Demo pack frontend

Owned: `frontend/src/pages/LandingPage.tsx`, `frontend/src/pages/LoginPage.tsx`, `frontend/src/components/SuggestedQuestions.tsx`
(scaffold stub), `frontend/src/components/DemoTour.tsx` (scaffold stub, mounted in Layout), `frontend/src/context/AuthContext.tsx`
(add a demo-login method only), new `frontend/src/hooks/useReady.ts`, tests. Additive `types.ts` edit allowed:
`ReadyStatus.demo_workspace_id?: string | null` (lane L9 returns it).

Build:
1. `useReady()`: react-query on `demoApi.ready()`; poll 5s until `warm`, then 60s; errors → treat as not demo (hide demo UI).
2. AuthContext: `loginDemo(persona)` → `demoApi.login(persona)` then load the user the same way `login` does.
3. LandingPage: when `demo_mode`, hero primary CTA "Try the live demo" → `loginDemo('analyst')` → navigate to
   `/workspaces/{demo_workspace_id}/chat` (fallback `/workspaces`). Keep existing CTAs. Fix dead `href="#"` social links (remove or point somewhere real).
4. LoginPage: when `demo_mode`, a "One-click demo" panel: **Analyst** (asks questions, seals receipts, runs Radar) and **Admin**
   (analytics, review queue, audit) buttons; analyst → demo chat, admin → `/admin`. Loading + error states.
5. `SuggestedQuestions({workspaceId, onPick, fallback})`: `demoApi.suggestions(workspaceId)` → glass chips (stagger in, respect
   the opacity-0.99 rule + reduced motion); fallback on error/empty; click → `onPick(q)`; keyboard accessible.
6. `DemoTour` (only when `demo_mode`, only for logged-in users):
   - While `!warm`: small toast "Warming up models…" with per-model states (embedder / reranker / NLI / LLM) → disappears when warm.
   - Presenter checklist, collapsible pill bottom-left ("Demo tour 2/5"): 1 Ask a suggested question · 2 Turn on Truth Lens and hover
     a claim · 3 "View in document" to see the highlighted passage · 4 Seal a Truth Receipt and open it logged-out · 5 Open
     Contradiction Radar (`/workspaces/{demo_ws}?tab=radar`). Each step has a "Go" link; manual checkboxes persisted in localStorage
     (try/catch); "Hide tour"; doesn't cover the chat input on mobile.
7. Accessibility + dark/light + 375px.

Tests: landing CTA shown only in demo mode and logs in + navigates; login one-click (both personas); SuggestedQuestions fetch/fallback/
click; DemoTour hidden when not demo, warm-up toast states, checklist persistence, hide.
