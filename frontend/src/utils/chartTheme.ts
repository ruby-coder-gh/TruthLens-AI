import { useSyncExternalStore } from 'react';
import { THEME_ATTRIBUTE, type Theme } from '../context/theme-context';

/**
 * ─── The chart colour bridge ───────────────────────────────────────────────
 *
 * Recharts takes *literal* colour props (`stroke`, `fill`, `<Cell fill>`,
 * `contentStyle`), so a Tailwind class swap does nothing for it — a chart
 * written against hardcoded hex stays dark-theme-coloured on a light page.
 *
 * This module resolves the Grounded Glass design tokens off `<html>` at
 * runtime and hands them to the charts as plain strings:
 *
 *   1. `readChartPalette()` reads the resolved CSS custom properties with
 *      `getComputedStyle(document.documentElement)`.
 *   2. A module-level store caches one palette object and re-reads it when a
 *      `MutationObserver` sees `<html data-theme>` (or class/style) change,
 *      so the charts recolour live on the theme toggle.
 *   3. `useChartPalette()` exposes that store through `useSyncExternalStore`,
 *      which gives every consumer the *same* referentially-stable object —
 *      the memoisation is in the store, not in each component.
 *
 * It deliberately does **not** subscribe to `ThemeContext`: the observer works
 * without a provider (jsdom tests, the pre-paint bootstrap in `index.html`)
 * and also survives anything else that restyles the root.
 *
 * Every role falls back to the literal token value baked in below, so a
 * stylesheet-less environment (vitest runs with `css: false`) still gets real
 * colours instead of empty strings, which Recharts would render as invisible
 * marks.
 */

/** Colour roles a chart needs. Marks only — never text. */
export interface ChartPalette {
  /** Single-series line/bar colour. */
  accent: string;
  /** Second accent step, for a mark that must sit beside `accent`. */
  accentSoft: string;
  /** Status marks. Saturated fills — the text-safe inks are `--color-{green,orange,red}`. */
  good: string;
  warning: string;
  danger: string;
  /** Unclassified / "no status" mark. */
  neutral: string;
  /** Hairline gridline, one step off the surface. */
  grid: string;
  /** Baseline / axis rule — one step stronger than `grid`. */
  axis: string;
  /** Axis tick labels. This one *is* text, so it wears a contrast-checked ink. */
  axisText: string;
  /** The opaque surface a chart sits on — surface gaps and marker rings. */
  surface: string;
  /** Tooltip chrome. Opaque by the glass law: body text never sits on a blur. */
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  tooltipLabel: string;
}

type Role = keyof ChartPalette;

/** Role → the design token it reads. Add a role here and in both fallbacks. */
const TOKENS: Record<Role, string> = {
  accent: '--color-primary',
  accentSoft: '--color-primary-soft',
  good: '--color-green-mark',
  warning: '--color-orange-mark',
  danger: '--color-red-mark',
  neutral: '--color-text-dim',
  grid: '--color-border-light',
  axis: '--color-border',
  axisText: '--color-text-dim',
  surface: '--color-solid',
  tooltipBg: '--color-solid',
  tooltipBorder: '--color-border',
  tooltipText: '--color-text',
  tooltipLabel: '--color-text-muted',
};

const ROLES = Object.keys(TOKENS) as Role[];

/** Mirrors the `@theme` block in index.css. */
export const LIGHT_CHART_PALETTE: ChartPalette = {
  accent: '#4F46E5',
  accentSoft: '#4338CA',
  good: '#16A34A',
  warning: '#D97706',
  danger: '#DC2626',
  neutral: '#666D78',
  grid: 'rgba(0, 0, 0, 0.06)',
  axis: 'rgba(0, 0, 0, 0.10)',
  axisText: '#666D78',
  surface: '#FFFFFF',
  tooltipBg: '#FFFFFF',
  tooltipBorder: 'rgba(0, 0, 0, 0.10)',
  tooltipText: '#1F2328',
  tooltipLabel: '#5A6069',
};

/** Mirrors the `[data-theme="dark"]` block in index.css. */
export const DARK_CHART_PALETTE: ChartPalette = {
  accent: '#8B85FF',
  accentSoft: '#A9A5FF',
  good: '#34D399',
  warning: '#FBBF24',
  danger: '#F87171',
  neutral: '#BFC5CF',
  grid: 'rgba(255, 255, 255, 0.10)',
  axis: 'rgba(255, 255, 255, 0.16)',
  axisText: '#BFC5CF',
  surface: '#191D24',
  tooltipBg: '#191D24',
  tooltipBorder: 'rgba(255, 255, 255, 0.16)',
  tooltipText: '#EDEEF0',
  tooltipLabel: '#CFD4DD',
};

function fallbackFor(theme: Theme): ChartPalette {
  return theme === 'dark' ? DARK_CHART_PALETTE : LIGHT_CHART_PALETTE;
}

function themeOf(root: Element | null): Theme {
  return root?.getAttribute(THEME_ATTRIBUTE) === 'dark' ? 'dark' : 'light';
}

/**
 * Resolve the palette from a root element's computed style, falling back to the
 * baked-in token values for any property the stylesheet hasn't defined.
 *
 * Exported (and given an explicit `root`) so it can be unit-tested without the
 * store or React.
 */
export function readChartPalette(root?: Element | null): ChartPalette {
  const el = root === undefined
    ? (typeof document === 'undefined' ? null : document.documentElement)
    : root;
  const fallback = fallbackFor(themeOf(el));

  if (!el || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return fallback;
  }

  const computed = window.getComputedStyle(el);
  const resolved = {} as Record<Role, string>;
  for (const role of ROLES) {
    resolved[role] = computed.getPropertyValue(TOKENS[role]).trim() || fallback[role];
  }
  return resolved as ChartPalette;
}

function samePalette(a: ChartPalette, b: ChartPalette): boolean {
  return ROLES.every((role) => a[role] === b[role]);
}

// ─── Store ──────────────────────────────────────────────────────────────────
// One cached palette shared by every chart. `useSyncExternalStore` requires
// getSnapshot to return a stable reference between changes, which is exactly
// what this cache provides — and it means the observer runs once for the whole
// page rather than once per chart.

const listeners = new Set<() => void>();
let snapshot: ChartPalette | null = null;
let observer: MutationObserver | null = null;

function refresh(): void {
  const next = readChartPalette();
  if (snapshot && samePalette(snapshot, next)) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function getSnapshot(): ChartPalette {
  if (!snapshot) snapshot = readChartPalette();
  return snapshot;
}

function getServerSnapshot(): ChartPalette {
  return LIGHT_CHART_PALETTE;
}

function subscribe(listener: () => void): () => void {
  // Re-read before the first subscriber attaches: the theme may have flipped
  // while no chart was mounted, and React re-checks the snapshot right after
  // subscribing.
  if (listeners.size === 0) snapshot = readChartPalette();

  listeners.add(listener);

  if (
    !observer
    && typeof MutationObserver !== 'undefined'
    && typeof document !== 'undefined'
  ) {
    observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [THEME_ATTRIBUTE, 'class', 'style'],
    });
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && observer) {
      observer.disconnect();
      observer = null;
    }
  };
}

/** The live, theme-reactive chart palette. Stable reference until the theme changes. */
export function useChartPalette(): ChartPalette {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Test seam — drops the cache and any observer so each case starts clean. */
export function resetChartPaletteCache(): void {
  snapshot = null;
  observer?.disconnect();
  observer = null;
  listeners.clear();
}

// ─── Semantic helpers ───────────────────────────────────────────────────────

/**
 * Trust-score buckets ("0-20", "60-80", …) are ordered *status tiers*, not
 * identities, so they wear the status marks rather than a categorical ramp —
 * the same green/amber/red the badges use, at the same 0.5 / 0.75 thresholds
 * as `TRUST_THRESHOLDS`. Colour is redundant here: the bars are positionally
 * ordered and the x-axis labels the range, so nothing depends on hue alone.
 *
 * An unparseable label falls back to the neutral mark rather than guessing.
 */
export function trustBucketColor(range: string, palette: ChartPalette): string {
  const upper = Number(range.split('-')[1]);
  if (!Number.isFinite(upper)) return palette.neutral;
  if (upper <= 50) return palette.danger;
  if (upper <= 75) return palette.warning;
  return palette.good;
}

/** Badge tone → the mark colour a meter fill uses for the same severity. */
export function toneColor(
  tone: 'green' | 'blue' | 'orange' | 'red' | 'gray',
  palette: ChartPalette,
): string {
  switch (tone) {
    case 'green': return palette.good;
    case 'blue': return palette.accent;
    case 'orange': return palette.warning;
    case 'red': return palette.danger;
    default: return palette.neutral;
  }
}

/** Shared Recharts `<Tooltip>` chrome — opaque panel, token ink. */
export function tooltipStyles(palette: ChartPalette) {
  return {
    contentStyle: {
      backgroundColor: palette.tooltipBg,
      border: `1px solid ${palette.tooltipBorder}`,
      borderRadius: '12px',
      color: palette.tooltipText,
      boxShadow: 'var(--shadow-e2)',
    },
    labelStyle: { color: palette.tooltipLabel },
    itemStyle: { color: palette.tooltipText },
    cursor: { fill: palette.grid, stroke: palette.axis },
  } as const;
}

/**
 * Seed size for `<ResponsiveContainer initialDimension>`.
 *
 * Recharts starts the container at `{width: -1, height: -1}` and warns
 * ("The width(-1) and height(-1) of chart should be greater than 0…") on the
 * first render — before its own ResizeObserver has reported. Every chart in
 * the app lives in an `h-64` (256px) box, so handing that height over for the
 * one pre-measurement frame silences the warning without pretending to know
 * the width: the observer still supplies the real box on mount.
 */
export const CHART_INITIAL_DIMENSION = { width: 0, height: 256 };
