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

// BUG-36: the `/admin` dashboard's own Audit Logs tab (distinct from the
// dedicated `/admin/audit-log` page, which already did this) still showed
// the raw, truncated `user_id` instead of the resolved `user_name`.
describe('AdminDashboard — Audit tab shows user_name (BUG-36)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stats.mockResolvedValue({
      total_users: 5, total_workspaces: 2, total_documents: 10, total_queries: 20, total_chunks: 100,
      avg_trust_score: 0.49, total_feedback: 0, query_cache_hits: 0,
    });
    evaluation.mockResolvedValue({ faithfulness: null, answer_relevance: null, context_precision: null, context_recall: null });
    getQueriesOverTime.mockResolvedValue([]);
    getTrustScoreDistribution.mockResolvedValue([]);
  });

  it('shows the resolved username instead of the raw user id', async () => {
    logs.mockResolvedValue({
      data: [
        { id: 'log-1', user_id: 'a1b2c3d4e5f67890aaaabbbbccccdddd', user_name: 'demo_analyst', action: 'query.create', resource_type: 'query', resource_id: null, details: null, created_at: '2026-09-01T00:00:00Z' },
      ],
      meta: { page: 1, page_size: 20, total: 1 },
    });
    renderPage();

    expect(await screen.findByText('demo_analyst')).toBeInTheDocument();
    expect(screen.queryByText(/a1b2c3d4/)).not.toBeInTheDocument();
  });

  it('falls back to the truncated user id when user_name is absent (deleted user / older backend)', async () => {
    logs.mockResolvedValue({
      data: [
        { id: 'log-2', user_id: 'a1b2c3d4e5f67890aaaabbbbccccdddd', action: 'query.create', resource_type: 'query', resource_id: null, details: null, created_at: '2026-09-01T00:00:00Z' },
      ],
      meta: { page: 1, page_size: 20, total: 1 },
    });
    renderPage();

    expect(await screen.findByText('a1b2c3d4e5f6…')).toBeInTheDocument();
  });
});
