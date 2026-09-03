# GG-1 — Grounded Glass foundation lane

**Branch:** `feat/grounded-glass-ui`
**Scope:** token remap, theme switching, `ui.tsx` primitives, `Layout.tsx` chrome.
**Constraint honoured:** every pre-existing `@theme` token *name* survives; only values
changed. No route, API call, state shape, copy string or component prop signature was
touched. No existing test file was edited. No component library added.

---

## 1. Token mapping (old value → new)

Light is the default (emitted by `@theme`). Dark is an unlayered
`[data-theme="dark"]` override on the **same names**, so every existing
`bg-card` / `text-text-muted` / `border-border` utility in the app keeps working
and simply looks different.

### Accent

| Token | Old (Midnight, dark-only) | New — light | New — dark |
| --- | --- | --- | --- |
| `--color-primary` | `#6366f1` | `#4F46E5` | `#8B85FF` |
| `--color-primary-soft` | `#a5b4fc` | `#4338CA` | `#A9A5FF` |
| `--color-primary-dark` | `#4f46e5` | `#3F37C9` | `#A9A5FF` |
| `--color-primary-glow` | `rgba(99,102,241,.22)` | `rgba(79,70,229,.16)` | `rgba(139,133,255,.22)` |
| `--color-accent` | `#38bdf8` | `#4F46E5` | `#8B85FF` |
| `--color-accent-2` | `#818cf8` | `#4338CA` | `#A9A5FF` |
| `--color-accent-glow` | `rgba(56,189,248,.20)` | `rgba(79,70,229,.14)` | `rgba(139,133,255,.20)` |
| `--color-on-primary` **(new)** | — (was a literal `text-white`) | `#FFFFFF` | `#0F1115` |

`--color-primary-soft` is deliberately the **text-safe** indigo ink, not a pale tint:
124 call sites use `text-primary-soft` as a label. The sky-blue `--color-accent` is
folded into the indigo family because the direction runs a single accent hue.

### Trust / status

Mapped to each hue's **text-safe ink**, because the app uses one token for both the
tint (`bg-green/15`) and the label (`text-green`) at the same call site.

| Token | Old | New — light | New — dark |
| --- | --- | --- | --- |
| `--color-green` | `#34d399` | `#166534` | `#6EE7B7` |
| `--color-orange` | `#fb923c` | `#9A4508` | `#FCD34D` |
| `--color-gold` | `#fbbf24` | `#9A4508` | `#FCD34D` |
| `--color-red` | `#f87171` | `#B91C1C` | `#FCA5A5` |

### Ground & surfaces

| Token | Old | New — light | New — dark |
| --- | --- | --- | --- |
| `--color-bg` | `#0b0f17` | `#FAFAF9` | `#0F1115` |
| `--color-bg-soft` | `#121824` | `#F1F0EE` | `#15181E` |
| `--color-card` | `rgba(20,26,38,.74)` | `rgba(255,255,255,.60)` | `rgba(255,255,255,.05)` |
| `--color-card-2` | `rgba(28,35,50,.60)` | `rgba(31,35,40,.045)` | `rgba(255,255,255,.06)` |
| `--color-card-hover` | `rgba(36,44,62,.86)` | `rgba(255,255,255,.78)` | `rgba(255,255,255,.085)` |
| `--color-border` | `rgba(122,136,162,.24)` | `rgba(0,0,0,.10)` | `rgba(255,255,255,.16)` |
| `--color-border-light` | `rgba(140,155,185,.20)` | `rgba(0,0,0,.06)` | `rgba(255,255,255,.10)` |
| `--color-glass` | `rgba(17,22,33,.72)` | `rgba(255,255,255,.60)` | `rgba(255,255,255,.05)` |
| `--color-glass-border` | `rgba(130,145,175,.14)` | `rgba(0,0,0,.06)` | `rgba(255,255,255,.10)` |
| `--color-glass-hover` | `rgba(28,36,52,.82)` | `rgba(255,255,255,.78)` | `rgba(255,255,255,.085)` |
| `--color-solid` **(new)** | — | `#FFFFFF` | `#191D24` |

`--color-solid` exists to satisfy the glass law: tables, inputs, code and quarantined
text always sit on an opaque surface, never on a blur.

### Ink

| Token | Old | New — light | New — dark |
| --- | --- | --- | --- |
| `--color-text` | `#e6eaf2` | `#1F2328` | `#EDEEF0` |
| `--color-text-muted` | `#9aa6bc` | `#5A6069` | `#CFD4DD` |
| `--color-text-dim` | `#7d8ba3` | `#666D78` | `#BFC5CF` |

### Type

| Token | Old | New |
| --- | --- | --- |
| `--font-sans` | `'Inter', 'Avenir Next', …` | `'Inter', 'Helvetica Neue', 'Segoe UI', system-ui, sans-serif` |
| `--font-display` | `'Space Grotesk', …` | Inter stack — the direction uses Inter for **all** UI |
| `--font-mono` | `'JetBrains Mono', …` | system mono (`ui-monospace, SFMono-Regular, …`) — kept for ids/hashes |
| `--font-quote` **(new)** | — | `'Newsreader', Georgia, serif` — quoted source excerpts **only** |

Space Grotesk and JetBrains Mono are no longer fetched; Newsreader is. Net webfont
requests are unchanged (3 families → 2 families + system mono).

### New scales (additive)

| Token | Value |
| --- | --- |
| `--radius-chip / -control / -card / -panel` | `6px / 10px / 14px / 20px` |
| `--shadow-e1 / -e2 / -e3` | indirected through `--e1/--e2/--e3` so they stay theme-reactive |

---

## 2. Theme switching

- `src/context/theme-context.ts` — context, `useTheme()`, `THEME_STORAGE_KEY`,
  `THEME_ATTRIBUTE`, `getPreferredTheme()`. Non-component module, mirroring
  `auth-context.ts`, so react-refresh stays happy.
- `src/context/ThemeContext.tsx` — `ThemeProvider`. Lazy-initialised from
  localStorage → `prefers-color-scheme` → light. One effect owns both side effects
  (setting `data-theme` on `<html>` and persisting), which keeps `setTheme` and
  `toggleTheme` referentially stable. Every storage access is `try`/`catch`ed —
  Safari private mode and this repo's own jsdom test env both lack a usable
  `window.localStorage`, and a theme lookup must never take the app down.
- `ThemeToggle` is exported from `Layout.tsx` and rendered in both the desktop
  (`lg:`) and mobile header rows. 32×32, radius 10, `border-border` on
  `bg-card-hover` — the same chrome as the search field beside it. Sun icon while
  dark is active, moon while light. `aria-label` + `title` state the *action*
  ("Switch to dark mode" / "Switch to light mode"), so it deliberately carries no
  `aria-pressed` — the two conventions conflict. Keyboard path is a plain
  `<button>`; focus ring comes from the global `:focus-visible` rule.
- `index.html` gained a pre-paint bootstrap script that resolves the same
  precedence before React mounts, so there is no theme flash on load.

---

## 3. What was restyled

**`ui.tsx`** (same exported names, same props, same `BadgeColor` meanings):
Button (fixed 36/28/44px heights, `text-on-primary` ink, e1→e2 elevation),
Input / TextArea / Select (opaque `--color-solid` field, 12.5px label above,
error below with icon), Card (radius 14, e1 → e2 on hover), Badge (tint + edge +
text-safe ink), Modal (opaque `bg-solid` panel at radius 20 with e3 — body text
never on a blur), toasts (opaque, 3px status rail as a second non-colour signal),
EmptyState (dashed inset well, 56px icon tile), LoadingSpinner, Skeleton,
ProgressBar (flat accent fill on an inset track), Tabs (30px accent-tint pill).

**`Layout.tsx`**: sidebar is now an L1 panel (`bg-bg-soft/85` + blur, `border-border`);
header rule and dividers moved to `border-border-light`; nav active state is an
indigo tint pill. **Nav structure is untouched** — same items, same order, same
routes, same collapse behaviour, same contextual review-queue pill and count.
Removed the Midnight-era glow artefacts (nav particle emitters, pulsing avatar
halo, icon `drop-shadow`) which read as noise on a light frosted ground; the
logout hover moved off Tailwind's stock `red-400/red-500` onto `--color-red`.

**`index.css`**: `.glass` / `.glass-input` / `.shimmer` / `.evidence-mark` /
`.gradient-text` / `.wax-seal` / `.file-rule` / `#cursorGlow` / `::selection` /
scrollbars all now derive from tokens. The ruled ground + two static washes are
painted once on `<body>`, and re-painted by `.bg-grid` for containers that lay an
opaque `bg-bg` over it. `.ambient-blob` is inert (blur stacks at most two deep);
the markup stays valid on every page that still renders it.

The `opacity: 0.99` framer-motion WAAPI workarounds were left untouched.

---

## 4. Accessibility

Computed with the WCAG 2.x sRGB formula, translucent surfaces composited over the
theme ground. **Every pair clears 4.5:1 in both themes** — no pair relies on the
large-text 3:1 allowance.

| Pair | Light | Dark |
| --- | --: | --: |
| `text` on card | 15.53:1 | 14.54:1 |
| `text-muted` on card | 6.23:1 | 11.34:1 |
| `text-dim` on card | 5.13:1 | 9.73:1 |
| `text-dim` on `card-2` | 4.58:1 | 9.51:1 |
| `on-primary` on `primary` | 6.29:1 | 6.21:1 |
| `primary-soft` on card | 7.77:1 | 7.65:1 |
| `primary-soft` on `primary/11` | 6.60:1 | 6.57:1 |
| `green` on `green/12` | 5.85:1 | 8.42:1 |
| `orange` on `orange/13` | 5.25:1 | 8.53:1 |
| `red` on `red/10` | 5.39:1 | 7.28:1 |
| `text` on `solid` | 15.80:1 | 14.56:1 |

The old `text-white` on the primary Button was the exact defect the design report
flags: white on dark's `#8B85FF` is 3.04:1. It is now `text-on-primary` (6.21:1).
Colour is never the only signal — Badge/toast keep their icon, and the toast rail
is a second cue.

---

## 5. Hardcoded colours that bypass tokens — for later lanes

These are *not* fixed by the token remap and will still paint Midnight values (or
Tailwind stock palette values) in light mode.

Two sites are intentional and excluded: `ui.tsx:400` (`bg-black/45` modal scrim)
and `Layout.tsx:210` (`bg-black/60` mobile sidebar scrim) — a black scrim is
correct in both themes.

I did fix the four that made the **login and register flows unusable** in light
mode, since they were pure surface literals with exact token equivalents:
`premium/AnimatedInput.tsx` (`bg-[#0b0f17]/60|70|90` → `bg-card-2` / `bg-solid`)
and `premium/PremiumButton.tsx` (the `BorderBeam` inner panel `bg-[#0b0f17]` →
`bg-primary`, and its label `text-text` → `text-on-primary`). Everything below
remains.

Total follow-up sites: **336** across **37** files.

| File | Sites | Lines |
| --- | --: | --- |
| `src/components/EvidenceSidebar.tsx` | 39 | 191, 193, 194, 197, 199, 200, 201, 204, 205, 214, 273, 333, 348, 352, 357, 380, 414, 422 … (+15 more) |
| `src/pages/AdminAnalyticsPage.tsx` | 34 | 77, 252, 255, 257, 359, 360, 361, 362, 363, 724, 769, 770, 773, 774, 775, 779, 781, 783 … (+12 more) |
| `src/pages/ChatPage.tsx` | 27 | 736, 838, 839, 840, 854, 866, 872, 873, 874, 876, 880, 884, 925, 1010, 1216, 1223, 1303, 1331 … (+4 more) |
| `src/pages/AdminDashboard.tsx` | 26 | 239, 242, 245, 262, 266, 271, 272, 408, 409, 410, 413, 415, 417, 423, 425, 467, 468, 469 … (+8 more) |
| `src/pages/LandingPage.tsx` | 19 | 78, 80, 113, 176, 183, 189, 208, 247, 262, 271, 280, 294, 328, 346, 356, 379, 400 |
| `src/components/api-catalog/HeroSection.tsx` | 18 | 101, 102, 103, 104, 105, 106, 124, 143, 170 |
| `src/pages/SettingsPage.tsx` | 18 | 18, 43, 54, 73, 89, 193, 221, 222, 225, 260, 261, 265, 316, 318, 321 |
| `src/components/premium/PremiumButton.tsx` | 16 | 18, 37, 138, 140, 143, 152, 206 |
| `src/components/api-catalog/data.ts` | 15 | 9, 76, 119, 202, 260, 312, 333, 363, 400, 431, 435 |
| `src/pages/WorkspaceDetailPage.tsx` | 15 | 184, 247, 252, 370, 619, 621, 806, 861, 977, 1208, 1214, 1244, 1274, 1498 |
| `src/components/premium/AnimatedInput.tsx` | 11 | 48, 49, 50, 55, 56, 57, 75, 106, 121, 132 |
| `src/pages/ResetPasswordPage.tsx` | 10 | 62, 97, 123, 142 |
| `src/components/api-catalog/RightPanel.tsx` | 7 | 45, 53, 88, 112 |
| `src/components/api-catalog/EndpointDetailDrawer.tsx` | 7 | 49, 79, 89, 92, 107 |
| `src/pages/RegisterPage.tsx` | 7 | 85, 130, 155, 246 |
| `src/pages/LoginPage.tsx` | 7 | 68, 115, 150, 226 |
| `src/main.tsx` | 6 | 12, 13, 14, 15 |
| `src/pages/ForgotPasswordPage.tsx` | 6 | 50, 78, 98 |
| `src/components/ReportBuilderWizard.tsx` | 5 | 128, 152, 250, 276, 281 |
| `src/components/Logo.tsx` | 5 | 40, 54, 55, 56, 64 |
| `src/components/api-catalog/EndpointGroup.tsx` | 5 | 70, 98, 118, 124, 176 |
| `src/components/api-catalog/WebSocketViz.tsx` | 4 | 35, 83, 145, 166 |
| `src/pages/InvestigationPage.tsx` | 4 | 68, 71 |
| `src/pages/ContactPage.tsx` | 4 | 14, 26 |
| `src/components/GlobalSearch.tsx` | 3 | 74, 79 |
| `src/pages/ApiCatalogPage.tsx` | 3 | 59, 64 |
| `src/utils/relevance.ts` | 2 | 44, 56 |
| `src/components/api-catalog/StatsRow.tsx` | 2 | 38, 74 |
| `src/pages/DocumentsBrowsePage.tsx` | 2 | 192, 270 |
| `src/pages/AdminUsersPage.tsx` | 2 | 166, 226 |
| `src/components/PageWrappers.tsx` | 1 | 7 |
| `src/components/api-catalog/SearchBar.tsx` | 1 | 35 |
| `src/components/premium/ParticleField.tsx` | 1 | 9 |
| `src/components/premium/GlowingIcon.tsx` | 1 | 45 |
| `src/pages/ChatHistoryPage.tsx` | 1 | 30 |
| `src/pages/ChatNewPage.tsx` | 1 | 108 |
| `src/pages/AdminDocumentsPage.tsx` | 1 | 458 |
The heaviest offenders are the decorative gradient/glow systems in
`premium/*`, `api-catalog/*`, `EvidenceSidebar.tsx`, `AdminAnalyticsPage.tsx`
(Recharts series colours) and `LandingPage.tsx`. Recharts in particular takes
literal colour props, so it needs a token-reading bridge rather than a class swap
— worth a dedicated lane.

---

## 6. Gate output

```
$ npm run test:run
 Test Files  15 passed (15)
      Tests  116 passed (116)

$ npx tsc -b --noEmit
TypeScript: No errors found

$ npx eslint .
ESLint: No issues found

$ npm run build
✓ built in 315ms
```

The 112 pre-existing tests all still pass, unmodified. The 4 additional tests are
a new file, `src/context/ThemeContext.test.tsx`, covering the toggle: default
light, click flips `<html data-theme>` and the accessible name, the choice
persists across a remount, and `prefers-color-scheme` seeds the first visit.

**Browser check** (Chromium 1440×900 against the live backend on `:8000`, dev
server on `:5173`): login and dashboard confirmed in both themes; the toggle
measures 32×32, flips `data-theme` to `dark`, relabels to "Switch to light mode",
and survives a reload. No page errors. Screenshots in
`scratchpad/designs/../shots/{login,dashboard}-{light,dark}.png`.
