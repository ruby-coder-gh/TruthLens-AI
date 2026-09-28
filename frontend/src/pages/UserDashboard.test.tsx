import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test/utils';
import UserDashboard from './UserDashboard';
import type { QuerySummary, User } from '../api/types';

const { mockListAll, mockDocsListAll } = vi.hoisted(() => ({
  mockListAll: vi.fn(),
  mockDocsListAll: vi.fn(),
}));

vi.mock('../api/client', () => ({
  queryApi: { listAll: mockListAll },
  documentApi: { listAll: mockDocsListAll },
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

const chat: QuerySummary = {
  id: 'q1',
  workspace_id: 'ws1',
  query_text: 'What was 2025 revenue?',
  trust_score: 0.47,
  is_pinned: false,
  review_status: 'reviewed',
  created_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  mockListAll.mockReset().mockResolvedValue({ data: [chat], meta: { page: 1, page_size: 5, total: 1 } });
  mockDocsListAll.mockReset().mockResolvedValue({ data: [], meta: { page: 1, page_size: 1, total: 3 } });
});

async function findAllByTextContent(text: string) {
  return screen.findAllByText((_content, element) => element?.textContent?.replace(/\s+/g, '') === text);
}

describe('UserDashboard — trust display (BUG-50 / C8)', () => {
  it('shows the average trust score and each chat\'s score on a 0-100 scale, matching the ledger', async () => {
    renderWithProviders(<UserDashboard />, { authValue: { user, isAuthenticated: true } });

    // The stat card ("Avg Trust Score") and the chat row badge both read the
    // same value here (one scored chat), so both render "47/100".
    const matches = await findAllByTextContent('47/100');
    expect(matches.length).toBe(2);
    expect(screen.queryByText('0.47')).not.toBeInTheDocument();
  });
});
