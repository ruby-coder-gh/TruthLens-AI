import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/utils';
import { SealReceiptButton } from './SealReceiptButton';
import type { ReceiptCreated, ReceiptSummary } from '../api/types';

const { mockCreate, mockList, mockRevoke } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockList: vi.fn(),
  mockRevoke: vi.fn(),
}));

vi.mock('../api/client', () => ({
  receiptApi: { create: mockCreate, listForQuery: mockList, revoke: mockRevoke },
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

  it('lists existing receipts for the query and revokes one', async () => {
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

    await user.click(screen.getByRole('button', { name: /revoke this receipt/i }));

    await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith('tok_existing'));
    expect(await screen.findByText(/revoked/i)).toBeInTheDocument();
  });
});
