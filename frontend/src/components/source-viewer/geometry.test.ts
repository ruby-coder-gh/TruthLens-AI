import { describe, expect, it } from 'vitest';
import { rectToViewportBox } from './geometry';

describe('rectToViewportBox', () => {
  // BUG-2 regression: the backend (PyMuPDF `page.search_for`) reports rects
  // in page space — origin top-left, y increasing downward — not PDF user
  // space (origin bottom-left, y increasing upward). Feeding those
  // coordinates straight into `viewport.convertToViewportPoint` (which
  // expects PDF user space) mirrored every highlight vertically. This mock
  // viewport reproduces pdf.js's own bottom-left -> top-left flip for a
  // 100pt-tall, unscaled page, so a correct implementation must land a rect
  // near the *top* of page space back near the top of the CSS box, not the
  // bottom.
  const flippingViewport = { convertToViewportPoint: (x: number, y: number) => [x, 100 - y] };

  it('keeps a page-space rect near the top of the page near the top of the CSS box', () => {
    // Page-space rect: y0=20, y1=40 — close to the top of a 100pt page.
    const box = rectToViewportBox([10, 20, 30, 40], flippingViewport, 100);

    expect(box).toEqual({ left: 10, top: 20, width: 20, height: 20 });
  });

  it('keeps a page-space rect near the bottom of the page near the bottom of the CSS box', () => {
    // Page-space rect: y0=60, y1=80 — close to the bottom of a 100pt page.
    const box = rectToViewportBox([10, 60, 30, 80], flippingViewport, 100);

    expect(box).toEqual({ left: 10, top: 60, width: 20, height: 20 });
  });

  it('handles rects given corner-swapped (x1 < x0)', () => {
    const identityViewport = { convertToViewportPoint: (x: number, y: number) => [x, y] };

    const box = rectToViewportBox([30, 40, 10, 20], identityViewport, 100);

    expect(box).toEqual({ left: 10, top: 60, width: 20, height: 20 });
  });
});
