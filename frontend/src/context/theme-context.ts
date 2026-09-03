import { createContext, useContext } from 'react';

// Theme context + hook live in a dedicated (non-component) module so
// `ThemeProvider` can be co-located in ThemeContext.tsx without tripping
// react-refresh's "only export components" rule — same split as auth-context.

export type Theme = 'light' | 'dark';

export interface ThemeContextValue {
  /** The theme currently applied to <html data-theme="…">. */
  theme: Theme;
  /** Explicitly select a theme. */
  setTheme: (theme: Theme) => void;
  /** Flip between light and dark. */
  toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

/** localStorage key holding the user's explicit choice, if they've made one. */
export const THEME_STORAGE_KEY = 'truthlens:theme';

/** Attribute the Grounded Glass dark token block keys off. */
export const THEME_ATTRIBUTE = 'data-theme';

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

/**
 * The theme to start on: a previously persisted choice if there is one,
 * otherwise the OS `prefers-color-scheme`, otherwise light (the design
 * direction's default).
 *
 * Reads are wrapped because `localStorage` throws in Safari private mode and
 * under some enterprise cookie policies — a theme lookup must never be able to
 * take the app down.
 */
export function getPreferredTheme(): Theme {
  if (typeof window === 'undefined') return 'light';

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    // Storage unavailable — fall through to the OS preference.
  }

  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  return 'light';
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
