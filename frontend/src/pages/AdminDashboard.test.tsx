import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test/utils';
import AdminDashboard from './AdminDashboard';

const {
  stats, logs, evaluation, getQueriesOverTime, getTrustScoreDistribution, runEvaluation,
} = vi.hoisted(() => ({
  stats: vi.fn(),
  logs: vi.fn(),
  evaluation: vi.fn(),
  getQueriesOverTime: vi.fn(),
  getTrustScoreDistribution: vi.fn(),
  runEvaluation: vi.fn(),
}));

vi.mock('../api/client', () => ({
  adminApi: { stats, logs, evaluation, getQueriesOverTime, getTrustScoreDistribution, runEvaluation },
}));

const admin = {
  id: 'admin-1', username: 'demo_admin', email: 'admin@truthlens.dev', role: 'admin', is_active: true,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};

function renderPage() {
  return renderWithProviders(<AdminDashboard />, { authValue: { isAuthenticated: true, user: admin } });
}

// BUG-50/C8: trust is displayed 0-100 everywhere in the UI (the dashboard
// and chat-history views already did this) — the admin overview stat card
// was the one place still showing the raw 0-1 score ("0.49 Poor").
describe('AdminDashboard — Avg Trust Score (BUG-50/C8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stats.mockResolvedValue({
      total_users: 5, total_workspaces: 2, total_documents: 10, total_queries: 20, total_chunks: 100,
      avg_trust_score: 0.49, avg_rating: undefined, total_feedback: 0, query_cache_hits: 0,
    });
    logs.mockResolvedValue({ data: [], meta: { page: 1, page_size: 20, total: 0 } });
    evaluation.mockResolvedValue({ faithfulness: null, answer_relevance: null, context_precision: null, context_recall: null });
    getQueriesOverTime.mockResolvedValue([]);
    getTrustScoreDistribution.mockResolvedValue([]);
  });

  it('shows the avg trust score on a /100 scale, not the raw 0-1 value', async () => {
    renderPage();

    expect(await screen.findByText('49/100')).toBeInTheDocument();
    expect(screen.queryByText('0.49')).not.toBeInTheDocument();
  });

  it('shows N/A when there is no trust score yet', async () => {
    stats.mockResolvedValue({
      total_users: 0, total_workspaces: 0, total_documents: 0, total_queries: 0, total_chunks: 0,
      avg_trust_score: undefined, total_feedback: 0, query_cache_hits: 0,
    });
    renderPage();

    expect(await screen.findByText('N/A')).toBeInTheDocument();
  });
});
