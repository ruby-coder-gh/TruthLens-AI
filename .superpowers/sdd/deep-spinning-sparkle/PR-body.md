## Summary

Makes TruthLens demo-ready and adds the verification features that set it apart. A 60-second local demo runs on a 16 GB laptop with a local model.

**New features**
- **Claim-level Truth Lens.** Every sentence of an answer is checked against the retrieved passages with a local NLI model. Each claim gets a verdict (supported, partial, unsupported or contradicted) plus the exact evidence sentence, document and page. The checker prefixes each passage with its document title, so a chunk that never names its subject can still confirm or refute a claim. Answers that honestly report two conflicting figures are not failed.
- **Chat redesigned as a Claim Ledger** (design C, chosen from three prototypes in `artifacts/ui-prototypes/chat-redesign/`):
  - a live "how this answer was verified" audit trail
  - a ledger/prose toggle
  - conflict rows with real figures (e.g. €14M, 7 pts)
  - exhibits and trust totals
- **Truth Receipt.** A shareable, tamper-evident answer card sealed with SHA-256 and HMAC. It includes the conflicts the answer touches, can be verified in the browser, prints to PDF, and can be revoked.
- **Contradiction Radar.** A workspace-wide scan that finds conflicting facts across documents: it pairs similar passages, keeps same-subject prose sentences, and requires a contradiction in both directions. It runs after every upload, has a Radar tab with dismiss/resolve/reopen, and feeds the chat ledger, receipts and investigations.
- **Source viewer.** "View in document" opens the PDF page (PDF.js) with the cited sentence highlighted, or a text view for DOCX, MD and CSV.
- **Demo pack.**
  - `./run.sh --demo`: bootstraps env/venv/npm, seeds a fictional "Northwind Renewables" corpus with 4 planted conflicts, warms the models and binds the backend to localhost only.
  - Reachable only from loopback: one-click analyst/admin demo login.
  - Guided presenter tour and workspace-tailored suggested questions.
- **Investigations run as background jobs** with live step progress, finishing in ~128 s versus ~242 s before.

**Also fixed along the way**
- The installed `qwen3:4b` is the "thinking" build: it spent the whole token budget reasoning and returned empty answers. The demo now defaults to `qwen3:4b-instruct` (~8–18 s per answer).
- An empty answer is now a retryable error and is never shown as "verified".
- Merged citations like `[source:1:2]` are split into separate citations.
- PDF text is extracted as clean paragraphs.
- CSV files are chunked per row, with column summaries.
- JSON files can be ingested.
- Security audit: 1 medium and 3 low findings, all fixed.
  - Medium: demo login was reachable from the local network; it now accepts loopback only.
  - Receipts: only editors can seal them, and deleting a document revokes receipts that quote it.
  - Page search in large PDFs is bounded.
- Query deletion is restricted to the author, workspace editors/owner and admins.
- New app shell: one top bar, and IBM Plex type with the ledger palette across every page.
- Admin panel:
  - settings persist
  - collections have full CRUD, including managing their documents
  - prompt "restore built-in default"
  - sentence-level prompt diffs
  - confirm dialogs on role changes, deactivation, rollback and revoke
  - names instead of IDs
  - an accurate API catalog

## Test plan

- [x] Backend: `pytest tests/` gives **1205 passed, 2 skipped, 0 failed**; `ruff check` is clean.
- [x] Frontend: `tsc`, `eslint` and `vite build` are clean; `vitest` gives **406 passed**.
- [x] Three exhaustive Playwright sweeps of every route (public, user and all 16 admin routes, at 1280 and 375 px), a targeted fourth recheck, and a final live verification with the real model. Round 1 found 62 bugs; every fix round was re-verified in the browser, and the last round ended with 0 S1 and 0 S2 open. Reports are in `.superpowers/sdd/deep-spinning-sparkle/reports/`.
- [x] Radar on a fresh seed finds exactly the 4 planted conflicts, with 0 false positives.
- [x] Real-model checks: 4/4 planted conflicts are surfaced in chat, and no answer picked a side in 5 revenue runs.

## Known limitations (next sprint)

- Radar matches subjects by word overlap, so paraphrases such as "sales" vs "revenue" can be missed.
- Investigation progress lives in memory and is lost on restart; persisted results are unaffected.
- Detail-page "Regenerate" runs a comparison re-run instead of an in-place regenerate.
- Cosmetic: an evidence quote can be a document header line, and claim text can keep the model's "According to source, …" wording.
- Investigations take ~140–190 s on the local model. The synthesis budget was raised so the report is never cut off.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
