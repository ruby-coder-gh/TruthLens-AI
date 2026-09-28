import {
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import type { User, DemoPersona } from '../api/types';
import {
  api,
  clearStoredTokens,
} from '../api/client';
import { AuthContext, HAD_SESSION_KEY, type AuthContextValue } from './auth-context';

// BUG-48: the session lives entirely in an HttpOnly cookie, so the frontend
// has no token it can read to know "am I logged in" without asking the
// server — but a plain, JS-readable flag ("I had a session before") lets a
// fresh/logged-out visitor's very first load skip that ask entirely, instead
// of always firing `/auth/me` and then a doomed `/auth/refresh` behind it
// (two 401s on every public-page load). A returning session still round-trips
// once, same as before, so an expired-access/valid-refresh reload still works.
function markHadSession(): void {
  try {
    localStorage.setItem(HAD_SESSION_KEY, '1');
  } catch {
    // Storage unavailable — this visit just won't get the skip on reload.
  }
}

function clearHadSession(): void {
  try {
    localStorage.removeItem(HAD_SESSION_KEY);
  } catch {
    // Storage unavailable — nothing to clear.
  }
}

function hadSessionBefore(): boolean {
  try {
    return localStorage.getItem(HAD_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

// ─── Provider ───────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // Lazy initializer, not a synchronous setState in the effect below —
  // never logged in on this browser (or explicitly logged out) means there
  // is nothing to restore, so `isLoading` starts already-false and no
  // `/auth/me` call happens at all.
  // ponytail: if localStorage is cleared independently of the HttpOnly
  // cookie (rare — different storage-clearing scope), a still-valid session
  // won't auto-restore until the next explicit login. Upgrade: have the
  // backend set a small non-HttpOnly "has session" cookie alongside the
  // real one, and read that instead of localStorage.
  const [isLoading, setIsLoading] = useState(() => hadSessionBefore());

  // Restore session on mount from HttpOnly cookie session
  useEffect(() => {
    let cancelled = false;

    if (!hadSessionBefore()) return undefined;

    api.auth
      .me()
      .then((loadedUser) => {
        if (!cancelled) {
          setUser(loadedUser);
          markHadSession();
        }
      })
      .catch(() => {
        // Session missing/expired
        clearStoredTokens();
        clearHadSession();
        if (!cancelled) {
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.auth.login({ email, password });
    setUser(res.user);
    markHadSession();
  }, []);

  const register = useCallback(
    async (email: string, username: string, password: string) => {
      const res = await api.auth.register({ email, username, password });
      setUser(res.user);
      markHadSession();
    },
    [],
  );

  const loginDemo = useCallback(async (persona: DemoPersona) => {
    const res = await api.demo.login(persona);
    setUser(res.user);
    markHadSession();
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      // best-effort server logout
    }
    clearStoredTokens();
    clearHadSession();
    setUser(null);
  }, []);

  const value: AuthContextValue = {
    user,
    isAuthenticated: user !== null,
    isLoading,
    login,
    register,
    logout,
    loginDemo,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
