import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  DARK_CHART_PALETTE,
  LIGHT_CHART_PALETTE,
  readChartPalette,
  resetChartPaletteCache,
  toneColor,
  trustBucketColor,
  useChartPalette,
} from './chartTheme';

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
  resetChartPaletteCache();
});

describe('readChartPalette', () => {
  // vitest runs with `css: false`, so no design tokens are defined on <html>.
  // The bridge must still hand Recharts real colours — an empty string renders
  // as an invisible mark.
  it('falls back to the light token values when no stylesheet is loaded', () => {
    expect(readChartPalette(document.documentElement)).toEqual(LIGHT_CHART_PALETTE);
  });

  it('falls back to the dark token values under [data-theme="dark"]', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(readChartPalette(document.documentElement)).toEqual(DARK_CHART_PALETTE);
  });

  it('prefers a resolved custom property over the fallback', () => {
    document.documentElement.style.setProperty('--color-primary', '#0F0');
    expect(readChartPalette(document.documentElement).accent).toBe('#0F0');
  });

  it('never yields an empty colour for a role the stylesheet omits', () => {
    const palette = readChartPalette(document.documentElement);
    for (const value of Object.values(palette)) {
      expect(value).not.toBe('');
    }
  });
});

describe('useChartPalette', () => {
  it('re-reads the palette when <html data-theme> flips', async () => {
    const { result } = renderHook(() => useChartPalette());
    expect(result.current.accent).toBe(LIGHT_CHART_PALETTE.accent);

    act(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });

    // MutationObserver delivers on a microtask, so the update lands async.
    await waitFor(() => {
      expect(result.current.accent).toBe(DARK_CHART_PALETTE.accent);
    });
    expect(result.current.danger).toBe(DARK_CHART_PALETTE.danger);
  });

  it('keeps a stable reference while the theme is unchanged', () => {
    const { result, rerender } = renderHook(() => useChartPalette());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe('trustBucketColor', () => {
  it('maps buckets onto the status marks at the trust thresholds', () => {
    const p = LIGHT_CHART_PALETTE;
    expect(trustBucketColor('0-20', p)).toBe(p.danger);
    expect(trustBucketColor('40-50', p)).toBe(p.danger);
    expect(trustBucketColor('50-75', p)).toBe(p.warning);
    expect(trustBucketColor('80-100', p)).toBe(p.good);
  });

  it('falls back to the neutral mark for an unparseable bucket label', () => {
    expect(trustBucketColor('Bucket 1', LIGHT_CHART_PALETTE)).toBe(LIGHT_CHART_PALETTE.neutral);
  });
});

describe('toneColor', () => {
  it('maps every badge tone onto a mark colour', () => {
    const p = DARK_CHART_PALETTE;
    expect(toneColor('green', p)).toBe(p.good);
    expect(toneColor('blue', p)).toBe(p.accent);
    expect(toneColor('orange', p)).toBe(p.warning);
    expect(toneColor('red', p)).toBe(p.danger);
    expect(toneColor('gray', p)).toBe(p.neutral);
  });
});
