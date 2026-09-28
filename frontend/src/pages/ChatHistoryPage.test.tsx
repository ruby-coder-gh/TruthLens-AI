import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createTestQueryClient, renderWithProviders } from '../test/utils';
import ChatHistoryPage from './ChatHistoryPage';
import type { QuerySummary } from '../api/types';

const { mockListAll, mockDelete } = vi.hoisted(() => ({
  mockListAll: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock('../api/client', () => ({
  queryApi: { listAll: mockListAll, delete: mockDelete, pin: vi.fn(), unpin: vi.fn() },
}));

const normalChat: QuerySummary = {
  id: 'q1',
  workspace_id: 'ws1',
  query_text: 'What was 2025 revenue?',
  model_used: 'gpt-4o-mini',
  trust_score: 0.86,
  is_pinned: false,
  review_status: 'reviewed',
  created_at: '2026-01-01T00:00:00Z',
};

const abstainedChat: QuerySummary = {
  id: 'q2',
  workspace_id: 'ws1',
  query_text: 'Which projects are under construction?',
  model_used: 'abstain',
  edge_case: 'insufficient_evidence',
  is_pinned: false,
  review_status: 'reviewed',
  created_at: '2026-01-02T00:00:00Z',
};

beforeEach(() => {
  mockListAll.mockReset().mockResolvedValue({ data: [normalChat, abstainedChat], meta: { page: 1, page_size: 50, total: 2 } });
  mockDelete.mockReset().mockResolvedValue(undefined);
});

describe('ChatHistoryPage', () => {
  it('lists only the caller\'s own chats (K6/R2-1)', async () => {
    renderWithProviders(<ChatHistoryPage />);

    await screen.findByText(normalChat.query_text);
    expect(mockListAll).toHaveBeenCalledWith(expect.objectContaining({ mine: true }));
  });

  it('shows an "Abstained" badge instead of the raw "abstain" model name (BUG-41)', async () => {
    renderWithProviders(<ChatHistoryPage />);

    await screen.findByText(normalChat.query_text);
    expect(screen.getByText('gpt-4o-mini')).toBeInTheDocument();
    expect(screen.getByText('Abstained')).toBeInTheDocument();
    expect(screen.queryByText('abstain')).not.toBeInTheDocument();
  });

  it('shows the trust score on a 0-100 scale, matching the ledger (BUG-50 / C8)', async () => {
    renderWithProviders(<ChatHistoryPage />);

    expect(
      await screen.findByText((_content, el) => el?.textContent?.replace(/\s+/g, '') === 'Score:86/100'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/0\.86/)).not.toBeInTheDocument();
  });

  it('requires confirmation before deleting a chat, then invalidates the sidebar Recent cache (BUG-12)', async () => {
    const user = userEvent.setup();
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderWithProviders(<ChatHistoryPage />, { queryClient });

    await screen.findByText(normalChat.query_text);
    const [deleteButton] = screen.getAllByRole('button', { name: 'Delete chat' });
    await user.click(deleteButton);

    // Deleting must not have fired yet — a confirm dialog is required first.
    expect(mockDelete).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'Delete chat' });
    expect(dialog).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('ws1', 'q1'));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['queries', 'recent'] }),
      ),
    );
    expect(screen.queryByText(normalChat.query_text)).not.toBeInTheDocument();
  });

  it('cancels without deleting', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChatHistoryPage />);

    await screen.findByText(normalChat.query_text);
    const [deleteButton] = screen.getAllByRole('button', { name: 'Delete chat' });
    await user.click(deleteButton);
    await screen.findByRole('dialog', { name: 'Delete chat' });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mockDelete).not.toHaveBeenCalled();
    expect(screen.getByText(normalChat.query_text)).toBeInTheDocument();
  });
});
