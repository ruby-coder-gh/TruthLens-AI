import { createContext, useContext } from 'react';
import type { User } from '../api/types';

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
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
