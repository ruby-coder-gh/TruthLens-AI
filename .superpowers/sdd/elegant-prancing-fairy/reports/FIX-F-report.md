# FIX-F — BUG-9 FE: surface fully quarantined documents as unsearchable

Worktree: `/Users/nikunjvaghasiya/SGP/TruthLens AI/.claude/worktrees/agent-ae4132d23e15481c9`
Branch: `worktree-agent-ae4132d23e15481c9` (reset to `feat/qa-followups` @ `8003afe`)

## Contract verified

Read `.superpowers/sdd/elegant-prancing-fairy/reports/FIX-D-report.md` and cross-checked
against `backend/app/schemas/document.py` in this worktree: `_SearchabilityMixin` adds a
computed, read-only `is_searchable: bool` (`chunk_count > 0`) to `DocumentResponse`,
`DocumentDetailResponse` and `DocumentStatusResponse`; `quarantined_chunk_count: int` lives
on all three. `status` is unchanged (`pending|processing|ready|failed`).

## Changes

| File | Change |
|---|---|
| `frontend/src/api/types.ts` | Added `is_searchable?: boolean` to `Document`, `DocumentStatus`, `DocumentDetail` (append-only). Added `quarantined_chunk_count?: number` to `DocumentStatus` (was already on `Document`/`DocumentDetail`). |
| `frontend/src/pages/AdminDocumentsPage.tsx` | New `isUnsearchableReady(doc)` helper (`is_searchable === false && status === 'ready' && quarantined_chunk_count > 0`); table status cell now renders an orange `Badge` "Unsearchable" next to the status pill, wrapped in a `<span title="…">` explaining every chunk is quarantined. |
| `frontend/src/pages/AdminDocumentDetailPage.tsx` | Same helper + badge, placed next to the existing status `Badge` in the header (kept the pre-existing red "N chunks quarantined" badge untouched). Fixed the type on `doc` to `Document` (the query returns `documentApi.get`, not `getDetail`). |
| `frontend/src/pages/WorkspaceDocumentDetailPage.tsx` | Same helper + badge, added before the existing red quarantined-count badge in the page-header actions. |
| `frontend/src/pages/DocumentsBrowsePage.tsx` | Same helper + badge, added next to the card's status `Badge` (this page previously rendered a fully-quarantined `ready` document as a plain green "indexed" — now amber "Unsearchable" sits beside it). |
| `frontend/src/pages/AdminDocumentsPage.test.tsx` | New `describe` block: ready+unsearchable renders "Unsearchable" badge (with quarantine-explaining `title`) alongside the unchanged "ready" pill; ready+searchable is unchanged (no badge); `processing`/`failed` with `is_searchable: false` unchanged (no badge — existing state already covers it). |

No other behaviour, layout, or copy changed. Colour is not the only signal — the new badge
always carries the text "Unsearchable".

## Evidence

```
$ npm run test:run
 Test Files  14 passed (14)
      Tests  112 passed (112)
```

```
$ npx tsc -b --noEmit
(no output — clean)
```

```
$ npx eslint .
(no output — clean)
```

```
$ npm run build
✓ built in 359ms
(pre-existing >500kB chunk-size warning only, unrelated to this change)
```

## Commit

`feat(f7a): surface fully quarantined documents as unsearchable` — staged explicitly:
`frontend/src/api/types.ts frontend/src/pages/AdminDocumentsPage.tsx
frontend/src/pages/AdminDocumentsPage.test.tsx frontend/src/pages/AdminDocumentDetailPage.tsx
frontend/src/pages/WorkspaceDocumentDetailPage.tsx frontend/src/pages/DocumentsBrowsePage.tsx`
(node_modules symlink never staged).
