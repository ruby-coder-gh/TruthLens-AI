# GG-2 — the chat and evidence surface

**Lane:** chat + evidence sidebar
**Base:** `feat/grounded-glass-ui` @ `0df884b`
**Files:** `ChatPage.tsx`, `EvidenceSidebar.tsx`, `AbstentionCard.tsx`, `ChatDetailPage.tsx`,
`ChatHistoryPage.tsx`, `ChatNewPage.tsx`, `PageWrappers.tsx`, `index.css` (3 additive tokens).
No other file touched. No route, prop, state shape, API call, copy string or test edited.
The `opacity: 0.99` framer-motion workarounds are all intact.

---

## 1. Sites fixed

GG-1's catalogue listed **69** sites across my files (ChatPage 27, EvidenceSidebar 39,
ChatHistoryPage 1, ChatNewPage 1, PageWrappers 1). All 69 are gone; a grep for
`[#hex` / `rgba(` / `-white/` / `-black/` / stock-palette classes across the six
components now returns only prose in comments.

I kept **one** hardcoded colour on purpose: `ChatPage.tsx` `bg-black/50` on the
sources-modal scrim. GG-1 excluded the two other scrims on the same reasoning — a black
scrim is correct in both themes — and this is the third instance of that pattern.

### What each group became

| Was | Now | Why |
| --- | --- | --- |
| `bg-white/5`, `bg-white/[0.025]`, `bg-white/[0.04]` (18×) | `bg-card-2` | These were dark-theme literals; on the light ground a 2–5 % white film over near-white is invisible. |
| `border-white/10`, `border-white/5`, `border-white/[0.06]`, `border-white/[0.08]` (9×) | `border-border` / `border-border-light` | Same defect on the edge. |
| `bg-black/20` excerpt wells (2×) | `bg-solid` + `border-border` + `.font-quote` | Glass law: a quoted excerpt is opaque. Also the one sanctioned use of Newsreader. |
| `from-green-400 to-emerald-500` / `orange-400`→`amber-500` / `red-400`→`rose-500` meters (5×) | `bg-trust-high` / `-mid` / `-low` | Stock-palette gradients are theme-fixed; `green-400` measures **1.7:1** against its own track on light — an invisible meter. |
| `border-green-500/60 bg-green-500/20` pipeline step | `border-green/50 bg-green/15` | Only stock-palette pair left in the timeline. |
| `text-white` on `bg-primary` (2×) and `text-bg` on `bg-primary` (2×) | `text-on-primary` | `text-white` on dark's `#8B85FF` is **3.04:1**. This was the exact defect GG-1 flagged in `ui.tsx`, still live in the user bubble and the send button. |
| `rgba(99,102,241,…)` framer-motion glow keyframes (7 literals, 2 animations) | flat `border-primary/60` on the composer, `shadow-e2`/`e3` on the send button | Framer-motion animates literal strings, so these could not be tokenised in place. GG-1 set the precedent of retiring the Midnight glow artefacts. |
| `shadow-[0_0_24px_rgba(…)]`, `shadow-2xl shadow-black/60`, `shadow-lg shadow-primary/10`, `shadow-[0_0_30px_rgba(…)]` (6×) | `shadow-e1/e2/e3` | The elevation scale is already theme-reactive. |
| `stroke="rgba(122,136,162,0.28)"`, `stroke="rgba(255,255,255,0.05)"` ring tracks | `var(--color-border)` / `var(--color-card-2)` | Both were invisible on light. |
| `rgba(99,102,241,…)` / `rgba(52,211,153,…)` in the constellation canvas draw loop (5 literals) | tokens read once via `getComputedStyle`, re-read on a `data-theme` `MutationObserver` | Canvas can't use utilities. Reading per-frame would force a style recalc every 16 ms; this reads twice per theme change and repaints explicitly under reduced motion. Observer is disconnected on cleanup. |
| `bg-surface/50` (`ChatDetailPage`) | `bg-solid` + `border-border` + `.font-quote` | **`--color-surface` has never existed** — the class was dead and that well painted nothing at all in either theme. |

### Three token-collapse defects the remap surfaced

These were not in the catalogue (they are token-to-token, not hardcoded), but the
Grounded Glass values made them visible:

1. **The trust stamp had no verdict.** `getTrustStampMeta` / `trustStampMeta` ran
   `text-accent` → `text-primary` → `text-accent-2`, which under the new tokens **all
   resolve to the same indigo**. Verified, Review and Flagged painted identically. Now
   `text-green` / `text-orange` / `text-red`; `.wax-seal` derives its tint and edge from
   `currentColor`, and the verdict word stays beside the hue.
2. **`TrustScoreRing` used `--color-accent` for the passing band** — so a high-trust ring
   read as ordinary UI chrome. Now the trust hue for the arc and the trust **ink** for the
   numeral inside it (the fill hue would only be 3.4:1 as 10px text).
3. **The assistant bubble carried `bg-card/60 border-white/10` under `.glass`.** `.glass`
   is unlayered, so it already owned both properties — the pair never applied and only
   misdescribed the surface. Removed, no visual change.

### Structural polish that came with it

- Evidence sidebar is now a proper **L1 glass panel** (`bg-bg-soft/85` + one `blur-xl`,
  `border-border`, `e3`), matching Layout's sidebar. Cards inside are flat tints — blur
  depth stays at 1, never 2.
- Sources modal and the citation hover card are **opaque** (`bg-solid`, `e3`, no blur):
  both carry body text and a quoted excerpt.
- The composer textarea is an **opaque field** (`bg-solid`), not `bg-bg-soft/90` + blur.
- Guardrail banner, abstention card and the error card each gained a **3px inset rail**
  (`shadow-[inset_3px_0_0_var(--color-trust-*)]`) — a second, non-colour signal, straight
  off the `Abstention.dc.html` board.
- The three empty-state pillars were all indigo (`text-accent` ≡ `text-primary-soft`);
  they now read indigo / green / amber.
- Radii moved onto the scale: `rounded-chip/control/card/panel`.

---

## 2. Tokens added

Additive only. **No existing token was renamed or revalued** — other lanes are safe.

```css
/* @theme (light) */                /* [data-theme="dark"] */
--color-trust-high: #15803D;        --color-trust-high: #34D399;
--color-trust-mid:  #B45309;        --color-trust-mid:  #FBBF24;
--color-trust-low:  #DC2626;        --color-trust-low:  #F87171;
```

**Why they exist.** `--color-green/orange/red` are the *text-safe inks* — GG-1 deliberately
mapped them to the ink, because one token serves both `bg-green/15` and `text-green` at the
same call site. That makes them wrong as a meter fill: on dark, ink `#6EE7B7` as a bar is a
different colour from the design's `#34D399`, and on light the alternative (stock
`green-400`) is 1.7:1 against its track. These are the graphics-only counterpart.

**They are held to 3:1, not 4.5:1, and are never used as text.** Where a trust colour has
to *read* — the ring numeral, the wax seal, the guardrail label — the code still uses the
ink. The one place I nearly got this wrong is called out in a code comment in
`TrustScoreRing`.

**The light values are not the board's.** `Main.dc.html` specifies `#16A34A` / `#D97706`;
measured against a near-white track those are **2.89:1** and **2.79:1**, and against the
`--color-border` arc track **2.34:1** / **2.27:1**. They fail. Stepping down one notch to
the 700s clears 3:1 on every light surface they land on while staying clearly more
chromatic than the inks. Dark keeps the board's values exactly — they measure 4.8–8.0:1
there.

---

## 3. Measured contrast

WCAG 2.x sRGB, computed over the **composited** surface — every translucent layer
(`bg-bg-soft/85` panel → `bg-card` → `bg-card-2`, and each `/12` tint) resolved against the
theme ground first, not guessed. Script: `scratchpad/contrast.mjs`.

### Text — 4.5:1 required

| Pair | Light | Dark |
| --- | --: | --: |
| excerpt `text` on `bg-solid` (Newsreader 13px) | 15.80:1 | 14.56:1 |
| `text-dim` on `bg-card-2` chip (11px, in a sidebar card) | 4.58:1 | 7.65:1 |
| `text-dim` on `bg-card-2` (chrome, on the glass bubble) | 4.71:1 | 8.23:1 |
| `text-muted` on `bg-card-2` (Sources button) | 5.72:1 | 9.60:1 |
| `text-primary-soft` doc name on `bg-card` | 7.55:1 | 7.17:1 |
| `text-primary-soft` on `bg-card-2` | 6.93:1 | 6.01:1 |
| **`text-on-primary` on `bg-primary`** (user bubble / Exhibit chip / send) | **6.29:1** | **6.21:1** |
| ~~`text-white` on `bg-primary`~~ — what this replaced | 6.29:1 | **3.04:1 ✗** |
| `text-text` on the L1 sidebar panel | 14.05:1 | 15.47:1 |
| `text-dim` on the L1 sidebar panel | 4.64:1 | 10.35:1 |
| `text-dim` on `bg-solid` (excerpt label, 11px) | 5.22:1 | 9.74:1 |
| wax-seal `text-green` on `currentColor/12` | 5.84:1 | 8.41:1 |
| wax-seal `text-orange` on `currentColor/12` | 5.34:1 | 8.80:1 |
| wax-seal `text-red` on `currentColor/12` | 5.19:1 | 7.01:1 |
| abstention chip `text-orange`, `/12` tint **nested inside** the `/12` card | 4.51:1 | 6.53:1 |
| trust-ring numeral, green ink on the glass bubble | 7.01:1 | 11.08:1 |
| trust-ring numeral, amber ink | 6.39:1 | 11.72:1 |
| trust-ring numeral, red ink | 6.36:1 | 8.90:1 |
| reconnect chip `text-orange` on `bg-gold/15` | 5.09:1 | 8.11:1 |

### Non-text graphics — 3:1 required

| Pair | Light | Dark |
| --- | --: | --: |
| meter fill `bg-trust-high` vs its `bg-card-2` track | 4.40:1 | 6.90:1 |
| meter fill `bg-trust-mid` vs its track | 4.40:1 | 7.95:1 |
| meter fill `bg-trust-low` vs its track | 4.24:1 | 4.80:1 |
| meter fill `bg-primary` vs its track | 5.51:1 | 4.36:1 |
| trust arc `trust-high` vs the `--color-border` track | 3.57:1 | 5.74:1 |
| trust arc `trust-low` vs the `--color-border` track | 3.43:1 | 3.99:1 |
| abstention rail `trust-mid` vs the `bg-orange/12` card | 4.12:1 | 7.61:1 |
| guardrail rail `trust-high` vs the `bg-green/12` card | 4.11:1 | 6.67:1 |
| error rail `trust-low` vs the `bg-red/12` card | 3.87:1 | 4.81:1 |
| focus ring `--color-primary` vs the L1 panel | 5.59:1 | 5.90:1 |

**Every pair clears its threshold in both themes.** The only ✗ in the table is the
deliberate "before" control row.

The tightest margins are `text-dim` on `bg-card-2` in light (4.58:1) and the nested
abstention chip (4.51:1). Both are real and both pass; neither has headroom, so a later
lane should not deepen those tints further without re-measuring.

**Colour is never the only signal.** Every trust surface carries an icon *and* a word
(`Verified` / `Review` / `Flagged`, `Passed` / `Failed`, `Strong` / `Moderate` / `Weak
Evidence`, `ABSTAINED`); the three banner types now also carry a 3px rail; every meter
prints its own percentage as text.

---

## 4. Browser verification

Chromium 1440×900 / ×1000, dev server `:5181`, live backend `:8000`, real login
(`gg2@example.com`), one indexed document so the answered path had real evidence.
Screenshots in `scratchpad/shots/`.

### Confirmed in **both** themes

| State | Light | Dark |
| --- | --- | --- |
| Chat empty state (`Ask anything`, pillars, example chips) | ✓ | ✓ |
| Evidence sidebar empty state + constellation canvas | ✓ | ✓ |
| Composer idle **and** ready (accent edge on non-empty input) | ✓ | ✓ |
| **Abstention** — amber card, rail, chips, `ABSTAINED` badge | ✓ | ✓ |
| Abstained pipeline: 3 green steps + amber `Abstained` terminus | ✓ | ✓ |
| **Answered** — guardrail rail, trust ring, `VERIFIED` seal, footer actions | ✓ | ✓ |
| **Cached** — the `Cached` chip and the regenerate action | ✓ | ✓ |
| Inline citation footnote marker | ✓ | ✓ |
| Source card collapsed + expanded (Newsreader excerpts on the opaque field, meters, metric wells, Chunk Confidence) | ✓ | ✓ |
| Full 5-step reasoning pipeline with `Passed — 100%` | ✓ | ✓ |
| Chat History list, Chat Detail (abstained), Chat New | ✓ | ✓ |
| Keyboard: 25 focusable stops, **0 without a 2px focus ring** | ✓ | ✓ |

No page errors in any run. (Two console 401s appear on load — an admin-only endpoint
probed by the layout for a non-admin user. Unrelated to this diff, present on the base.)

### What I could **not** verify in the browser

1. **The live streaming cursor, the "Thinking…" typing indicator, and the reconnecting
   chip.** This backend answers in 24–61 ms (cached: 24 ms), so every screenshot at
   t+0.8–1.4 s already showed the terminal state. The markup for all three is theme-token
   only (`bg-primary-soft` cursor, `bg-primary-soft` dots, `border-gold/30 bg-gold/15
   text-gold`) and the reconnect chip is measured above at 5.09 / 8.11:1 — but I did not
   see them rendered.
2. **The trust-component bars and the 80px trust arc** in the AI Reasoning tab. This
   backend returns an empty `trustComponents` map, so that whole block never mounted. The
   bars and arc are covered by the measured table above, not by a screenshot.
3. **The error card** (`role="alert"`). Every request succeeded or abstained; I did not
   induce a failure. Its rail and inks are measured, not seen.
4. **The `TraceBeamOverlay`** (citation → sidebar beam) and the **citation hover card**.
   The hover needs a 300 ms dwell on a `<sup>` that had scrolled out of the viewport
   behind the expanded source card; two attempts timed out. Both are token-driven in the
   diff (`var(--color-accent)` stroke; `bg-solid` + `e3` card) and measured, not seen.

### One finding that is *not* mine to fix

At ≥1024 px the evidence sidebar (`fixed inset-y-0 right-0 z-30`) **overlays the header's
theme toggle and the global search field**, and intercepts clicks on them — Playwright
could not click "Switch to dark mode" at all while the sidebar was open; I had to seed
`localStorage` and reload. I confirmed this is **pre-existing**: those positioning classes
are untouched by my diff, and `ChatPage.tsx` already carries a long comment about the same
sidebar swallowing clicks on the Send button. It needs an owner who holds both
`Layout.tsx` (the header) and the sidebar's stacking — flagging it rather than reaching
into another lane's file.

---

## 5. Gates

```
$ npm run test:run
 Test Files  15 passed (15)
      Tests  116 passed (116)

$ npx tsc -b --noEmit
TypeScript: No errors found

$ npx eslint .
ESLint: No issues found

$ npm run build
✓ built in 285ms
```

116/116, unmodified — no test file was touched, and I did not need to argue with one.
I also verified the three new utilities actually reach the bundle rather than being
tree-shaken: `dist/assets/index-*.css` contains `.bg-trust-high{background-color:var(--color-trust-high)}`
plus the `[data-theme="dark"]` override `--color-trust-high:#34d399`.

---

## 6. Handoffs

- **`src/utils/relevance.ts`** (GG-1's catalogue, lines 44/56, unassigned) still returns
  `bar: 'bg-gradient-to-r from-green-400 to-emerald-500'` and `glow: 'bg-green-400/40'`.
  I could not edit it without crossing lanes, so `ChatPage` and `EvidenceSidebar` each map
  `relevance.tier` through a local `TRUST_BAR` constant and ignore `.bar` / `.glow`.
  Whoever owns that file should collapse both maps into it — the tokens now exist.
  `.text` and `.badge` there are already fine.
- The sidebar-over-header click interception described above.
- `--color-gold` and `--color-orange` are the same value, so the reconnecting chip and the
  abstention card are indistinguishable by hue. Intentional in GG-1's mapping; worth a
  decision if the two ever need to be told apart.
