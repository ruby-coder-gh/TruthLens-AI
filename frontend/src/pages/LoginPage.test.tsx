import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/utils';
import LoginPage from './LoginPage';
import { useReady } from '../hooks/useReady';
import type { UseReadyResult } from '../hooks/useReady';

vi.mock('../hooks/useReady', () => ({ useReady: vi.fn() }));

function mockReady(overrides: Partial<UseReadyResult> = {}) {
  vi.mocked(useReady).mockReturnValue({
    demoMode: false,
    warm: false,
    demoWorkspaceId: null,
    models: undefined,
    ollama: undefined,
    isLoading: false,
    ...overrides,
  });
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.mocked(useReady).mockReset();
    mockReady();
  });

  it('shows validation messages when submitting an empty form', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { route: '/login' });

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/email is required/i)).toBeInTheDocument();
    expect(screen.getByText(/password is required/i)).toBeInTheDocument();
  });

  it('calls login and navigates to /workspaces on a valid submit', async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockResolvedValue(undefined);

    renderWithProviders(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/workspaces" element={<div>Workspaces Home</div>} />
      </Routes>,
      { route: '/login', authValue: { login } },
    );

    await user.type(screen.getByLabelText('Email'), 'user@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(login).toHaveBeenCalledWith('user@example.com', 'password123'),
    );
    expect(await screen.findByText('Workspaces Home')).toBeInTheDocument();
  });

  it('hides the one-click demo panel outside demo mode', () => {
    renderWithProviders(<LoginPage />, { route: '/login' });
    expect(screen.queryByText(/one-click demo/i)).not.toBeInTheDocument();
  });

  it('one-click Analyst login navigates to the demo workspace chat', async () => {
    mockReady({ demoMode: true, demoWorkspaceId: 'ws-demo-1' });
    const loginDemo = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderWithProviders(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/workspaces/:id/chat" element={<div>Demo Chat</div>} />
      </Routes>,
      { route: '/login', authValue: { loginDemo } },
    );

    await user.click(screen.getByRole('button', { name: /^analyst$/i }));

    await waitFor(() => expect(loginDemo).toHaveBeenCalledWith('analyst'));
    expect(await screen.findByText('Demo Chat')).toBeInTheDocument();
  });

  it('one-click Admin login navigates to /admin', async () => {
    mockReady({ demoMode: true, demoWorkspaceId: 'ws-demo-1' });
    const loginDemo = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderWithProviders(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin" element={<div>Admin Home</div>} />
      </Routes>,
      { route: '/login', authValue: { loginDemo } },
    );

    await user.click(screen.getByRole('button', { name: /^admin$/i }));

    await waitFor(() => expect(loginDemo).toHaveBeenCalledWith('admin'));
    expect(await screen.findByText('Admin Home')).toBeInTheDocument();
  });

  it('shows an error when the one-click demo login fails', async () => {
    mockReady({ demoMode: true, demoWorkspaceId: 'ws-demo-1' });
    const loginDemo = vi.fn().mockRejectedValue(new Error('Demo login failed. Please try again.'));
    const user = userEvent.setup();

    renderWithProviders(<LoginPage />, { route: '/login', authValue: { loginDemo } });

    await user.click(screen.getByRole('button', { name: /^analyst$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/demo login failed/i);
  });
});
