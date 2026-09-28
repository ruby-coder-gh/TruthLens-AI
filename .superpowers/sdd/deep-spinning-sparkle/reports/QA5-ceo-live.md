# QA5: CEO live verification of the QA4 leftovers

Environment: fresh demo seed (workspace 11853af6-…) and the real local model qwen3:4b-instruct, in the in-app browser at 1440/1280 px. QA4 left 0 S1 and 4 S2 open. All of them, plus two S3s, were fixed and re-checked live.

| Item | Result | Evidence |
|---|---|---|
| R2-4 (S2): CEO answer showed "Guardrail failed" | FIXED | "Answer verified: 3 verified, 2 partial", 1 conflict row, trust 80 |
| R2-3 (S2): Aurora answer showed the revenue conflict row | FIXED | Only the Aurora pair (Board Memo vs press release), trust 87 |
| BUG-10 (S2): raw markers in the investigation case file | FIXED | 0 `[source:N]`; `**` count went from 11 to 1, the one left being an unbalanced marker in the model's own text. The report cites all 4 planted conflicts (412/398, 34%/41%, 2021/2022, 2027/2028). Run time 143 s. |
| R3-2 (S2): tour "Go" left a ghost panel | FIXED | After "Go" to the Radar page, the panel is removed from the DOM and the header is on top at its centre point |
| R3-4 (S3): pipeline question missed a project | FIXED | All 5 construction projects listed, verified at 0.99, 9.0 s |
| BUG-38 (S3): admin documents table scrolled sideways | FIXED | At 1280 px the table's scrollWidth equals its clientWidth (982 = 982) |
| Radar | OK | Exactly 4 planted contradictions and 0 false positives on the fresh seed |
| Console | OK | 0 errors on /admin, /admin/audit-log, /api-catalog and the workspace Members tab |

Gates: backend 1205 passed, 2 skipped, 0 failed, ruff clean. Frontend: tsc and eslint clean, vitest 406 passed, vite build OK.

Known S3 items, accepted:
- **R4-1:** an evidence quote can be a document header line ("Date: 8 December 2025").
- **R4-4:** claim text keeps the model's "According to source, …" wording.
- **Investigation speed:** a run takes 143–190 s. The synthesis budget was raised to 2048 tokens so the report is never truncated.
- **Progress polling:** progress updates pause while the browser tab is hidden (the react-query default) and resume when the tab is focused.
