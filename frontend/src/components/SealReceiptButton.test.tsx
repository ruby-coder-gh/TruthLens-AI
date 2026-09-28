import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/utils';
import { SealReceiptButton } from './SealReceiptButton';
import type { ReceiptCreated, ReceiptSummary } from '../api/types';

const { mockCreate, mockList, mockRevoke, mockWorkspaceGet, mockListMembers } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockList: vi.fn(),
  mockRevoke: vi.fn(),
  mockWorkspaceGet: vi.fn(),
  mockListMembers: vi.fn(),
}));

vi.mock('../api/client', () => ({
  receiptApi: { create: mockCreate, listForQuery: mockList, revoke: mockRevoke },
  workspaceApi: { get: mockWorkspaceGet, listMembers: mockListMembers },
}));

const created: ReceiptCreated = {
  token: 'tok_abcdef1234567890',
  url_path: '/r/tok_abcdef1234567890',
  seal: 'a1b2c3d4e5f6789900112233445566778899aabbccddeeff0011223344556677',
  created_at: '2026-09-28T10:00:00Z',
};

beforeEach(() => {
  mockCreate.mockReset();
  mockList.mockReset();
  mockRevoke.mockReset();
  mockWorkspaceGet.mockReset();
  mockListMembers.mockReset();
  mockList.mockResolvedValue([]);
});

describe('SealReceiptButton', () => {
  it('creates a receipt and shows the public link, QR code, and short seal', async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue(created);

    renderWithProviders(<SealReceiptButton queryId="q-1" />);

    await user.click(screen.getByRole('button', { name: /seal receipt/i }));
    await user.click(await screen.findByRole('button', { name: /create public receipt/i }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith('q-1'));

    const expectedLink = `${window.location.origin}${created.url_path}`;
    expect(await screen.findByDisplayValue(expectedLink)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(created.seal.slice(0, 12)))).toBeInTheDocument();
  });

  it('lists existing receipts for the query and revokes one after confirming (R2-17)', async () => {
    const user = userEvent.setup();
    const existing: ReceiptSummary[] = [
      {
        token: 'tok_existing',
        url_path: '/r/tok_existing',
        seal: 'deadbeef00112233445566778899aabbccddeeff0011223344556677889900',
        created_at: '2026-09-01T00:00:00Z',
        revoked_at: null,
        view_count: 3,
      },
    ];
    mockList.mockResolvedValue(existing);
    mockRevoke.mockResolvedValue(undefined);

    renderWithProviders(<SealReceiptButton queryId="q-1" />);
    await user.click(screen.getByRole('button', { name: /seal receipt/i }));

    expect(await screen.findByText(/existing receipts for this answer/i)).toBeInTheDocument();

    // First click only asks for confirmation — it must not revoke yet.
    await user.click(screen.getByRole('button', { name: /revoke this receipt/i }));
    expect(mockRevoke).not.toHaveBeenCalled();
    expect(screen.getByText('Revoke?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith('tok_existing'));
    expect(await screen.findByText(/revoked/i)).toBeInTheDocument();
  });

  it('cancels a pending revoke without calling the API (R2-17)', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue([
      {
        token: 'tok_existing',
        url_path: '/r/tok_existing',
        seal: 'deadbeef00112233445566778899aabbccddeeff0011223344556677889900',
        created_at: '2026-09-01T00:00:00Z',
        revoked_at: null,
        view_count: 3,
      },
    ]);

    renderWithProviders(<SealReceiptButton queryId="q-1" />);
    await user.click(screen.getByRole('button', { name: /seal receipt/i }));
    await user.click(await screen.findByRole('button', { name: /revoke this receipt/i }));
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(mockRevoke).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /revoke this receipt/i })).toBeInTheDocument();
  });

  it('hides the Seal receipt trigger for a viewer of the given workspace (R2-6)', async () => {
    mockWorkspaceGet.mockResolvedValue({
      id: 'ws-1', name: 'WS', description: '', owner_id: 'owner-1', member_count: 2, document_count: 1, created_at: '', updated_at: '',
    });
    mockListMembers.mockResolvedValue({
      data: [{ id: 'm-1', workspace_id: 'ws-1', user_id: 'viewer-1', role: 'viewer', username: 'viewer', email: 'v@x.com', joined_at: '' }],
    });

    renderWithProviders(<SealReceiptButton queryId="q-1" workspaceId="ws-1" />, {
      authValue: { user: { id: 'viewer-1', email: 'v@x.com', username: 'viewer', role: 'analyst', is_active: true, created_at: '', updated_at: '' }, isAuthenticated: true },
    });

    await waitFor(() => expect(screen.queryByRole('button', { name: /seal receipt/i })).not.toBeInTheDocument());
  });
});
