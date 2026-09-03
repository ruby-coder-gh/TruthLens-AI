# GG-3 — analytics dashboards + the chart colour bridge

**Branch:** `worktree-agent-abb5457fe948b1493` (off `feat/grounded-glass-ui`)
**Scope:** `pages/AdminAnalyticsPage.tsx`, `pages/AdminDashboard.tsx`, `pages/UserDashboard.tsx`,
the new `utils/chartTheme.ts`, and three additive tokens in `index.css`.
No route, API call, copy string, exported prop or exported component signature changed.
No existing test file touched.

---

## 1. What was fixed

GG-1 catalogued **34** sites in `AdminAnalyticsPage.tsx` and **26** in `AdminDashboard.tsx`.
All 60 are gone; the grep for hex / `rgba(` / Tailwind-stock palette / `text-white` /
`bg-white` / `white/` across the three pages now returns only one hit, and it is a
prose comment.

`UserDashboard.tsx` needed **no** colour change — it was already fully token-driven,
including its trust-score number, which goes through `getTrustColorVar()` (already
`var(--color-*)`). I deliberately left `utils/relevance.ts` alone: its two catalogued
sites live in `RELEVANCE_COLORS`, which `UserDashboard` never reads and
`EvidenceSidebar` does — that's another lane's file.

### `AdminAnalyticsPage.tsx` (34)

| Was | Now |
| --- | --- |
| `DISTRIBUTION_COLORS = ['#f87171','#fb923c','#fbbf24','#38bdf8','#34d399']` | deleted — bucket colour is derived at render from `trustBucketColor()` |
| `getRiskMeta().barColor` `#f87171 / #fb923c / #9db0d4` | returns a `badgeColor` tone (fed to `toneColor()`) + an `inkClass` text token |
| 5 RAGAS `metric.color` hexes | deleted from `QualityMetric`; the meter fill is now derived from the threshold check + quality band |
| line-chart `<linearGradient #4f8dff→#6366f1>` | deleted; a flat 2px `--color-primary` stroke |
| `dot={{ fill:'#6366f1' }}` on every point | `dot={false}`, `activeDot` with a 2px surface ring |
| `CartesianGrid strokeDasharray="3 3" stroke="rgba(122,136,162,.24)"` ×2 | solid hairline `--color-border-light`, horizontals only |
| `XAxis/YAxis stroke="#7d8ba3"` ×4 | axis rule `--color-border`, tick ink `--color-text-dim` |
| 2 tooltip blocks (`rgba(19,26,39,.96)`, `#eaf0ff`, `#9db0d4`) | shared `tooltipStyles()` — opaque `--color-solid` panel, token ink |
| `metric.color` on the 24px % value | `text-text` — text never wears the mark colour |
| `linear-gradient(90deg, c, c88)` meter fill | flat severity fill |
| 2 × `bg-gradient-to-br from-white/[0.04]` card sheens | removed (invisible on light glass, pure noise) |

### `AdminDashboard.tsx` (26)

| Was | Now |
| --- | --- |
| `StatCard`: `text-white`, `text-white/70`, `text-white/50`, `bg-white/10`, `bg-white/5`, `bg-white/[0.03]`, `bg-white/[0.04]` + 4 gradient-filled tiles | glass tile (`bg-card`, `border-border`, `shadow-e1`) with ink label/value and a tinted icon square — the prototype's KPI tile |
| 4 × `icon={<X className="text-white" />}` | `text-primary-soft` / `text-green` / `text-orange` |
| `CartesianGrid stroke="#2b3548"` ×2, `XAxis/YAxis stroke="#6b7888"` ×4 | same token treatment as the analytics page |
| 2 tooltip blocks (`rgba(20,26,38,.85)`, `#e6eaf2`) | shared `tooltipStyles()` |
| `<Line stroke="#6366f1" dot={{fill:'#6366f1',r:4}}>` | `--color-primary`, `dot={false}`, ringed `activeDot` |
| `<Bar fill="#6366f1">` | per-bucket status `<Cell>`, same rule as the analytics page |
| eval meter `linear-gradient(90deg, score, accent|gold|red)` | flat severity fill via `evalScoreTone()` + `toneColor()` |

**The white-on-gradient KPI tile was the real defect here.** `text-white` on
`from-gold/70` composites to **3.10:1** on light and **1.31:1** over dark's
`#FCD34D`. Both are now ink on glass at 15.53:1 / 14.55:1.

---

## 2. The bridge — `frontend/src/utils/chartTheme.ts`

Recharts takes literal colour props (`stroke`, `fill`, `<Cell fill>`, `contentStyle`),
so a class swap does nothing for it. The module resolves the tokens at runtime.

**Design.**

1. `readChartPalette(root?)` reads 14 named roles out of
   `getComputedStyle(document.documentElement)`, one `--color-*` per role.
2. A **module-level store** caches exactly one palette object. A single
   `MutationObserver` on `<html>` (`attributeFilter: ['data-theme','class','style']`)
   re-reads it and notifies; a shallow compare suppresses no-op notifications so the
   reference stays stable.
3. `useChartPalette()` is `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)`.
   Because the memoisation lives in the store, every chart on the page shares one
   object and one observer, not one per component.
4. The observer is created on the first subscriber and disconnected when the last
   unsubscribes; `subscribe` re-reads first so a theme flip while nothing was mounted
   isn't missed.

**Why `MutationObserver` and not `ThemeContext`.** The observer needs no provider.
`renderWithProviders` in this repo does **not** wrap `ThemeProvider`, so a
`useTheme()` call would have thrown in every existing page test. It also picks up
the pre-paint bootstrap in `index.html` and anything else that restyles the root.

**Fallbacks are load-bearing.** vitest runs with `css: false`, so no custom property
resolves in jsdom and `getPropertyValue` returns `''`. Every role falls back to the
literal token value, keyed off `<html data-theme>` — otherwise Recharts would get
`stroke=""` and paint nothing. A test asserts no role can ever be empty.

**Semantic helpers** (so the two pages can't disagree):
`trustBucketColor(range, palette)`, `toneColor(badgeTone, palette)`,
`tooltipStyles(palette)`.

**Test:** `frontend/src/utils/chartTheme.test.ts`, 9 cases — light/dark fallback,
a resolved property beating the fallback, no-empty-role, live re-read on a
`data-theme` flip through `renderHook`, reference stability, and both helpers.

---

## 3. New tokens (3, additive; nothing renamed or revalued)

The existing `--color-green/-orange/-red` are the **text-safe inks** GG-1 chose
(`#166534` etc.). As a 24px bar or a meter fill, a near-black green reads as a heavy
block, and it is measured against the wrong bar — a graphical object needs 3:1, not
4.5:1. The prototype separates the two (`--hi` vs `--hi-ink`); the port did not have
the mark half, so I added it with the prototype's exact values:

```
--color-green-mark   #16A34A / #34D399
--color-orange-mark  #D97706 / #FBBF24
--color-red-mark     #DC2626 / #F87171
```

Everything else reuses existing tokens: gridline `--color-border-light`, axis rule
`--color-border`, tick ink `--color-text-dim`, tooltip/meter-track `--color-solid`,
series `--color-primary`.

---

## 4. Chart decisions (dataviz skill)

- **Queries over time** is one series → one colour, no legend (the title names it),
  2px round-capped accent line, `dot={false}` with a ringed `activeDot`, solid
  hairline horizontal gridlines only. The old 3px two-hue gradient stroke and a dot
  on every one of 30 points were both anti-patterns.
- **Trust distribution** buckets are ordered **status tiers**, not identities, so
  they wear the status marks at the same 0.5 / 0.75 thresholds as the badges
  (`red, red, amber, green, green`). The old five-hue red→orange→gold→**sky**→green
  ramp was a rainbow with a non-neighbour hue in the middle. Bars capped at 24px
  with `radius=[4,4,0,0]`.
- **RAGAS scorecard** is a stat tile + meter. The fill carries severity — a failed
  threshold wins over the band — and the value went to plain ink, because a green
  `91%` beside a red "Below threshold" badge is a chart lying to you. Pass/fail is
  never colour alone: the badge keeps its check/X icon **and** the words "Pass" /
  "Below threshold", with the band badge ("Excellent"/"Needs Work") beside it.
- **Both dashboards now plot the same buckets the same way**, which they previously
  did not.

**Honest caveat on the status trio.** Run through the skill's own validator these
are *status* colours, not a categorical series, so only the contrast gate strictly
applies — and it passes in both modes. The other numbers, for the record:

```
light (#FFFFFF): CVD worst adjacent green↔amber ΔE 6.2 (protan)   [6–8 band]
                 normal-vision worst adjacent amber↔red ΔE 14.4    [floor 15]
dark  (#191D24): CVD worst adjacent green↔amber ΔE 10.6 — PASS
                 normal-vision 21.2 — PASS
```

The light-mode pairs sit in the band the skill permits **only with secondary
encoding**, and that encoding is present and total: the bars are positionally
ordered, the x-axis names the numeric range under every bar, the height is the only
quantity, and the tooltip repeats it. Colour here is redundant reinforcement — a
reader who cannot separate amber from green loses nothing. Not silently clean; a
judgement call, made with the numbers in hand.

---

## 5. Measured contrast — 56 pairs, both themes, 0 failures

Composited over the real surface (translucent `card` over the theme ground, tints
over that). Text pairs held to 4.5:1, graphical objects to 3:1.

| Pair | Light | Dark |
| --- | --: | --: |
| KPI value `text` / card | 15.53 | 14.55 |
| KPI label `text-muted` / card | 6.23 | 11.36 |
| KPI trend `text-dim` / card | 5.13 | 9.74 |
| KPI trend `green` / card | 7.01 | 11.08 |
| KPI trend `red` / card | 6.36 | 8.90 |
| RAGAS `%` value `text` / card | 15.53 | 14.55 |
| Axis tick `text-dim` / card | 5.13 | 9.74 |
| Tooltip `text` / `solid` | 15.80 | 14.56 |
| Tooltip label `text-muted` / `solid` | 6.34 | 11.36 |
| Usage table `text-muted` / `solid` | 6.34 | 11.36 |
| Risk % `red` / card-2 on card | 5.84 | 7.53 |
| Risk % `orange` / card-2 on card | 5.87 | 9.91 |
| Risk % `text-muted` / card-2 on card | 5.72 | 9.60 |
| Icon `primary-soft` / primary-10 tile | 6.69 | 6.64 |
| Icon `green` / green-10 tile | 6.02 | 8.85 |
| Icon `orange` / orange-10 tile | 5.50 | 9.29 |
| MARK line accent / surface | 6.29 | 5.55 |
| MARK bar green / surface | 3.30 | 8.79 |
| MARK bar amber / surface | 3.19 | 10.12 |
| MARK bar red / surface | 4.83 | 6.11 |
| MARK meter green / track | 3.30 | 8.79 |
| MARK meter amber / track | 3.19 | 10.12 |
| MARK meter red / track | 4.83 | 6.11 |
| MARK meter accent / track | 6.29 | 5.55 |

**One real bug the measurement caught.** With the meter track left as `bg-card-2`,
the light-mode green and amber fills measured **2.97:1** and **2.87:1** against their
own track — under the 3:1 that the filled/unfilled boundary needs, and invisible to
a class-swap review. All three meter tracks (RAGAS, low-trust risk, dashboard eval)
moved to the opaque `bg-solid` inset with a `ring-1 ring-inset ring-border-light`
hairline, which is also what the glass law asks for. Both now clear at 3.30 / 3.19.

---

## 6. Gates

```
$ npm run test:run
 Test Files  16 passed (16)
      Tests  125 passed (125)          # 116 pre-existing + 9 new in chartTheme.test.ts

$ npx tsc -b --noEmit
TypeScript: No errors found

$ npx eslint .
ESLint: No issues found

$ npm run build
✓ built in 287ms
```

The build emits a chunk now *named* `chartTheme-*.js` (357 kB). That is the existing
shared Recharts chunk being renamed because `chartTheme.ts` became the common import
of the two admin pages — not new weight, and still lazy: nothing outside those two
routes imports it.

---

## 7. Browser check

Chromium 1440×900 @2x against the Vite dev server on `:5182`. The admin API and
`/auth/me` were stubbed at the network layer (routing only paths that literally start
with `/api/`, so Vite's own `/src/api/…` modules are untouched) because this
environment has no seeded admin account and I did not have permission to search for
credentials. Everything below is the real component tree, real `index.css`, real
Recharts.

**Charts recolour live on the theme switch — verified by reading the painted SVG,
with no reload:**

| | light | dark |
| --- | --- | --- |
| `--color-primary` | `#4F46E5` | `#8B85FF` |
| `<Line stroke>` | `#4F46E5` | `#8B85FF` |
| `<Cell fill>` ×5 | `#DC2626 #DC2626 #D97706 #16A34A #16A34A` | `#F87171 #F87171 #FBBF24 #34D399 #34D399` |
| gridline stroke | `rgba(0,0,0,0.06)` | `rgba(255,255,255,0.1)` |
| axis tick fill | `#666D78` | `#BFC5CF` |
| meter fills | `rgb(22,163,74)` / `rgb(79,70,229)` / `rgb(217,119,6)` | `rgb(52,211,153)` / `rgb(139,133,255)` / `rgb(251,191,36)` |

**Zero console errors and zero page errors** across all five views.

Screenshots in `scratchpad/shots/`: `analytics-{overview,ragas,usage}-{light,dark}`,
`admin-dashboard-{light,dark}`, `user-dashboard-{light,dark}`, plus `d-*` detail crops.
Confirmed by eye: the KPI row reads as glass tiles with ink numbers in both themes;
the line chart is a single indigo stroke on a hairline grid; the bar chart runs
red → amber → green over a labelled axis; the RAGAS cards show "Pass" (check icon,
green meter) beside "Below threshold" (X icon, red meter, "Needs Work" band); the
usage table sits on the opaque surface.

### What I could not reach

- **Real seeded data.** All admin figures above are stubbed. Chart *colour* is
  fully exercised, but I have not seen these charts against production-shaped data
  (e.g. a backend that returns bucket labels other than `N-M` — those fall back to
  the neutral mark by design, and there is a unit test for it).
- **`UserDashboard`'s "Avg Trust Score" card**, which only renders when recent
  queries carry scores. It needed no change (already token-driven, and its ink
  measures 7.01 / 11.08 against the card), but I did not see it painted.
- **The `/admin` Evaluation tab meters** — the tab renders, but I verified its
  fill colours through the shared `toneColor()` path and the unit test rather than
  a screenshot with populated eval data.
- **Real login.** No demo admin is documented in the repo and searching the backend
  env was blocked, so auth was stubbed rather than performed.
