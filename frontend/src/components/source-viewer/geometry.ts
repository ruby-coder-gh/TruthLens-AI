export interface OverlayBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Minimal shape this module needs from pdf.js's `PageViewport` — kept
 *  narrow so the math here doesn't require a runtime import of pdfjs-dist
 *  just for a type. */
interface ViewportLike {
  convertToViewportPoint(x: number, y: number): number[];
}

/**
 * Converts a `[x0, y0, x1, y1]` rect (backend's `ChunkLocation.rects`) into a
 * CSS-pixel box for an absolutely-positioned overlay div sized to match the
 * canvas's CSS dimensions at the given viewport's scale/rotation.
 *
 * The backend locates rects with PyMuPDF's `page.search_for` (see
 * `backend/app/ingestion/locate.py`), which returns coordinates in *page*
 * space: origin top-left, y increasing downward — the opposite of PDF user
 * space (origin bottom-left, y increasing upward), which is what
 * `viewport.convertToViewportPoint` expects as input. `pageHeight` (the same
 * PDF-point height PyMuPDF reports as `page.rect.height`) flips each y back
 * into PDF user space first, so `convertToViewportPoint`'s own bottom-left →
 * top-left flip lands the box the right way up instead of mirrored
 * (BUG-2: highlight boxes drawn upside down relative to the cited passage).
 *
 * Both corners are converted independently and then min/max'd rather than
 * assuming which corner ends up top-left, since `convertToViewportPoint`
 * also applies scale + rotation.
 */
export function rectToViewportBox(
  rect: readonly [number, number, number, number],
  viewport: ViewportLike,
  pageHeight: number,
): OverlayBox {
  const [x0, y0, x1, y1] = rect;
  const [vx0, vy0] = viewport.convertToViewportPoint(x0, pageHeight - y0);
  const [vx1, vy1] = viewport.convertToViewportPoint(x1, pageHeight - y1);
  return {
    left: Math.min(vx0, vx1),
    top: Math.min(vy0, vy1),
    width: Math.abs(vx1 - vx0),
    height: Math.abs(vy1 - vy0),
  };
}
