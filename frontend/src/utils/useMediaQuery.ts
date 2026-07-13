import { useState, useEffect } from 'react';

const getMatch = (query: string): boolean =>
  typeof window !== 'undefined' ? window.matchMedia(query).matches : false;

/**
 * Reactive `matchMedia` hook — tracks a CSS media query and updates on
 * viewport resize / orientation change (unlike a one-shot `window.innerWidth`
 * read, which only reflects the value at first render).
 *
 * SSR-safe: guards on `typeof window` so it can be imported into modules that
 * might (in theory) be evaluated outside a browser context; this is a Vite SPA
 * so `window` is always defined in practice, but the guard is cheap insurance.
 */
export function useMediaQuery(query: string): boolean {
  // Recomputed directly during render (matchMedia() is cheap) so a changed
  // `query` is reflected immediately, without a setState-in-effect roundtrip.
  const [matches, setMatches] = useState(() => getMatch(query));
  const current = getMatch(query);
  if (current !== matches) setMatches(current);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mql = window.matchMedia(query);
    const handleChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, [query]);

  return matches;
}
