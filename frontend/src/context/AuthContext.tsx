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
  setStoredTokens,
  clearStoredTokens,
  getStoredAccessToken,
} from '../api/client';

// ─── Types ──────────────────────────────────────────────────────────────────
interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => void;
}

// ─── Context ────────────────────────────────────────────────────────────────
const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Provider ───────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session on mount
  useEffect(() => {
    const token = getStoredAccessToken();
    if (!token) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    api.auth
      .me()
      .then((loadedUser) => {
        if (!cancelled) {
          setUser(loadedUser);
        }
      })
      .catch(() => {
        // Token invalid or expired — clear
        clearStoredTokens();
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
    setStoredTokens(res.access_token, res.refresh_token);
    setUser(res.user);
  }, []);

  const register = useCallback(
    async (email: string, username: string, password: string) => {
      const res = await api.auth.register({ email, username, password });
      setStoredTokens(res.access_token, res.refresh_token);
      setUser(res.user);
    },
    [],
  );

  const logout = useCallback(() => {
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
