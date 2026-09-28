import { createContext, useContext } from 'react';
import type { User, DemoPersona } from '../api/types';

// Auth context + hook live in a dedicated (non-component) module so `AuthProvider`
// can be co-located in AuthContext.tsx without tripping react-refresh's
// "only export components" rule.

export interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Owning lane: L10 (Demo FE). One-click sign-in as a seeded demo persona. */
  loginDemo: (persona: DemoPersona) => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

// BUG-48: exported (not just a local const in AuthContext.tsx) so tests can
// seed/assert it directly — mirrors THEME_STORAGE_KEY's split in theme-context.ts.
export const HAD_SESSION_KEY = 'truthlens:had-session';

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
