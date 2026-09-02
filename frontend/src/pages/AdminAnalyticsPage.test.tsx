import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/utils';
import AdminAnalyticsPage from './AdminAnalyticsPage';
import { adminApi } from '../api/client';
import { downloadBlob } from '../utils/download';
import type { UsageReportResponse, PricingResponse } from '../api/types';

vi.mock('../api/client', () => ({
  adminApi: {
    getFlaggedAnswers: vi.fn(),
    getQueriesOverTime: vi.fn(),
    getTrustScoreDistribution: vi.fn(),
    getEvalHistory: vi.fn(),
    runEvaluation: vi.fn(),
    getUsage: vi.fn(),
    getUsagePricing: vi.fn(),
    exportUsage: vi.fn(),
  },
}));

vi.mock('../utils/download', () => ({
  downloadBlob: vi.fn(),
}));

const mockedAdminApi = vi.mocked(adminApi, true);
const mockedDownloadBlob = vi.mocked(downloadBlob);

const USAGE_BY_MODEL: UsageReportResponse = {
  rows: [
    {
      key: 'gpt-4o-mini',
      label: 'gpt-4o-mini',
      queries: 3,
      output_tokens: 600,
      prompt_tokens: 300,
      avg_latency_ms: 300,
      cache_hits: 1,
      est_cost_usd: 0.000405,
    },
    {
      key: 'llama3',
      label: 'llama3',
      queries: 2,
      output_tokens: 200,
      prompt_tokens: 100,
      avg_latency_ms: 120,
      cache_hits: 2,
      est_cost_usd: 0,
    },
  ],
  totals: {
    queries: 5,
    output_tokens: 800,
    prompt_tokens: 400,
    avg_latency_ms: 210,
    cache_hits: 3,
    est_cost_usd: 0.000405,
  },
  pricing_source: 'config',
  period: { from: '2026-08-02T00:00:00+00:00', to: null },
};

const USAGE_BY_USER: UsageReportResponse = {
  rows: [
    {
      key: 'user-1',
      label: 'user-1',
      queries: 4,
      output_tokens: 500,
      prompt_tokens: 250,
      avg_latency_ms: 200,
      cache_hits: 2,
      est_cost_usd: 0.0002,
    },
    {
      key: 'unattributed',
      label: 'Unattributed',
      queries: 1,
      output_tokens: 300,
      prompt_tokens: 150,
      avg_latency_ms: 250,
      cache_hits: 1,
      est_cost_usd: 0.0002,
    },
  ],
  totals: {
    queries: 5,
    output_tokens: 800,
    prompt_tokens: 400,
    avg_latency_ms: 210,
    cache_hits: 3,
    est_cost_usd: 0.0004,
  },
  pricing_source: 'config',
  period: { from: null, to: null },
};

const PRICING: PricingResponse = {
  pricing: { 'gpt-4o-mini': { input_per_1k: 0.00015, output_per_1k: 0.0006 } },
};

function totalsRow(): HTMLElement {
  const totalCell = screen.getByText('Total');
  const row = totalCell.closest('tr');
  if (!row) throw new Error('Total row not found');
  return row;
}

async function openUsageTab() {
  const tab = await screen.findByRole('tab', { name: /usage/i });
  await userEvent.click(tab);
}

describe('AdminAnalyticsPage — Usage tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAdminApi.getFlaggedAnswers.mockResolvedValue({ data: [] } as never);
    mockedAdminApi.getQueriesOverTime.mockResolvedValue({ data: [] } as never);
    mockedAdminApi.getTrustScoreDistribution.mockResolvedValue({ data: [] } as never);
    mockedAdminApi.getEvalHistory.mockResolvedValue({ data: [] } as never);
    mockedAdminApi.getUsage.mockResolvedValue(USAGE_BY_MODEL);
    mockedAdminApi.getUsagePricing.mockResolvedValue(PRICING);
  });

  it('renders usage rows and a totals row for the default group_by=model', async () => {
    renderWithProviders(<AdminAnalyticsPage />);

    await openUsageTab();

    await waitFor(() => {
      expect(mockedAdminApi.getUsage).toHaveBeenCalledWith(
        expect.objectContaining({ group_by: 'model' }),
      );
    });

    expect(await screen.findByText('gpt-4o-mini')).toBeInTheDocument();
    expect(screen.getByText('llama3')).toBeInTheDocument();

    const totals = within(totalsRow());
    expect(totals.getByText('5')).toBeInTheDocument();
  });

  it('refetches with the new group_by when the segmented control changes', async () => {
    mockedAdminApi.getUsage.mockImplementation((params) => {
      if (params?.group_by === 'user') return Promise.resolve(USAGE_BY_USER);
      return Promise.resolve(USAGE_BY_MODEL);
    });

    renderWithProviders(<AdminAnalyticsPage />);
    await openUsageTab();

    await waitFor(() => {
      expect(mockedAdminApi.getUsage).toHaveBeenCalledWith(
        expect.objectContaining({ group_by: 'model' }),
      );
    });

    await userEvent.click(screen.getByRole('button', { name: 'User' }));

    await waitFor(() => {
      expect(mockedAdminApi.getUsage).toHaveBeenCalledWith(
        expect.objectContaining({ group_by: 'user' }),
      );
    });

    expect(await screen.findByText('Unattributed')).toBeInTheDocument();
  });

  it('exports the usage report as CSV via downloadBlob', async () => {
    mockedAdminApi.exportUsage.mockResolvedValue({
      blob: new Blob(['csv']),
      filename: 'usage-model-20260101T000000Z.csv',
    });

    renderWithProviders(<AdminAnalyticsPage />);
    await openUsageTab();

    await waitFor(() => expect(mockedAdminApi.getUsage).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: /export csv/i }));

    await waitFor(() => {
      expect(mockedAdminApi.exportUsage).toHaveBeenCalledWith(
        expect.objectContaining({ group_by: 'model' }),
      );
    });
    expect(mockedDownloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      'usage-model-20260101T000000Z.csv',
    );
  });
});
