import '@testing-library/jest-dom/vitest';
import { MotionGlobalConfig } from 'framer-motion';

// framer-motion renders instantly instead of animating — keeps assertions
// synchronous and avoids flaky timing-dependent tests.
MotionGlobalConfig.skipAnimations = true;

// jsdom doesn't implement matchMedia — components like useMediaQuery call it
// directly, so a bare jsdom run throws "matchMedia is not a function".
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// jsdom doesn't implement scrollIntoView (ChatPage auto-scrolls on new messages).
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

// jsdom doesn't implement IntersectionObserver — framer-motion's `whileInView`
// (e.g. LandingPage's scroll-reveal sections) throws without it on mount.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  class MockIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null;
    readonly rootMargin: string = '';
    readonly thresholds: ReadonlyArray<number> = [];
    readonly scrollMargin: string = '';
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    takeRecords = () => [];
  }
  globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
}

// jsdom's canvas getContext() is unimplemented without the optional `canvas`
// npm package — components with canvas-based ambient effects (e.g. the
// Evidence sidebar's empty-state constellation) already null-guard on it, but
// the unstubbed call logs a noisy "Not implemented" error on every render.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

// Deterministic UUIDs — ChatPage mints message ids via crypto.randomUUID(),
// tests need stable, predictable values instead of real random ones.
let uuidCounter = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', {
  configurable: true,
  writable: true,
  value: vi.fn(() => {
    uuidCounter += 1;
    return `test-uuid-${uuidCounter}` as `${string}-${string}-${string}-${string}-${string}`;
  }),
});

// jsdom doesn't implement blob URL creation/revocation (used by export/download flows).
if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => 'blob:mock-url');
}
if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = vi.fn();
}

// jsdom doesn't implement the Clipboard API (used by "Copy" actions).
Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  writable: true,
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(''),
  },
});
