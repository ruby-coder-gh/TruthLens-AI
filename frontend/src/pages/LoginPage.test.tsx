import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/utils';
import LoginPage from './LoginPage';

describe('LoginPage', () => {
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
});
