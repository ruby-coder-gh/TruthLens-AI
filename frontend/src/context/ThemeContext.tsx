import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import {
  ThemeContext,
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  getPreferredTheme,
  type Theme,
  type ThemeContextValue,
} from './theme-context';

// ─── Provider ───────────────────────────────────────────────────────────────
export function ThemeProvider({ children }: { children: ReactNode }) {
  // Lazy initialiser — the localStorage/matchMedia read happens once, not on
  // every render.
  const [theme, setTheme] = useState<Theme>(getPreferredTheme);

  // One effect owns both side effects, so `setTheme`/`toggleTheme` stay pure
  // state updates (and therefore referentially stable).
  useEffect(() => {
    document.documentElement.setAttribute(THEME_ATTRIBUTE, theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Storage unavailable (private mode / blocked cookies) — the theme still
      // applies for this session, it just won't survive a reload.
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
