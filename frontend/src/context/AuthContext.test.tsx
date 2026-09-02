import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from './AuthContext';
import { useAuth } from './auth-context';
import { api, clearStoredTokens } from '../api/client';
import type { User } from '../api/types';

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
    vi.mocked(api.auth.me).mockReset();
    vi.mocked(clearStoredTokens).mockClear();
  });

  it('sets the user and clears isLoading when me() resolves', async () => {
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

  it('clears stored tokens and leaves the user null when me() rejects', async () => {
    vi.mocked(api.auth.me).mockRejectedValueOnce(new Error('unauthenticated'));

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('user').textContent).toBe('none');
    expect(clearStoredTokens).toHaveBeenCalledTimes(1);
  });
});
