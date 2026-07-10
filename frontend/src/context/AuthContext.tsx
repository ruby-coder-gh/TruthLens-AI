import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import type { User } from '../api/types';
import {
  api,
  clearStoredTokens,
} from '../api/client';

// ─── Types ──────────────────────────────────────────────────────────────────
interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

// ─── Context ────────────────────────────────────────────────────────────────
const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Provider ───────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session on mount from HttpOnly cookie session
  useEffect(() => {
    let cancelled = false;

    api.auth
      .me()
      .then((loadedUser) => {
        if (!cancelled) {
          setUser(loadedUser);
        }
      })
      .catch(() => {
        // Session missing/expired
        clearStoredTokens();
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
  }, []);

  const register = useCallback(
    async (email: string, username: string, password: string) => {
      const res = await api.auth.register({ email, username, password });
      setUser(res.user);
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      // best-effort server logout
    }
    clearStoredTokens();
    setUser(null);
  }, []);

  const value: AuthContextValue = {
    user,
    isAuthenticated: user !== null,
    isLoading,
    login,
    register,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Hook ───────────────────────────────────────────────────────────────────
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
