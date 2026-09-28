# L2 — Truth Lens frontend

Owned: `frontend/src/pages/ChatPage.tsx`, `frontend/src/pages/ChatDetailPage.tsx`, `frontend/src/api/websocket.ts`,
new `frontend/src/components/truth-lens/*`, their tests. Additive edits to `src/api/types.ts` allowed.

Backend contract (lane L1): WS `guardrail` frame payload adds `claims: Claim[]` and `unsupported_claims: string[]`;
`QueryDetail.claims`. WS `sources` items may carry `conflicts: number` (lane L5). Claim type is in `api/types.ts`.

Build:
1. `websocket.ts`: guardrail case passes `claims` + `unsupported_claims` through `onGuardrail`; sources pass `conflicts`. Update types + `websocket.test.ts`.
2. Extract the answer renderer (`renderMessageWithCitations` + `CitationHoverCard`, ChatPage.tsx ~1503-1658) into
   `components/truth-lens/AnswerBody.tsx` so ChatPage and ChatDetailPage share it (ChatDetailPage today shows raw `[source:N]` text — fix).
3. Truth Lens:
   - Under a finished answer with claims: summary chip, e.g. "5 claims · 4 verified · 1 unsupported" + "Truth Lens" toggle
     (lens icon). Toggle state global, persisted in localStorage (wrap in try/catch). Default OFF.
   - Lens ON → answer rendered as paragraphs (split on blank lines) of segments cut by claim `start/end`; claim segments styled by
     verdict — supported: soft green underline/tint; partial: amber dashed underline; unsupported: red wavy underline;
     contradicted: red + ⛔ icon. Non-claim text normal. Keep `[source:N]` chips working inside segments.
   - Hover/focus a claim → card: verdict label + icon, entailment %, evidence quote, doc name + page, "View in document" →
     `useSourceViewer().open({workspaceId, documentId, chunkId, documentName, pageNumber})` (scaffold hook; lane L8 makes it real),
     and a "⚠ Another document disagrees" note when the claim's source has `conflicts > 0`.
     Keyboard: claims focusable, Enter/hover opens, Esc closes; aria-describedby.
   - "Claim ledger" collapsible list under the answer: every claim with verdict chip; clicking scrolls to + flashes the span
     (claims with start = -1 appear only here).
   - Lens appears only after the guardrail frame (not during streaming). Abstentions/failed answers: no lens.
4. Mount `<SealReceiptButton queryId=… />` (scaffold stub; lane L4) in the answer action row (near export) when a query id exists and not abstention — ChatPage and ChatDetailPage.
5. Empty chat: render `<SuggestedQuestions workspaceId onPick={q => send(q)} fallback={EXAMPLE_QUESTIONS} />` (scaffold stub; lane L10).
   Clicking must SEND immediately (today it only fills the input).
6. ChatDetailPage: markdown + citations via AnswerBody, lens from stored `claims`, SealReceiptButton.

Tests (vitest, reuse `MockQueryWebSocket` in ChatPage.test.tsx): lens chip counts; toggle renders verdict spans at right offsets;
hover card shows evidence + calls `open`; suggested question click sends; ChatDetailPage renders markdown (no raw markers) + lens.
