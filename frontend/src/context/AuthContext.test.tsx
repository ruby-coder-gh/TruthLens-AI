import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from './AuthContext';
import { useAuth, HAD_SESSION_KEY } from './auth-context';
import { api, clearStoredTokens } from '../api/client';
import type { User } from '../api/types';

// This jsdom run has no usable `window.localStorage` (Node's experimental
// global shadows jsdom's and is inert without `--localstorage-file`).
// AuthProvider tolerates that (every access is try/caught), but BUG-48's
// "had a session before" gate is what several tests below assert, so install
// a minimal in-memory Storage. Mirrors ThemeContext.test.tsx's helper.
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

vi.mock('../api/client', () => ({
  api: {
    auth: {
      me: vi.fn(),
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    },
  },
  clearStoredTokens: vi.fn(),
}));

const mockUser: User = {
  id: 'user-1',
  email: 'a@example.com',
  username: 'a',
  role: 'user',
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

function Consumer() {
  const { user, isLoading } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="user">{user ? user.email : 'none'}</span>
    </div>
  );
}

describe('AuthContext / AuthProvider', () => {
  beforeEach(() => {
    installMemoryStorage();
    vi.mocked(api.auth.me).mockReset();
    vi.mocked(clearStoredTokens).mockClear();
  });

  it('sets the user and clears isLoading when me() resolves, for a returning session', async () => {
    window.localStorage.setItem(HAD_SESSION_KEY, '1');
    vi.mocked(api.auth.me).mockResolvedValueOnce(mockUser);

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );

    expect(screen.getByTestId('loading').textContent).toBe('true');

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('user').textContent).toBe('a@example.com');
  });

  it('clears stored tokens and leaves the user null when me() rejects, for a returning session', async () => {
    window.localStorage.setItem(HAD_SESSION_KEY, '1');
    vi.mocked(api.auth.me).mockRejectedValueOnce(new Error('unauthenticated'));

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('user').textContent).toBe('none');
    expect(clearStoredTokens).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(HAD_SESSION_KEY)).toBeNull();
  });

  it('BUG-48: never calls /auth/me for a visitor with no prior session, avoiding the 401 + doomed refresh', async () => {
    // No HAD_SESSION_KEY seeded — a fresh browser on a public page.
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('user').textContent).toBe('none');
    expect(api.auth.me).not.toHaveBeenCalled();
  });
});
