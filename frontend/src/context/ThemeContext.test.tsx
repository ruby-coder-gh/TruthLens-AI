import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from './ThemeContext';
import { THEME_STORAGE_KEY } from './theme-context';
import { ThemeToggle } from '../components/Layout';

// This jsdom run has no usable `window.localStorage` — Node's experimental
// global shadows jsdom's implementation and is inert without
// `--localstorage-file`. ThemeProvider tolerates that (every access is
// try/caught), but persistence is what we're asserting here, so install a
// minimal in-memory Storage for these tests only.
function installMemoryStorage() {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: storage,
  });
}

/** Point matchMedia('(prefers-color-scheme: dark)') at a fixed answer. */
function stubPrefersDark(prefersDark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('prefers-color-scheme: dark') ? prefersDark : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe('ThemeProvider + ThemeToggle', () => {
  beforeEach(() => {
    installMemoryStorage();
    document.documentElement.removeAttribute('data-theme');
    stubPrefersDark(false);
  });

  it('defaults to light and labels the toggle with the action it performs', () => {
    renderToggle();

    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
  });

  it('flips <html data-theme> and the accessible name when clicked', async () => {
    const user = userEvent.setup();
    renderToggle();

    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    // The label now offers the *other* direction, so the control is never
    // ambiguous about what pressing it will do.
    const backToLight = await screen.findByRole('button', { name: 'Switch to light mode' });
    expect(backToLight).toBeInTheDocument();

    await user.click(backToLight);

    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
  });

  it('persists the choice so it survives a reload', async () => {
    const user = userEvent.setup();
    const { unmount } = renderToggle();

    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    unmount();
    document.documentElement.removeAttribute('data-theme');

    // Remount with a *light* OS preference — the stored choice must still win.
    stubPrefersDark(false);
    renderToggle();

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
  });

  it('seeds from prefers-color-scheme when nothing is stored', () => {
    stubPrefersDark(true);

    renderToggle();

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
  });
});
