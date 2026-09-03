# GG-6 — the public/auth surface and the decorative systems

**Branch:** `worktree-agent-a6a5475eaf54677e9` (off `feat/grounded-glass-ui`)
**Scope:** `pages/{Landing,Login,Register,ForgotPassword,ResetPassword,Privacy,Terms,Contact,NotFound,ApiCatalog}` + `components/premium/*`
**Files touched:** 12 — all inside my lane. No test file, no `index.css`, no other lane's file.
**Net:** +316 / −664. Most of the deletion is decorative machinery, not markup.

No token was added, renamed or re-valued: every colour in this lane resolved to a
token the foundation lane already ships. No route, prop signature, state shape,
API call or **copy string** changed.

---

## 1. The two flagged carry-overs

### 1a. `LandingPage` / `NotFoundPage` had no ground — *not reproduced as described*

Both pages already rendered `<div className="bg-grid" />`; `git log -S` puts it
there since `4d620d7`, well before the foundation lane. So the flag as written
("render no `.bg-grid`") doesn't hold against the current tree, and the ruled
ground does paint on both — confirmed in the browser, see `landing-light.png`
and `404-light.png`, where the 32px ruling and both washes are visible.

What *was* wrong is that both pages also carried three `.ambient-blob` divs, which
the foundation lane had set to `display:none`. They rendered nothing and read as
dead Midnight markup sitting on top of the ground element. Removed from both, and
the `bg-grid` div now carries a comment explaining why an opaque-`bg-bg` page has
to re-paint the ground itself, so the next person doesn't delete it.

`.ambient-blob { display: none }` stays in `index.css` untouched — other lanes'
pages still emit those divs.

### 1b. The `premium/*` decorative system — re-themed, and mostly removed

The surface literals were already fixed by the foundation lane. What remained was
a set of effects built to make things *glow out of a near-black page*. On a light
frosted ground a glow has nothing to bloom into; it smears. Each one, and what I
did with it:

| Effect | Was | Now | Why |
| --- | --- | --- | --- |
| `PremiumButton` primary fill | frozen `#a5b4fc→#6366f1→#4f46e5` gradient + `boxShadow rgba(99,102,241,.3)` | `bg-primary` + `shadow-e2`, `hover:bg-primary-dark` | the board's submit is a flat accent fill; the gradient is a Midnight literal that never flips |
| `PremiumButton` gradient pan | 4s infinite `backgroundPosition` loop | **dropped** | a permanently animating primary button; nothing is happening, so nothing should move |
| `PremiumButton` `BorderBeam` | 3s infinite rotating conic ring cycling **indigo → green → red** | **dropped** | a rainbow ring around the one control that has to look trustworthy reads as a novelty. It also introduced two hues that exist nowhere else in this direction |
| `PremiumButton` `ParticleSpark` | 4 particles fired upward on click | **dropped** | a firework on submit is not this direction's language |
| `PremiumButton` hover bloom | `0 0 30px indigo, 0 0 60px green` | **dropped** | two-hue bloom; hover is now a colour step |
| `PremiumButton` ripple | `bg-white/30` | kept, retinted to `bg-current` | this is press *feedback*, not decoration. `bg-current` picks up each variant's own ink so it reads on the accent fill, on glass and on the danger tint |
| `AnimatedInput` focus glow | blurred `indigo→green` gradient halo bled around the field | **dropped**, replaced by the board's ring: `border-primary` + `0 0 0 3px var(--color-primary-glow)` | a soft halo on a white page looks like a rendering artefact |
| `AnimatedInput` label/icon focus | JS-animated to raw `rgba(99,102,241,.9)` | CSS transition to `text-primary-soft` | that literal lands **under 4.5:1** on a white field; `primary-soft` is the text-safe ink (7.28:1 light / 5.92:1 dark) |
| `InputActionButton` pulse | infinite box-shadow pulse in **both** states | **dropped**; active is now `bg-primary/12` + `border-primary/40` | an idle button was breathing indigo light forever. A tint plus an edge is a stronger signal and costs one paint |
| `GlowingIcon` glow + burst | infinite box-shadow pulse at rest *and* active, plus a 6-particle burst on a 2s loop, plus a `drop-shadow` on the glyph | **dropped**; active is a flat tint + edge | same reasoning; state is stated, not radiated |
| `GlowingIcon` colour plumbing | hex-alpha concatenation (`${color}40`) forced the default to a Midnight hex | `color-mix(in srgb, ${color} …%, transparent)` | lets the default be `var(--color-primary)`, so it flips with the theme. `ReportBuilderWizard`'s `color="#34d399"` override still works unchanged |
| `ParticleField` | canvas + `requestAnimationFrame` forever: 30 drifting dots, per-frame **O(n²)** proximity mesh, a resize listener, and a `color` prop that was silently ignored in favour of a hardcoded `rgba(99,102,241,…)` | **dropped the animation entirely**; now one static div painting two radial washes | see below |
| Auth page backgrounds | a 20s infinite pan-gradient wash + 4–5 drifting `Sparkles`/`Logo` particles on **every** auth screen | **dropped** | see below |
| Auth `gradient-text` headings | `.gradient-text` clipped fill | flat `text-text` | gradient-clipped text has no measurable contrast |
| Auth logo tile | 3-stop gradient + `shadow-2xl shadow-primary/30` + an infinitely pulsing `border-white/10` ring | `bg-primary` + `shadow-e1` | |
| Auth bottom hairline | animated `via-primary/30` gradient rule | **dropped** | pure ornament under the form |
| 404 numeral | `bg-clip-text` gradient | flat `text-primary-soft` | |

**Why `ParticleField` lost its animation rather than being re-tinted.** The
foundation lane's own note is that this direction's depth comes from "the ruled
ground and the two static washes on it, not from animated blur". A live particle
mesh contradicts that premise, and on a light panel 30 indigo dots joined by
faint lines read as dirt on the screen rather than as atmosphere. It also ran a
`requestAnimationFrame` loop with a 900-comparison inner loop per frame,
regardless of visibility or `prefers-reduced-motion`.

I could not delete the component (`SettingsPage` imports it, another lane), so I
kept the export and both props and rewrote the body to express the *intent* — a
soft off-axis lift behind a panel — in the ground's own language: two static
radial washes on a single div. `count` now scales wash strength, `color` its hue.
No canvas, no rAF, no listener, nothing to clean up.

**Why the auth pages lost their background layer.** The `Login.dc.html` board is
explicit about this, and the board's own annotation says it better than I can:
*"The landing page carries the trust story. The sign-in form carries none of it —
no marketing, no SSO buttons, no demo credentials, no remember-me. Anything
decorative here reads as an attempt to look legitimate."* The ruled ground from
`<body>` is now the entire background on all four auth screens.

**Measured result:** `document.getAnimations()` on `/login` reports **0 infinite
animations** in both themes, down from a pan loop, a border beam, a gradient pan,
a logo-ring pulse and 4 particle loops.

---

## 2. Everything else in the lane

**`LandingPage`** — header to `bg-glass` + `border-border-light`; hero eyebrow to
the accent tint/edge/ink triad; the panel halo (`-inset-10 … blur-3xl`) removed in
favour of `shadow-e3`; the hero panel, workflow panel and closing CTA to `.glass`
+ `rounded-panel`; the question block and step cards to `bg-solid` + `border-border`
(glass law — quoted content and body text inside an L2 card sit on an opaque
surface, never a third blur); source rows to `bg-card-hover`, with `verified`
moved from `text-accent` to `text-green` plus a check glyph so the state is not
colour-only; trust-bar track to `bg-card-2` and the fills off Tailwind stock
(`bg-emerald-400` / `bg-amber-400`) onto `bg-green` / `bg-orange`; the three
highlight boxes replaced by the board's stat row on a `border-t` rule; headings
from `font-bold` to the ramp's 600.

**`NotFoundPage`** — flat `text-primary-soft` numeral, `shadow-e3` card, ground
comment, blobs removed.

**`ContactPage`** — the two nested `Card`s were an L2 glass surface inside
`LegalPageLayout`'s L2 glass card, i.e. a third blur. Replaced with plain
`bg-solid` tiles with a hairline edge. `Card` import dropped.

**`ApiCatalogPage`** — mobile panel `bg-[#0b0f17]/95` → `bg-solid/95`,
`border-white/[0.06]` → `border-border`. The `bg-black/60` scrim is left alone,
as GG-1 flagged it as intentional in both themes.

**`PrivacyPage` / `TermsPage`** — inspected, **no change needed**. They only use
`text-primary-soft` and `text-text`, which the token remap already handles.

Grep across the whole lane for `white/[`, `#0b0f17`, `rgba(99,102,241`,
`rgba(52,211,153`, `emerald-`, `amber-`, `bg-clip-text`, `gradient-text`,
`ambient-blob` returns nothing but one explanatory comment.

---

## 3. Accessibility

### 3a. Contrast — 102 pairs, 0 failures

Every text/background pair I introduced, computed with the WCAG 2.x sRGB formula
over the **composited** surface (translucent glass resolved onto the worst-case
ground, i.e. the page background with the strongest wash on it), in both themes.
Script: `scratchpad/contrast.py`.

Three light-theme pairs failed on the first pass and were fixed, not waived:

| Pair | Before | Fix | After |
| --- | --: | --- | --: |
| `InputActionButton` rest ink on `card-2` | 4.43 | `text-dim` → `text-muted` | **5.38** |
| Landing stat label on the ground | 4.24 | `text-dim` → `text-muted` | **5.15** |
| Reset bad-token tile | 4.48 | `bg-red/10` → `bg-red/8` | **4.63** |

`text-text-dim` clears 4.5:1 on `card` (4.81) and on `solid` (5.22) but **not** on
the bare washed ground (4.24) — worth knowing for the other lanes.

Tightest surviving pairs, light: Reset bad-token 4.63, Hero bar label 4.81,
PremiumButton danger 4.88, Auth alert 5.04. Nothing relies on the large-text 3:1
allowance except items that genuinely are large text or icons, and those are
marked as such in the script.

### 3b. Keyboard — one real defect found and fixed

**The primary CTA had an invisible focus ring.** The global
`button:focus-visible { outline: 2px solid var(--color-primary) }` in `index.css`
resolves its outline colour to the element's own `currentColor` on buttons and
links (it resolves correctly on `input`). On `PremiumButton` primary that means a
**white** ring in light and a **near-black** ring in dark — both invisible.
Verified by screenshot before the fix.

Fixed inside `PremiumButton` with a `ring-*` utility, which paints `box-shadow`
and therefore isn't in the unlayered rule's way:
`focus-visible:ring-2 ring-primary ring-offset-2 ring-offset-bg`. Confirmed
painting as fill → 2px ground gap → 2px accent band at 4× zoom in both themes
(`focus-ring-zoom-{light,dark}.png`), with `shadow-e2` preserved alongside.

Also fixed:
- The show/hide password toggles on `LoginPage` and `ResetPasswordPage` carried
  `tabIndex={-1}`, i.e. they were unreachable by keyboard. Removed; both are now
  in the tab ring (verified: `tabIndex: 0`, and the full ring is
  email → forgot → password → toggle → submit → create).
- `AnimatedInput` now wires `aria-invalid` and `aria-describedby` to its error
  paragraph (verified in the DOM: `aria-describedby="email-error"` →
  "Email is required").
- That toggle was also positioned `top-1/2` of a wrapper that grows by the error
  line, so it slid off the field whenever an error showed. Anchored to the field
  row instead.
- Landing's `verified` and the guarantee list now pair colour with a glyph.

`GlowingIcon` deliberately does **not** get `aria-pressed`: its one call site
passes an action label ("Dismiss report generated confirmation"), and a toggle
state on an action name reads as a contradiction — the same conflict GG-1 noted
for the theme toggle.

---

## 4. Gates

```
$ npx tsc -b --noEmit      TypeScript: No errors found
$ npx eslint .             ESLint: No issues found
$ npm run test:run         Test Files  15 passed (15)
                                Tests  116 passed (116)
$ npm run build            ✓ built in 283ms
```

116/116 — the same 116 as the pre-work baseline. No test file was edited.
`LoginPage.test.tsx` in particular still passes untouched: the `Email` /
`Password` label associations, the validation strings and the `/workspaces`
navigation all survive the restyle.

**Browser** (Chromium 1440×900, dev server `:5185`, live backend `:8000`):
landing, login, register, 404 and forgot-password in **both** themes, plus the
login validation-error state and the keyboard focus ring. `data-theme` asserted
on every capture. **No page errors** — the only console output is the expected
401s from an unauthenticated visitor hitting the API.

Probed live rather than assumed: `shadow-e3` does win over `Card`'s `shadow-e1`
(resolved box-shadow equals `--e3` in both themes); the submit fill and ink flip
correctly (`#4F46E5`/white → `#8B85FF`/`#0F1115`); the focused field ring is
`border-primary` + `3px primary-glow` in both themes.

Screenshots in `scratchpad/shots-gg6/`:
`{landing,login,register,404,forgot}-{light,dark}.png`,
`login-errors-{light,dark}.png`, `focus-ring-zoom-{light,dark}.png`.

---

## 5. Handoffs

1. **The global focus-outline rule is broken app-wide** (`index.css`, foundation's
   lane). `outline: 2px solid var(--color-primary)` falls back to `currentColor`
   on `button`/`a` in Chromium — so every button whose text colour is light gets
   a light ring. I patched only my own primary CTA; `ui.tsx`'s `Button` and every
   hand-rolled `motion.button` in the app have the same latent defect. A one-line
   fix at source (e.g. `outline-color` as its own declaration) would cover all of
   them.
2. **`components/Logo.tsx`** (not my lane) still hardcodes `#a5b4fc→#6366f1→#34d399`
   and a `#0b0f17` pupil, and `variant="gradient-bg"` still carries
   `text-white shadow-primary/30`. It reads acceptably on the accent tile I gave
   it, but it is the last Midnight literal on the auth screens.
3. **`SettingsPage.tsx:193`** passes `color="#6366f1"` to `ParticleField`. The
   component now defaults to `var(--color-primary)`; dropping that literal at the
   call site is a one-word change and makes the wash theme-reactive.
4. **`ReportBuilderWizard.tsx:281`** passes `color="#34d399"` to `GlowingIcon` —
   still works, but `var(--color-green)` would flip with the theme. Its copy
   ("Select the glow icon…") also now describes an effect that no longer glows;
   that is a copy change, so I left it.
5. **Possible missing token.** `--color-orange` is the text-safe amber *ink*
   (`#9A4508`), and it is the only amber available for a *fill*. As the 6px
   "Citation coverage" bar on the landing hero it reads deep rust in light (it is
   correct and passes at 5.52:1, and looks right in dark). If the design lead
   wants the board's brighter `#D97706` fill, that needs a new
   `--color-orange-fill` token — a foundation decision, not mine.
