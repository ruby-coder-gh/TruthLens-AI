import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/utils';
import AdminUsersPage from './AdminUsersPage';

const { listUsers, updateUserRole, updateUserStatus } = vi.hoisted(() => ({
  listUsers: vi.fn(),
  updateUserRole: vi.fn(),
  updateUserStatus: vi.fn(),
}));

vi.mock('../api/client', () => ({
  adminApi: { listUsers, updateUserRole, updateUserStatus },
}));

const USERS = [
  {
    id: 'u-1', username: 'viewer2_qa', email: 'viewer2_qa@truthlens.dev', role: 'user', is_active: true,
    last_login_at: '2026-09-20T10:00:00Z', created_at: '2026-01-01T00:00:00Z',
  },
];

function renderPage() {
  return renderWithProviders(<AdminUsersPage />);
}

// BUG-39: the list's inline role select and Deactivate button used to fire
// on the spot, with no confirmation — a viewer got promoted to admin with
// one accidental click.
describe('AdminUsersPage — role/status confirmation (BUG-39)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listUsers.mockResolvedValue({ data: USERS, meta: { page: 1, page_size: 20, total: 1 } });
  });

  it('confirms before changing role, and does not call the API until confirmed', async () => {
    const user = userEvent.setup();
    updateUserRole.mockResolvedValue({ ...USERS[0], role: 'admin' });
    renderPage();

    const roleSelect = await screen.findByLabelText('Change user role');
    await user.selectOptions(roleSelect, 'admin');
    expect(updateUserRole).not.toHaveBeenCalled();
    // The select itself stays on the current role until confirmed.
    expect(roleSelect).toHaveValue('user');

    const dialog = await screen.findByRole('dialog', { name: /change role/i });
    await user.click(within(dialog).getByRole('button', { name: /^change role$/i }));

    await waitFor(() => expect(updateUserRole).toHaveBeenCalledWith('u-1', 'admin'));
  });

  it('confirms before deactivating, and does not call the API until confirmed', async () => {
    const user = userEvent.setup();
    updateUserStatus.mockResolvedValue({ ...USERS[0], is_active: false });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /deactivate user/i }));
    expect(updateUserStatus).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog', { name: /confirm action/i });
    await user.click(within(dialog).getByRole('button', { name: /^deactivate$/i }));

    await waitFor(() => expect(updateUserStatus).toHaveBeenCalledWith('u-1', false));
  });

  it('cancelling the role-change dialog leaves the role unchanged', async () => {
    const user = userEvent.setup();
    renderPage();

    const roleSelect = await screen.findByLabelText('Change user role');
    await user.selectOptions(roleSelect, 'admin');

    const dialog = await screen.findByRole('dialog', { name: /change role/i });
    await user.click(within(dialog).getByRole('button', { name: /^cancel$/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(updateUserRole).not.toHaveBeenCalled();
  });
});
