import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/utils';
import SettingsPage from './SettingsPage';
import type { User } from '../api/types';

vi.mock('../api/client', () => ({
  authApi: {
    updateMe: vi.fn(),
    changePassword: vi.fn(),
    deleteMe: vi.fn(),
  },
}));

const user: User = {
  id: 'u1',
  email: 'a@b.com',
  username: 'alice',
  role: 'user',
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

describe('SettingsPage — password visibility toggle (BUG-56)', () => {
  it('has an accessible name that flips with its state', async () => {
    const testUser = userEvent.setup();
    renderWithProviders(<SettingsPage />, { authValue: { user, isAuthenticated: true } });

    const toggle = screen.getByRole('button', { name: 'Show passwords' });
    expect(toggle).toBeInTheDocument();

    await testUser.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide passwords' })).toBeInTheDocument();
  });
});
