import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/utils';
import InvestigationPage from './InvestigationPage';
import type { InvestigationResponse } from '../api/types';

const { mockRun } = vi.hoisted(() => ({ mockRun: vi.fn() }));

vi.mock('../api/client', () => ({
  investigationApi: {
    run: mockRun,
    exportAuditBundle: vi.fn(),
    review: vi.fn(),
  },
}));

vi.mock('../context/SourceViewerContext', () => ({
  useSourceViewer: () => ({ open: vi.fn(), close: vi.fn(), target: null }),
}));

const caseFile: InvestigationResponse = {
  id: 'case-1',
  workspace_id: 'ws-1',
  query: 'What are the key risks?',
  final_report: '# Findings\n\n**Revenue** grew [source:2].\n\n---\n\nSee below.',
  trust_score: 0.8,
  latency_ms: 4200,
  review_status: 'draft',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/workspaces/:id/investigate" element={<InvestigationPage />} />
    </Routes>,
    { route: '/workspaces/ws-1/investigate' },
  );
}

beforeEach(() => {
  mockRun.mockReset();
});

describe('InvestigationPage — report rendering (BUG-10)', () => {
  it('renders real markdown (bold, rules) instead of literal characters, with markers stripped', async () => {
    mockRun.mockResolvedValue(caseFile);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText(/ask a complex research question/i), 'What are the key risks?');
    await user.click(screen.getByRole('button', { name: /create case file/i }));

    const bold = await screen.findByText('Revenue');
    expect(bold.tagName).toBe('STRONG');
    expect(screen.getByText(/grew \[2\]/)).toBeInTheDocument();
    expect(screen.queryByText(/\*\*Revenue\*\*/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\[source:2\]/)).not.toBeInTheDocument();
    expect(document.querySelector('hr')).toBeInTheDocument();
  });

  it('shows elapsed time instead of a silent endless bar while a run is in flight', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let resolveRun: (() => void) | undefined;
    mockRun.mockReturnValue(new Promise<InvestigationResponse>((resolve) => {
      resolveRun = () => resolve(caseFile);
    }));
    const user = userEvent.setup({ delay: null });
    renderPage();

    await user.type(screen.getByPlaceholderText(/ask a complex research question/i), 'What are the key risks?');
    await user.click(screen.getByRole('button', { name: /create case file/i }));

    await screen.findByText('Building your case file');

    await vi.advanceTimersByTimeAsync(3000);
    expect(await screen.findByText(/Building your case file — 3(\.0)?s elapsed/)).toBeInTheDocument();

    resolveRun?.();
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
  });
});
