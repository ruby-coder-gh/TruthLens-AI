# Common rules for every lane (read first)

- Plan + contracts: `../plan.md` ("Shared contracts" section is law — exact names/paths/shapes).
- You run in your own git worktree. BEFORE any edit: `git merge-base --is-ancestor <SCAFFOLD_SHA> HEAD || git reset --hard <SCAFFOLD_SHA>`
  (SHA given in your prompt). Then `git log --oneline -1` and confirm.
- Code navigation: use **graft** (`/opt/homebrew/bin/graft`) before reading source. `graft/` is untracked, so in a fresh worktree run
  `graft build` once (no `--deep`). Then: `graft ask "<how/where X>" --source` (locate + code inline), `graft grep "<symbol>"`
  (every occurrence), `graft skeleton <file>` (file API), `graft callers <sym> --depth 2` BEFORE changing any signature or shared
  function (e.g. `check`, `_save_query`, `process_document_background`). Never pipe graft through head/tail/sed. Read files only at
  the exact spans graft names. If graft fails, fall back to Read/Grep.
- Backend Python: `"/Users/nikunjvaghasiya/SGP/TruthLens AI/backend/.venv/bin/python"` (absolute; no venv in worktrees).
  Run pytest from `backend/`: `"$PY" -m pytest tests/<path> -q`. Full suite at end: `"$PY" -m pytest tests/ -q -p no:cacheprovider`.
  Lint: `"$PY" -m ruff check app/ tests/`. Known env-dependent failure: `test_stream_tokens_no_ollama` (ignore).
- Frontend: `cd frontend && npm ci` first (no node_modules in worktrees). Checks: `npm run typecheck && npm run lint && npm run test:run && npm run build`.
- TDD: failing test first, then code. Every new endpoint/branch gets a test. Reuse fixtures: backend `tests/conftest.py`
  (`test_db`, `test_user`, `admin_user`, `client`, `auth_headers`, `admin_headers`); frontend `src/test/utils.tsx` (`renderWithProviders`), `vi.mock('../api/client')`.
- Stay inside your owned files (listed in your brief). If you truly must touch another file, keep it minimal and call it out in your report.
- DO NOT edit `frontend/src/api/client.ts` (scaffold owns it; if a method is missing/wrong, note it in report and work around in your file).
  Small additive edits to `frontend/src/api/types.ts` are OK if your brief says so.
- Never add columns to existing DB tables (startup uses `create_all`). Scaffold already created the new tables.
- No new dependencies unless your brief allows. Match surrounding code style/comment density. Don't touch the `opacity: 0.99` WAAPI workaround pattern.
- UI: use existing Grounded Glass design tokens/components (`src/index.css` CSS vars, `src/components/ui.tsx`); dark + light; mobile 375px;
  keyboard + screen-reader basics (focus visible, aria labels, Esc closes overlays); honour `prefers-reduced-motion`.
- Commit on your branch in small logical commits (conventional commits). End each commit message with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Final report (terse): branch name, commit SHAs, files changed, test command outputs (tail, verbatim), anything left undone or deviating from contract.
