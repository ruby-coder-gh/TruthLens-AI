# L8 — Source viewer frontend

Owned: `frontend/src/context/SourceViewerContext.tsx` (scaffold stub), new `frontend/src/components/source-viewer/*`,
`frontend/src/components/EvidenceSidebar.tsx` (add button/chip only), `frontend/src/pages/WorkspaceDocumentDetailPage.tsx`, tests.
Uses `pdfjs-dist` (installed), `documentApi.fileUrl/locate` (or `sourceApi`, check client.ts for the scaffold's exact names).

Build:
1. `SourceViewerProvider` renders a slide-over drawer when `target` set (keep the hook API from the scaffold exactly):
   - Right side, ~720px wide; full-screen sheet < 768px. Header: doc name, "Page x / y", zoom −/+ , "Download original"
     (link to file URL), close. Esc closes, focus trap, `role="dialog" aria-modal`, return focus to opener.
   - PDF mode: lazy `import('pdfjs-dist')`, worker via `pdfjs-dist/build/pdf.worker.min.mjs?url`; `getDocument({url, withCredentials:true})`;
     cache loaded docs per documentId inside the provider; render the target page to a canvas (devicePixelRatio aware); overlay
     highlight boxes from `rects` scaled by the render scale; pulse on open (static under reduced motion); scroll first rect into
     view; prev/next page (highlights only on the target page).
   - Text mode: `context_before` (muted) + `content` (highlighted `<mark>`) + `context_after` (muted), scrolled to the mark.
   - Loading skeleton; errors (file missing / pdf load fail) fall back to text mode using `content`.
2. `EvidenceSidebar`: "View in document" action on each source card (action row ~:501) → `open({workspaceId, documentId, chunkId,
   documentName, pageNumber})`. workspaceId from an optional prop or `useParams`. If `source.conflicts > 0`, a small warning chip
   "Conflicts with another document" (link to `/workspaces/:id?tab=radar`).
3. `WorkspaceDocumentDetailPage`: doc header (name, type, pages, status) + "Open document" + passage list (click → viewer at that chunk);
   `?chunk=<id>` auto-opens the viewer on load.

Tests: provider open/close/Esc; text mode renders mark; pdf mode with `pdfjs-dist` mocked renders overlay boxes at scaled positions;
EvidenceSidebar button calls `open` with right args; conflicts chip; doc page `?chunk=` auto-open.
