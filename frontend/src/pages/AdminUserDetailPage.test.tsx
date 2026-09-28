import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/utils';
import AdminUserDetailPage from './AdminUserDetailPage';

const { getUser, getUserActivity, updateUserRole } = vi.hoisted(() => ({
  getUser: vi.fn(),
  getUserActivity: vi.fn(),
  updateUserRole: vi.fn(),
}));

vi.mock('../api/client', () => ({
  adminApi: { getUser, getUserActivity, updateUserRole },
}));

const USER = {
  id: 'u-1',
  username: 'demo_analyst',
  email: 'analyst@truthlens.dev',
  role: 'user',
  is_active: true,
  // BUG-35: the API field is `last_login_at`, not `last_login`.
  last_login_at: '2026-09-20T10:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
};

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/users/:userId" element={<AdminUserDetailPage />} />
    </Routes>,
    { route: '/admin/users/u-1' },
  );
}

describe('AdminUserDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue(USER);
    getUserActivity.mockResolvedValue({ data: [] });
  });

  it('reads last_login_at, not the nonexistent last_login field', async () => {
    renderPage();
    // Exact clock time is timezone-dependent in CI; the date itself is not.
    expect(await screen.findByText(/Sep 20, 2026/)).toBeInTheDocument();
    expect(screen.queryByText('Never')).not.toBeInTheDocument();
  });

  it('shows "Never" when last_login_at is absent', async () => {
    getUser.mockResolvedValue({ ...USER, last_login_at: null });
    renderPage();
    expect(await screen.findByText('Never')).toBeInTheDocument();
  });

  // BUG-39: a role change used to fire on the <select>'s onChange with no
  // confirmation step.
  it('confirms before changing role, and does not call the API until confirmed', async () => {
    const user = userEvent.setup();
    updateUserRole.mockResolvedValue({ ...USER, role: 'admin' });
    renderPage();

    const roleSelect = await screen.findByLabelText('Change user role');
    await user.selectOptions(roleSelect, 'admin');
    expect(updateUserRole).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog', { name: /change role/i });
    await user.click(within(dialog).getByRole('button', { name: /^change role$/i }));

    await waitFor(() => expect(updateUserRole).toHaveBeenCalledWith('u-1', 'admin'));
  });
});
