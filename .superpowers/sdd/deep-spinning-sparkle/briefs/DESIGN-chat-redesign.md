# Chat + Evidence redesign — prototype brief

The user looked at the live chat screen (dark theme) and said: "I don't like it — give me a prototype for this UI/UX."
You produce ONE self-contained, clickable HTML prototype for your assigned direction. No build step, no framework
(vanilla HTML/CSS/JS; Google Fonts OK; no other external assets). Output file given in your prompt. Do NOT touch any
other file in the repo. This is a design exploration, not production code.

## What the user saw and why it fails (fix ALL of these in every direction)
1. Header says "VeritasRAG" (old product name) + a "Chat active" pill — should show TruthLens + the workspace
   ("Northwind Renewables — Due Diligence") and nothing noisy.
2. Two stacked header bars (global search bar + chat header) waste vertical space; chat column not centred;
   huge empty canvas; composer floats at bottom-left.
3. While the answer is being produced, the evidence panel shows a yellow "⚠ NO EVIDENCE" badge plus "Upload more
   documents / Rephrase / Expand scope" tips — looks like failure. The wait is a single "Thinking…" bubble with no
   progress even though the backend reports stages.
4. Duplicate controls: "Sources" button + Sources tab + panel toggle do the same thing.
5. Source cards: every title truncates to "Northwind Renewab…" (all docs share that prefix) so exhibits are
   indistinguishable; 4 redundant numbers per card (Relevance 94%, shield 100%, "Strong Evidence", "Score 100%");
   each card ~400px tall so only 1.5 fit; excerpt in a clashing serif; mono doc names.
6. At ~800px width the evidence panel overlaps the chat column.

## The product (what must be visible and delightful)
TruthLens = a private, offline "verified answers" engine. Differentiators to make obvious on this screen:
- **Live pipeline** during the wait: Searching passages (16 found) → Ranking (top 5) → Writing answer → Verifying claims (4).
  Real latency on the demo laptop: rank ~2s, write ~5–10s, verify ~2s. Make the wait feel purposeful.
- **Truth Lens**: every sentence/claim of the answer gets a verdict — supported ✓ / partial ~ / unsupported ✗ /
  contradicted ⛔ — with hover/focus revealing the exact evidence sentence + doc + page, and "View in document"
  (opens the PDF page with the passage highlighted).
- **Citations** `[1]` inline, linked to sources.
- **Conflict flag** (Contradiction Radar): a source that another document contradicts is flagged, e.g. the annual
  report says revenue €412M but the Q4 press release says €398M.
- **Trust score** (0–100) with components: retrieval quality, faithfulness, relevance, source authority.
- Actions: Seal receipt (tamper-evident shareable proof), Copy, Export, 👍/👎, Regenerate.
- Empty state: 6 suggested questions for this workspace (click sends).

## Real demo content (use it verbatim — no lorem ipsum)
Workspace: **Northwind Renewables — Due Diligence** (6 documents). User: demo_analyst.
Documents (use SHORT distinct titles in UI; full name on hover):
1. Annual Report 2025 (PDF, 6 pages) — full: "Northwind Renewables — Annual Report 2025"
2. Q4 & FY2025 Results press release (PDF, 2 pages) — "Northwind Renewables Reports Fourth-Quarter and Full-Year 2025 Results"
3. 2025 Sustainability Report (PDF, 4 pages)
4. Board memo: Aurora update (DOCX)
5. Leadership Team (MD)
6. Project Pipeline (CSV)
Suggested questions: "What was Northwind Renewables' revenue in 2025?" · "When is the Aurora offshore wind project expected
to be commissioned?" · "How much has Northwind reduced its emissions intensity versus 2020?" · "Who is the CEO and when did
they start?" · "Which projects in the pipeline are under construction?" · "What are the key risks facing the Aurora project?"

Question: **What was Northwind Renewables' revenue in 2025?**
Answer (markdown, with citations):
"Northwind Renewables reported revenue of **€412 million** for 2025 [1], up from €356 million in 2024 [1]. Growth came
mainly from a full year of the Kestrel Ridge onshore expansion [1]. Note that the Q4 & FY2025 results press release gives a
different figure of **€398 million** [2] — the two sources disagree."
Claims (verdict · evidence · source):
- "Northwind Renewables reported revenue of €412 million for 2025." · supported 0.97 · "Revenue in 2025 was €412 million." · [1] Annual Report p.3
- "up from €356 million in 2024" · supported 0.94 · "This was up from €356 million in 2024." · [1] Annual Report p.3
- "Growth came mainly from a full year of the Kestrel Ridge onshore expansion." · partial 0.62 · "Revenue growth was driven by a full year of contribution from the Kestrel Ridge onshore expansion…" · [1] Annual Report p.3
- "the press release gives a different figure of €398 million" · supported 0.95 · "Revenue in 2025 was €398 million." · [2] Q4 & FY2025 Results p.1 — this source has a Radar conflict with [1]
Sources (one relevance number each): [1] Annual Report 2025 · p.3 · 94 · conflict ⚠ with [2]; [2] Q4 & FY2025 Results · p.1 · 91 ·
conflict ⚠ with [1]; [3] Sustainability Report · p.1 · 76; [4] Sustainability Report · p.2 · 57; [5] Q4 & FY2025 Results · p.2 · 52.
Excerpt for [1]: "Revenue in 2025 was €412 million. This was up from €356 million in 2024. Total generation reached 5.9 TWh…"
Trust: 86 — retrieval 86, faithfulness 100, relevance 50, source authority 100. Model qwen3:4b (local), 7.8s.
Previous chats in history: "When will Aurora be commissioned?", "Emissions intensity vs 2020".

## Required states (switchable in the prototype via a small floating state switcher, and keyboard 1–5)
1. Empty (suggested questions)
2. In progress (pipeline stepper live-animating through stages, streaming text appearing)
3. Answered — Truth Lens OFF (clean prose + citations + claim summary like "3 verified · 1 partial · 1 conflict")
4. Answered — Truth Lens ON (verdict styling on claims; one claim's hover card open showing evidence + "View in document")
5. Source detail open (the evidence item for [1] expanded or the document viewer with the highlighted passage — your call)
Plus: a **mobile 375px** rendering of state 4 (side-by-side frame or a width toggle) and a **light + dark** toggle
(the app supports both; the user's screenshots were dark).

## Constraints
- App shell must still exist (left nav: Dashboard, Chat History, My Documents, Workspaces, Settings, Review Queue; user
  menu) but it can be slimmer/collapsible — the chat is the hero.
- Accessible: contrast AA, visible focus, verdicts not by colour alone (icon + label), reduced-motion respected.
- Realistic, production-plausible UI (it will be implemented in React + Tailwind v4 next) — no impossible effects.
- Avoid generic "dark purple glass SaaS" look unless your direction explicitly refines it; make it memorable.
- Keep file size sane (< 300 KB; no embedded screenshots/base64 images).
- Existing prototypes for reference/inspiration only: `artifacts/ui-prototypes/*.html` (+ README), current tokens in
  `frontend/src/index.css`, current chat in `frontend/src/pages/ChatPage.tsx`, `frontend/src/components/EvidenceSidebar.tsx`,
  `frontend/src/components/truth-lens/AnswerBody.tsx`.

## Report back
File path, 5-line rationale (what problem each key decision solves), and the 3 things you'd want the user to look at first.
