# Grounded Glass — TruthLens AI prototype (D3)

Every answer sits on a visible layer of proof you can lift and check.

## Direction as actually built

**Ground.** A faint ruled substrate — a 32px hairline grid at `rgba(31,35,40,.042)` plus two soft
washes (indigo top-left, green top-right) on `#FAFAF9`. This exists so the frosting has something to
refract; a blurred panel over a flat fill is invisible, and the ruled ground reads literally as the
"layer of proof" underneath the answer.

**Surfaces.** L1 panel `rgba(255,255,255,.60)` + 1px `rgba(0,0,0,.06)` + `blur(16px)`.
L2 card (popovers, evidence cards, source cards) `rgba(255,255,255,.78)` + `blur(20px)`.
**Nothing goes three deep** — tables, inputs, code, quarantine text and modals sit on opaque `#FFFFFF`.

**Palette (light).** bg `#FAFAF9` · ink `#1F2328` · ink-2 `#5A6069` · ink-3 `#666D78` ·
accent `#4F46E5` · trust-high `#16A34A` · trust-med `#D97706` · trust-low `#DC2626`.
Fill colours are never used as text. Text-safe inks: `#166534` · `#9A4508` · `#B91C1C` · `#423BC0`
(`color-mix(in srgb, var(--accent) 84%, #000)`) · neutral `#4A5058`.

**Palette (dark, on the `theme` tweak).** bg `#0F1115` · glass `rgba(255,255,255,.05)` ·
ink `#EDEEF0` · accent `#8B85FF` · high `#34D399` · med `#FBBF24` · low `#F87171`.
Both themes are CSS custom properties in `<helmet>`; the tweak flips one `data-theme` attribute.

**Type.** Inter 400/500/600/700 for all UI. **Newsreader** (serif) **only** for quoted source
excerpts, so sourced text is legible as sourced before you read a word of it. System mono
(`ui-monospace, SFMono-Regular, Menlo…`) with `tabular-nums` for hashes, ids, scores, costs and
quarantine text — no third webfont, so PNG/PDF export never loses a face it cannot embed.

**Scales.** Spacing 4/8/12/16/20/24/32/40/48/64 · radius 6 chip / 10 button+input / 14 card /
20 panel+modal / pill · shadow e1 rest, e2 hover, e3 float · type ramp display 40/44 → eyebrow 10/12.
Written as a comment block at the top of `Components.dc.html`.

**Motion (specified, not animated).** One curve, `cubic-bezier(0.16, 1, 0.3, 1)`.
120ms hover · 150ms evidence-card reveal · 200ms guardrail slide-down · 240ms rail 256↔64 ·
300ms per-word token fade and trust-arc sweep. Active indicators **slide** along a shared rail;
they never cross-fade, because a fade reads as two states being true at once.

**Icons.** Inline stroke SVG on a 16/20/24 grid, `stroke-width` 1.6 rest / 2.1 active. No emoji,
no dingbats, no raster, no `data:` URIs, no network requests except Google Fonts.

## Artboards (13)

| File | Screen | Frame | Content h |
|---|---|---|---|
| `Landing.dc.html` | Landing — trust story as hero, Live Evidence Trace card, one CTA | 1440×2040 | 2007 |
| `Login.dc.html` | Login — plain form + all validation string states | 1440×900 | 900 |
| `Dashboard.dc.html` | User dashboard — KPIs, quick actions, recent chats with trust bands | 1440×900 | 900 |
| `Main.dc.html` | **Chat + evidence sidebar** (hero) | 1440×900 | 900 |
| `Abstention.dc.html` | Abstention card + Abstained timeline step + cancelled + error states | 1440×900 | 900 |
| `MobileChat.dc.html` | Phone chat, evidence as a bottom sheet | 390×844 | 844 |
| `Documents.dc.html` | Documents table, 3 selected, sticky bulk bar, Delete modal open | 1440×900 | 900 |
| `ReviewQueue.dc.html` | Both tabs as stacked regions + Promote-to-golden modal (abstention variant) | 1440×1160 | 1160 |
| `Analytics.dc.html` | Usage & Cost tab active + KPI row + 5 RAGAS scorecards | 1440×1000 | 1000 |
| `Prompts.dc.html` | Versions table + Promote-gate 409 modal + diff as a second region | 1440×1100 | 1100 |
| `AuditLog.dc.html` | Filters, one expanded details row, sealed-tag chips, exports, pagination | 1440×900 | 900 |
| `Investigation.dc.html` | Case workspace — ledger, report, reasoning trace, evidence rail, exports | 1440×900 | 900 |
| `Components.dc.html` | Component sheet + scale comment block + motion + nav-rail spec | 1440×2290 | 2253 |

`canvas.json`: `page-1` "Screens" (5 rows, 120px between frames in a row, 200px between rows),
`page-2` "Components"; `launch: {"view":"canvas","page":"page-1"}`; `expand: "fit"` everywhere;
3 sticky notes (two-layer glass law · sentence-level citations · one-scale-each).

**Tweaks (2 total, both levers, none for copy).** `Main`: `theme` enum (light|dark) + `accent`
colour with 4 curated swatches — the accent drives `--accent-ink` and `--accent-tint` through
`color-mix`, so one swatch recolours the whole board coherently. `Analytics`: `theme` enum only.
Every other artboard is static and carries no `<script data-dc-script>`.

## What the direction actually buys, per screen

1. **Sentence-level citation chips.** `Main` and `Investigation` attach `[n]` to each grounded
   sentence, never at paragraph end. The hovered chip is filled and ringed. Uncited sentences get
   the inverse treatment — dotted underline, dimmed ink, no chip — with an inline legend saying they
   are excluded from exports. That is the whole point: credibility must not bleed sideways.
2. **Hover evidence card.** An L2 frosted popover anchored to chip `[2]`, carrying the exhibit tag,
   the document, `p.14 · §12.2`, the exact quoted span **set in Newsreader**, the evidence band and
   the chunk id, plus "Click to open in source panel".
3. **Trust arc with breakdown.** A 270° arc in the answer's meta row (`93`), with a horizontal
   3-up flyout — grounding 0.96 / consistency 0.91 / source coverage 0.80 — and an 80px ring plus
   the same three bars permanently in the sidebar. Never a bare opaque percentage.
4. **Amber guardrail banner.** Full content width, slides down under the header, `inset 0 3px 0`
   amber cap, carries the reason, an "Expand search scope" action and a dismiss. Never a modal.
   Mirrored compactly on `MobileChat`.

## Corrections applied from the addendum

- Sidebar is **one flat list, 256px**: Dashboard · Chat History · My Documents · Workspaces ·
  Settings · Admin Dashboard · Documents · Upload · Users · Analytics · **Settings (second one,
  reproduced as-is)** · Audit Log · Prompts · Golden Set · Collections · API Catalog — no section
  header, no divider before the admin items. The contextual **Review Queue** with a red count pill
  appears only on workspace boards, immediately before the Quick Links divider.
- **Collapse is the brand block itself** — a `<button>` with `aria-expanded`, `title="Collapse
  sidebar to 64px"` and hint marks. No chevron, no separate toggle. The collapsed 64px rail is drawn
  on `Components.dc.html` beside the 256↔64 spec.
- **Cached chip → Regenerate**: `Main` shows the Cached chip and the `Regenerate with fresh
  retrieval` button together; `Abstention` (not cached) shows Retry instead.
- **Abstention copy verbatim**: "No sufficient evidence" · "Searched 47 chunks across 6 documents ·
  best evidence score 0.31" · "I cannot find this information in your documents." · pill chips
  "Rephrase the question" / "Upload a document" · timeline "Evidence fell below the sufficiency
  floor — no answer was generated."
- **Reconnect badge**: `Reconnecting… (2/4)` with `aria-label="Reconnecting, attempt 2 of 4"`, on
  `Main` and `MobileChat`.
- **Quarantine text is a plain mono text node** (`<pre>`, `white-space: pre-wrap`), on a flat inset,
  with a line stating it is attacker-authored. Never markdown, never rich content.
- **Delete-confirm modal lists filenames** in a scrolling `max-height: 192px` panel — Vendor MSA
  2026.pdf · Security Policy v4.2.pdf · Board Minutes June 28.docx — with chunk counts.

## Verification

Every artboard was rendered in Chrome (fonts loaded) and measured programmatically.

- **Layout.** All 13 boards fit their frames with slack; zero unintended internal clipping.
  Four real bugs were found and fixed this way, not by eye: `Prompts` (modal taller than its table
  region — added a fifth version row and `flex: 0 0 auto`), `ReviewQueue` (52px over — frame to
  1160), `AuditLog` (10px — row padding 9→7), `MobileChat` (73px — sheet 360→400 and the second
  source card compacted to a row). The single remaining `innerClip=3` on `Prompts` is 3px of empty
  table-edge inside a rounded container — no glyph or border is touched.
  The first measurement pass was itself wrong (the harness put `white-space: nowrap` on `<body>`,
  so text did not wrap and heights read ~10% short); it was rebuilt and everything re-measured.
- **Contrast.** 52 composited foreground/background pairs computed through real alpha stacking
  (ink over tint over glass over ground), light and dark: **0 below 4.5:1**, minimum 4.70.
  This caught two failures that hand-checking against the flat background had passed —
  `#15803D` on the green tint (4.32) and `#B45309` on the amber tint (4.30) — now `#166534` (6.14)
  and `#9A4508` (5.57).
- **Canvas.** `--check` output, no warnings:

```
ok: preview-check.html — title "Grounded Glass — TruthLens", 14 files ("Main.dc.html",
"Abstention.dc.html", "Landing.dc.html", "Login.dc.html", "Dashboard.dc.html",
"Documents.dc.html", "ReviewQueue.dc.html", "Analytics.dc.html", "Prompts.dc.html",
"AuditLog.dc.html", "Investigation.dc.html", "MobileChat.dc.html", "Components.dc.html",
"canvas.json")
```

`preview-check.html` was deleted after the check, as instructed.

## Bracketed placeholders (never invented)

`[0.92]` `[50MB]` `[0.93]` `[96]` `[92]` `[98]` `[#A-1742]` (hard-coded landing demo values) ·
`[social-url]` (GitHub/Twitter icons have no hrefs) · `[price]` (no pricing exists anywhere in the
app; the Usage caption keeps its `Estimated —` prefix) · `[year]` (computed, never typed) ·
`[date]` (all `en-US` timestamps) · `[uuid]` (user, workspace and resource ids) ·
`[redacted-pii]` / `[redacted-host]` (audit actor IP; quarantined exfiltration URL).

Realistic sample data that is *not* a placeholder — workspace "Q3 Compliance Review", documents
"Vendor MSA 2026.pdf" / "Security Policy v4.2.pdf" / "Board Minutes June 28.docx" /
"DPA Addendum EU.pdf", `prompt_version a91f3c2e4b7d`, `model_used llama3.2:3b`, trust 0.93 / 0.31 /
0.24, RAGAS 91/84/68/89/78 — is illustrative content, per the brief's instruction to use realistic
sample data.

## Assumptions

- **Deliverable is static mockups**, per the brief ("no working controls needed"). Interaction
  states that would normally require a click — both flyouts on `Main`, three modals, the expanded
  audit row, the open bottom sheet — are drawn open so a reviewer sees them without a prototype.
- The spec describes the as-built app as **dark-only**. This direction is light-first by definition,
  so it re-derives every status colour for AA on light and ships the dark variant as a tweak rather
  than the default. The three governance signals the spec calls non-negotiable — trust score with
  its band label, the citation/evidence link, and the governance state — appear on every screen.
- `ReviewQueue` is 1160 tall rather than the brief's 1100: it renders both tabs as stacked regions
  *and* the Promote modal, and 1100 clipped the last quarantine card. `Landing` (2040) and
  `Components` (2290) likewise follow measured content rather than the brief's estimates.
  Clipping is the only real failure mode; surplus frame just paints the artboard ground.
- `Investigation` copy for the ledger, review-workflow cards and reasoning trace follows the spec's
  structure with plausible case content, since the spec gives labels but no sample case.

---

# Fix round 1

Six items from review, all applied to the working `.dc.html` files. Re-verified: 13/13 boards
tag-balanced, 13/13 fit their frames, `--check` clean, `preview-check.html` deleted.

### 1. BLOCKER — `MobileChat.dc.html` broken div nesting — FIXED

Root cause: the compacted "Exhibit 03" row ended `…81%</span></div></div>`. The second `</div>`
prematurely closed the sheet's content column, which cascaded into a stray `</div>` at the end of
the file. Removed the extra close; the file now ends with exactly two `</div>` (sheet, then root)
before `</x-dc>`, matching every other board.

Verified with a stack-based parser (push on open, pop and match on close, void/self-closing elements
skipped) run over the region between `</helmet>` and `</x-dc>` for all 13 boards:

```
BALANCED  Abstention · Analytics · AuditLog · Components · Dashboard · Documents
BALANCED  Investigation · Landing · Login · Main · MobileChat · Prompts · ReviewQueue
```

Before the fix that same parser reported `MobileChat.dc.html — line 131: stray </div>`, so the check
is non-vacuous.

### 2. `MobileChat.dc.html` had no composer — ADDED

Added a composer bar in normal flow as the last child before the sheet: a 44px-min auto-growing
`textarea` (`aria-label`, placeholder "Ask a question about your documents…", **16px/24** body) and a
44×44 send button with `aria-label="Send message"`. It sits beneath the open evidence sheet, as
permitted. Both hit targets are 44px and the type meets the 16px mobile floor.

### 3. Active nav item: double signal removed — 9 BOARDS

Deleted the absolutely-positioned 3px left accent bar
(`<span aria-hidden="true" style="position: absolute; left: -10px; …">`) from Main, Abstention,
Documents, ReviewQueue, Analytics, Prompts, AuditLog, Investigation and Dashboard. Exactly one
occurrence per board, all removed; the filled tint pill is now the only active signal, so the board
no longer reads as the forbidden rounded-card-with-left-accent-border trope.

**Follow-up for the coordinator (deliberately NOT changed, per "do not change anything else"):**
`Components.dc.html` still illustrates that pattern in two places — the "Item states" row and the
collapsed 64px rail — using `left: -8px` bars, labelled "Active · sliding rail + tint". The nine
screens and the component sheet now disagree. It is a two-span deletion plus a label edit
("Active · tint pill, slides between items") whenever you want it; flagging rather than acting
because it falls outside the stated scope.

**Resolved on approval:** both `left: -8px` accent-bar spans were removed from `Components.dc.html` (the "Item states" row and the collapsed 64px rail) and the label changed from "Active · sliding rail + tint" to **"Active · tint pill, slides between items"** — the sheet and all nine screens now show one active signal. Zero accent bars remain in any board; 13/13 still tag-balanced and frame-fitting (Components 2253/2290, the longer label did not wrap), `--check` clean.

### 4. Code and quarantine surfaces moved to solid — 3 PLACES

The direction's own glass law says code and quarantine text sit on opaque white, never on a tint
inside a glass card. Corrected `background: var(--inset)` → `var(--solid)` on both quarantine
`<pre>` blocks in `ReviewQueue.dc.html` and on the diff panel in `Prompts.dc.html`.

### 5. Guardrail banner body copy sized up

`Main.dc.html` 12.5px/18 → **14px/21** (desktop body floor). `MobileChat.dc.html` 13px/19 →
**16px/24** (mobile body floor). Line-heights raised with the sizes to keep the ramp intact.

### 6. `MobileChat.dc.html` reconnect badge

Added `aria-label="Reconnecting, attempt 2 of 4"`, matching `Main.dc.html`.

### Re-verification after the fixes

Items 2 and 5 both add height, so every board was re-measured in Chrome with fonts loaded rather
than assumed. No new clipping anywhere — Main absorbed the taller banner, MobileChat absorbed the
composer plus the taller banner:

```
Abstention 900/900 · Analytics 1000/1000 · AuditLog 900/900 · Components 2253/2290
Dashboard 900/900 · Documents 900/900 · Investigation 900/900 · Landing 2007/2040
Login 900/900 · Main 900/900 · MobileChat 844/844 · Prompts 1100/1100 · ReviewQueue 1160/1160
```

The only residual is the pre-existing `clip=3` on `Prompts` — 3px of empty table edge inside a
rounded container, touching no glyph or border. Contrast was unaffected (no ink or surface token
changed except inset→solid, which raises contrast).

`--check` output after the fix round:

```
ok: preview-check.html — title "Grounded Glass — TruthLens", 14 files ("Main.dc.html",
"Abstention.dc.html", "Landing.dc.html", "Login.dc.html", "Dashboard.dc.html",
"Documents.dc.html", "ReviewQueue.dc.html", "Analytics.dc.html", "Prompts.dc.html",
"AuditLog.dc.html", "Investigation.dc.html", "MobileChat.dc.html", "Components.dc.html",
"canvas.json")
```

---

## Theme toggle

All 13 artboards now carry a working light/dark toggle. The dark token override on
`.gg[data-theme="dark"]` already existed in every helmet; nothing about it changed. The only
addition is the switch that drives it, plus two colour declarations that the dark block did not
cover.

### The control

One button, identical on every board:

```html
<button type="button" class="fx" onClick="{{toggleTheme}}"
        title="{{themeActionLabel}}" aria-label="{{themeActionLabel}}"
        style="width: 32px; height: 32px; flex: 0 0 32px; display: inline-flex;
               align-items: center; justify-content: center; border-radius: 10px;
               border: 1px solid var(--line-2); background: var(--glass-2);
               color: var(--ink-2); cursor: pointer;">
  <sc-if value="{{isDark}}"  hint-placeholder-val="{{false}}"><!-- sun  --></sc-if>
  <sc-if value="{{isLight}}" hint-placeholder-val="{{true}}"><!-- moon --></sc-if>
</button>
```

- **Size and skin** — 32×32, radius 10, `--line-2` border on `--glass-2`: the same chrome as the
  header search field it sits beside, so it reads as part of the bar rather than an addition.
  44×44 on `MobileChat`, matching that header's two other hit targets.
- **Icon** — inline stroke SVG, 16px, 1.5 stroke, the sheet's icon style. Sun while dark is
  active, moon while light is active: the icon shows the mode you are switching *to*.
- **Name** — `aria-label` and `title` both state the action, and both change with state:
  "Switch to dark mode" / "Switch to light mode". Because the accessible name carries the state,
  the button deliberately does **not** also take `aria-pressed` — the two conventions conflict.
- **Focus** — `class="fx"`, which is the sheet's existing
  `.fx:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`. Keyboard path is
  a plain `<button>`: tab to it, Space or Enter fires it.

### State

Each board's logic class is the same shape:

```js
class Component extends DCLogic {
  currentTheme() {
    var s = this.state || {};
    if (s.theme === 'dark' || s.theme === 'light') { return s.theme; }
    return this.props.theme === 'dark' ? 'dark' : 'light';
  }
  componentDidUpdate(prevProps) {
    if (prevProps.theme !== this.props.theme) {
      this.setState({ theme: this.props.theme === 'dark' ? 'dark' : 'light' });
    }
  }
  renderVals() { /* theme, isDark, isLight, themeActionLabel, toggleTheme */ }
}
```

`state.theme` is seeded from the `theme` prop and flipped by the button. `componentDidUpdate`
re-seeds it whenever the tweak chip changes, so the tweak still sets the *starting* theme and the
button still flips from wherever it lands — the two do not fight. The root binds
`data-theme="{{theme}}"` and the existing override does all the colour work; no token is
redeclared anywhere.

`Main` keeps its `accent` colour tweak, now resolved against the live theme
(`this.props.accent || (isDark ? '#8B85FF' : '#4F46E5')`) so an untouched chip still yields the
dark palette's lighter indigo. Two tweaks on `Main`, one on every other board.

The eleven boards that had no logic class got one, plus a `data-props` declaring a single `theme`
enum (`light` / `dark`, section "Theme") and a `$preview` matching that board's frame in
`canvas.json`.

### Per-board placement

| Board | Placement |
| --- | --- |
| `Main`, `Abstention`, `Dashboard`, `Documents`, `ReviewQueue`, `Analytics`, `Prompts`, `AuditLog`, `Investigation` | Header, right of the search field. The search button and the toggle are wrapped in one `display: flex; gap: 10px` group so the header's existing `space-between` / `flex-end` balance is unchanged. |
| `Landing` | Page header, first item in the existing Sign in / Get Started group. |
| `Login` | No header on this board — pinned `position: absolute; top: 20px; right: 20px` on the root, which took `position: relative`. The centred card layout is untouched. |
| `MobileChat` | Header row, 44×44, between the title and the evidence button. |
| `Components` | Sheet header, after the `v1.0` and `Inter + Newsreader` chips. |

### Colour fixes the dark block did not cover

Two literal inks were hardcoded outside the token system and failed in dark:

1. **`color: #1D4ED8`** — the informational status chip (`pending`, `queued`, `retired`,
   `user.login`, `Running · smoke`, `Trust [0.93]`), on a `rgba(37,99,235,.11)` tint. In dark that
   is a near-black blue on a dark surface, roughly 1.4:1. Switched to `var(--accent-ink)`, which
   is the sheet's documented text-safe ink and already theme-aware. The tint and border are
   translucent and read correctly in both themes, so only the ink declaration changed.
   Affected `AuditLog`, `Components`, `Documents`, `Landing`, `Prompts`.
2. **`color: #0369A1`** — the `investigate` reasoning-step icon square on `rgba(56,189,248,.14)`
   in `Investigation`. Same failure, same fix.

That is a fifth status colour the token block never defined; rather than introduce one, both
declarations now use the existing accent ink.

### One interaction fix

`Documents` renders its delete-confirmation modal, whose scrim is `position: absolute; inset: 0;
z-index: 40` over the whole board. Because the header carries `backdrop-filter`, the header is its
own stacking context and no `z-index` on the button could lift it over that scrim — the toggle was
visible but not clickable. The scrim now carries `pointer-events: none` and the dialog inside it
carries `pointer-events: auto`. Nothing is repainted: the dim and blur are byte-identical, the
dialog still takes its own clicks, and the header underneath is operable again. `Prompts` and
`ReviewQueue` scrims are scoped to inner panels and never covered their headers.

### Verification

Tag balance re-counted per file (`div`, `button`, `span`, `section`, `sc-if` opens vs closes) —
balanced on all 13. Rendered under headless Chromium: every board loaded with no page errors, and
a real mouse click on each toggle flipped `data-theme`, swapped the icon and rewrote the
accessible name. `Components` measures 2268px tall against its 2290px frame, so the added row does
not clip.

```
ok: preview-check.html — title "Grounded Glass", 14 files ("Main.dc.html",
"Abstention.dc.html", "Landing.dc.html", "Login.dc.html", "Dashboard.dc.html",
"Documents.dc.html", "ReviewQueue.dc.html", "Analytics.dc.html", "Prompts.dc.html",
"AuditLog.dc.html", "Investigation.dc.html", "MobileChat.dc.html", "Components.dc.html",
"canvas.json")
```

---

# Dark contrast pass

Closes the 46 distinct dark-mode contrast failures (54 instances, all 13 boards) in
`QA-grounded-glass.md` §4. Every fix is a token in `.gg[data-theme="dark"]`; there is not one
per-element colour override. The light block is byte-equivalent in paint — the two new tokens
resolve to exactly the literals they replaced (`--on-accent: #FFFFFF`, `--link-ink: #4F46E5`,
`--link-ink-h: #3F37C9`), so no light-theme pixel changes.

## Tokens changed

| Token | Light | Dark before | Dark after | Why |
| --- | --- | --- | --- | --- |
| `--on-accent` **(new)** | `#FFFFFF` | — (literal `#FFFFFF` in markup) | `#0F1115` | Ink for text sitting **on** the accent fill. Dark theme wants dark ink on a bright accent, not white. |
| `--link-ink` **(new)** | `#4F46E5` | — (literal `#4F46E5` in the helmet `a{}` rule) | `var(--accent-ink)` → `#A9A5FF` | Inline-link ink, theme-aware. Same bug class as the `#1D4ED8` / `#0369A1` fixes. |
| `--link-ink-h` **(new)** | `#3F37C9` | — (literal `#3F37C9`) | `#C9C6FF` | Link hover, theme-aware. |
| `--ink-2` | `#5A6069` (unchanged) | `#A7ADB8` | `#CFD4DD` | Secondary ink was 4.22:1 on the brightest composited glass. |
| `--ink-3` | `#666D78` (unchanged) | `#8B929E` | `#BFC5CF` | Tertiary ink was 2.65:1 on the brightest composited glass. |

Call sites moved onto the tokens (colour-only, no layout/copy/size change):

- **31** `color: #FFFFFF` declarations → `color: var(--on-accent)`, across 11 boards. Every one of the
  31 sits on `background: var(--accent)` (29) or `var(--accent-ink)` (2) — verified by reading 150
  characters of context at each site; there is no other `color: #FFFFFF` in any board.
- The helmet's `a { color: #4F46E5 }` / `a:hover { color: #3F37C9 }` → `var(--link-ink, #4F46E5)` /
  `var(--link-ink-h, #3F37C9)` on all 13 boards. This *is* the root cause of the two surviving
  light-mode links: `Login` "Create one" and `Dashboard` "View all" carry no inline colour, so they
  inherited the un-themed rule. Literal fallbacks are kept so the rule degrades to today's light
  paint if the variable is ever out of scope.
- `Main` only: the `accent` tweak's inline `--accent` override now also emits `--on-accent`, chosen
  by the picked swatch's relative luminance (`L > 0.19` → `#0F1115`, else `#FFFFFF`). Without this,
  picking one of the four curated light swatches (`#4F46E5` L=0.117, `#2563EB` 0.153, `#0F766E`
  0.142, `#B45309` 0.159) while in dark would have stranded dark ink on a dark fill. All four resolve
  to `#FFFFFF`, so the light default is unchanged; the dark default `#8B85FF` (L=0.295) resolves to
  `#0F1115`.
- `Components.dc.html`: two lines added to the (non-rendering) spec comment documenting the two new
  tokens.

## Before → after, per named failure

Ratios are computed with the WCAG 2.x sRGB relative-luminance formula against the **rendered-pixel
backgrounds the QA harness measured** (`contrast-final.json`), so `backdrop-filter` blur, the washes
and the ruled ground are all already baked into the background term. Only the foreground token
changed, so the background term is unchanged by this pass.

| # | Failure | Size / weight | Composited bg (measured) | Before | After | Need |
| --- | --- | --- | --- | --: | --: | --: |
| 1 | White on dark accent — 13 distinct selectors, 8 boards (the QA's 12 rows plus `Components` "EXHIBIT 01") | 9.5–15 px / 600–700 | `rgb(139,133,255)` | **3.05** | **6.21** | 4.5 |
| 1b | White on `--accent-ink` — `Components` hover specimen (worst case in the whole report) | 13 px / 600 | `rgb(169,165,255)` | **2.21** | **8.56** | 4.5 |
| 2 | `Login` "Create one" | 13 px / 600 | `rgb(26,28,31)` | **2.72** | **7.74** | 4.5 |
| 2b | `Dashboard` "View all" | 12.5 px / 600 | `rgb(27,29,33)` | **2.68** | **7.65** | 4.5 |
| 3 | `Main` "Trust breakdown" | 10 px / 700 | `rgb(77,78,82)` | **2.65** | **4.79** | 4.5 |
| 3b | `Main` "· p.14 · §12.2" | 12 px / 400 | `rgb(76,78,82)` | **2.66** | **4.81** | 4.5 |
| 4 | Header `kbd` "⌘K" — 9 boards | 10 px / 400 | `rgb(61,72,71)` … `rgb(49,59,62)` | **3.02 – 3.67** | **5.46 – 6.63** | 4.5 |
| 5 | Header "Search all workspaces…" — 9 boards | 13 px / 400 | `rgb(50,60,60)` … `rgb(47,49,52)` | **3.63 – 4.16** | **6.55 – 7.52** | 4.5 |
| 6 | `Main` "Consistency" / "Grounding" / "Source coverage" (`--ink-2`) | 11.5 px / 400 | `rgb(68,69,73)` | **4.25** | **6.44** | 4.5 |
| 7 | `AuditLog` JSON payload cell | 11.5 px / 400 | `rgb(43,46,72)` | **4.22** | **7.63** | 4.5 |
| 8 | `Investigation` "S1" / "S2" | 9.5 px / 700 | `rgb(139,133,255)` | **3.05** | **6.21** | 4.5 |

All 46 distinct failures fall into exactly these token classes: **14** on `--on-accent`
(13 on the accent fill + 1 on `--accent-ink`), **2** on `--link-ink`, **27** on `--ink-3`,
**3** on `--ink-2`. 14 + 2 + 27 + 3 = 46.

**Worst case before: 2.21:1** (`Components`, white on `--accent-ink`).
**Worst case after: 4.79:1** (`Main` "Trust breakdown", `--ink-3` on the brightest composited L2
glass, `rgb(77,78,82)`) — the tightest margin in the set, 0.29 above the 4.5 threshold. Every other
failure clears 4.8:1 or better.

Nothing that already passed can regress: the three ink tokens only move **lighter** and dark-theme
surfaces are untouched, so contrast for those call sites is monotonically non-decreasing; and no ink
token is ever painted on a saturated fill (checked — there is no element combining
`background: var(--hi|--md|--lo|--accent)` with `color: var(--ink*)`).

## Design consequences, stated plainly

The dark ink ramp compresses: `#EDEEF0` → `#CFD4DD` → `#BFC5CF`. `--ink-2` is lifted further than its
own worst case strictly needs (6.44:1 vs 4.5) so that it stays lighter than `--ink-3`, whose worst
background (the L2 popover glass at `rgb(77,78,82)`) is brighter than `--ink-2`'s. That inversion is
structural: a 20px `backdrop-filter` blur over dense `#EDEEF0` body text lifts a white-alpha frost to
a mid-grey. The frost, the blur radii, the layering and the palette are unchanged — only the ink is.

The alternative, which would have restored a wider ramp, is to make the dark-theme frost *dark*
(`--glass` / `--glass-2` as a dark translucent tint rather than white alpha, which is the usual
dark-mode glass idiom and the actual root cause of the lift). That is a visible change to the
direction and its composited result cannot be predicted from the existing measurements, so it is
flagged rather than applied.

`--neutral-ink` (`#A7ADB8` in dark) was deliberately **not** touched: every one of its instances
passed AA in the QA run, so changing it would repaint passing elements. It is now darker than
`--ink-3`, which is a ramp inconsistency worth a follow-up.

## Verification — what was and was not run

**Not run, and this is a real gap.** This session had no shell: the only tools available were file
read/write/search. Neither the Playwright harness at `…/scratchpad/qa-scripts/` nor

```
node ".../design/seed-canvas.mjs" --template ".../payload.template.html" \
  --out "<workdir>/preview-check.html" --title "Grounded Glass" \
  --artboard Main.dc.html … --canvas canvas.json      # then --check
```

could be executed, so there is **no post-change measured run and no `--check` line for this pass**.
The 13 boards were not re-rendered, and `preview-check.html` was never created (so nothing needed
deleting).

**What was verified, statically and exhaustively:**

- Every one of the 46 distinct failures in `contrast-final.json` was enumerated and mapped to a
  foreground token; none is left unaddressed.
- After-ratios are computed from the harness's own measured composited backgrounds, not from the
  token's nominal surface — the same ground truth the FAIL verdict was based on. The before-column
  reproduces the QA's published numbers to ±0.02, which is the check that the luminance arithmetic
  here matches the harness's.
- Token blocks are byte-identical across all 13 boards (grep-verified before and after): 65 new
  declarations = 13 boards × 5, zero occurrences of `--ink-3: #8B929E`, `--ink-2: #A7ADB8`,
  `color: #FFFFFF` or `a { color: #4F46E5` remain.
- Light-theme paint equivalence is by construction (each new token resolves to the literal it
  replaced) rather than by measurement.

**Re-run before shipping:** `contrast2.js` in both themes across all 13 boards, expecting 0 failures
in dark and an unchanged light result, plus the `--check`. The one number to watch is item 3
(`Main` "Trust breakdown", predicted 4.79:1) — it is the only result inside 0.3 of the threshold, so
a small difference between the modal-pixel background this pass assumed and a fresh sample could
move it.
