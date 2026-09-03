# TruthLens AI — UI prototypes (5 directions)

Open any `.html` file directly in a browser. Each is a self-contained pan/zoom canvas with 13 boards on two pages (Screens · Components): Landing, Login, Dashboard, Chat + Evidence, Abstention state, Documents (bulk bar + delete modal), Review Queue (quarantine tab + promote modal), Admin Analytics (Usage tab), Admin Prompts (eval gate + diff), Audit Log, Investigation, Mobile Chat, Component sheet. Toolbar → Export gives PNG per board or one PDF of everything.

| File | Direction | Mood | Palette / type |
|---|---|---|---|
| `chain-of-custody.html` | Chain of Custody | Deposition room in software — every claim has a receipt | Paper `#F7F5F0` / ink `#1A1D23` / green `#2F6B4F`; Source Serif 4 + Inter |
| `signal-room.html` | Signal Room | Mission control for model behaviour — dark, dense, instrumented | `#0B0D10` / accent `#33C2FF`; Geist Sans + Geist Mono |
| **`grounded-glass.html`** ← chosen direction | Grounded Glass | Every answer sits on a visible layer of proof | `#FAFAF9` frosted surfaces / indigo `#4F46E5`; Inter + Newsreader for quotes. **Has a working light/dark toggle on every board** (top-right of each header) |
| `quiet-precision.html` | Quiet Precision | Nothing shouts; hierarchy does the work | White / `#4A55B8` (darkened from `#5E6AD2` for AA contrast); Geist Sans only; icon rail + bottom bulk bar |
| `ledger-and-seal.html` | Ledger & Seal | A governed system that shows its paper trail | `#F6F5F2` / seal-navy `#1E3A5F` / gold `#B08D57` for seal moments; Fraunces + Inter |

All five share the same information architecture and product copy (taken from the current app), so they compare like-for-like. Sources and rationale: `.superpowers/sdd/elegant-prancing-fairy/briefs/UI-inspiration.md`, `UI-product-spec.md`; per-direction notes in each designer `REPORT.md` under the session scratchpad.

## Grounded Glass — verification (the chosen direction)

Measured in headless Chromium against the published file, both themes:

| Check | Result |
|---|---|
| Light/dark toggle | Works on 13/13 boards — `data-theme` flips **and** the paint changes (computed styles, not just the attribute) |
| Controls | 398 interactive elements: **0 broken** by the change (none zero-size, detached, or throwing); the obscured/`disabled` set is byte-identical with the toggle removed |
| Dark contrast | 46 distinct failures → **2**, both non-defects: one `disabled` control (WCAG 1.4.3 exempts these) and one button behind the board's open modal scrim |
| Layout | All 13 frames match `canvas.json` exactly; no overflow in either theme |
| Console | 0 errors at load and while toggling (the 194 recorded entries are sandbox anchor-navigation artifacts provoked by the sweep clicking every link) |

The checker was proved able to fail first: 20 synthetic defects were injected into the live DOM (scrim over the toggle, palette pinned so the attribute flips without repaint, 1.4:1 ink, overflow, removed toggle) and all 20 were caught, 0 missed.

Full report: `.superpowers/sdd/elegant-prancing-fairy/reports/QA-grounded-glass.md`. Per-direction design notes: `grounded-glass-notes.md`.
