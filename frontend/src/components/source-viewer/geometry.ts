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
 * Converts a `[x0, y0, x1, y1]` PDF-space rect (backend's
 * `ChunkLocation.rects`, bottom-left origin, PDF points) into a CSS-pixel
 * box for an absolutely-positioned overlay div sized to match the canvas's
 * CSS dimensions at the given viewport's scale/rotation.
 *
 * `viewport.convertToViewportPoint` already applies pdf.js's full
 * transform (scale + the bottom-left → top-left flip + rotation), so both
 * corners are converted independently and then min/max'd rather than
 * assuming which corner ends up top-left.
 */
export function rectToViewportBox(
  rect: readonly [number, number, number, number],
  viewport: ViewportLike,
): OverlayBox {
  const [x0, y0, x1, y1] = rect;
  const [vx0, vy0] = viewport.convertToViewportPoint(x0, y0);
  const [vx1, vy1] = viewport.convertToViewportPoint(x1, y1);
  return {
    left: Math.min(vx0, vx1),
    top: Math.min(vy0, vy1),
    width: Math.abs(vx1 - vx0),
    height: Math.abs(vy1 - vy0),
  };
}
