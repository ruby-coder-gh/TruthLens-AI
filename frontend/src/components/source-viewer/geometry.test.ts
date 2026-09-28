import { describe, expect, it } from 'vitest';
import { rectToViewportBox } from './geometry';

describe('rectToViewportBox', () => {
  it('flips a PDF bottom-left rect into a top-left CSS overlay box', () => {
    // Identity scale, 100pt-tall page: the viewport only flips y.
    const viewport = { convertToViewportPoint: (x: number, y: number) => [x, 100 - y] };

    const box = rectToViewportBox([10, 20, 30, 40], viewport);

    expect(box).toEqual({ left: 10, top: 60, width: 20, height: 20 });
  });

  it('handles rects given corner-swapped (x1 < x0)', () => {
    const viewport = { convertToViewportPoint: (x: number, y: number) => [x, y] };

    const box = rectToViewportBox([30, 40, 10, 20], viewport);

    expect(box).toEqual({ left: 10, top: 20, width: 20, height: 20 });
  });
});
