import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/utils';
import InvestigationPage from './InvestigationPage';
import type { InvestigationResponse, InvestigationProgressResponse, InvestigationStartResponse } from '../api/types';

const { mockReview, mockExportAuditBundle } = vi.hoisted(() => ({
  mockReview: vi.fn(),
  mockExportAuditBundle: vi.fn(),
}));

vi.mock('../api/client', () => ({
  investigationApi: {
    review: mockReview,
    exportAuditBundle: mockExportAuditBundle,
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

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: async () => body,
  } as Response);
}

function renderPage(route = '/workspaces/ws-1/investigate') {
  return renderWithProviders(
    <Routes>
      <Route path="/workspaces/:id/investigate" element={<InvestigationPage />} />
      <Route path="/workspaces/:id/investigate/:caseId" element={<InvestigationPage />} />
    </Routes>,
    { route },
  );
}

beforeEach(() => {
  mockReview.mockReset();
  mockExportAuditBundle.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('InvestigationPage — background job + polling (BUG-10)', () => {
  it('starts the job (202), polls progress, and renders real markdown once done', async () => {
    const startResponse: InvestigationStartResponse = { id: 'case-1', workspace_id: 'ws-1', status: 'running' };
    const doneProgress: InvestigationProgressResponse = {
      id: 'case-1', query: caseFile.query, status: 'done', step: 'done',
      done_steps: 3, total_steps: 3, sub_questions: [], elapsed_ms: 4200, report: caseFile,
    };
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => jsonResponse(startResponse, 202))
      .mockImplementationOnce(() => jsonResponse(doneProgress));
    vi.stubGlobal('fetch', fetchMock);

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

    // POST then one GET poll — real progress, not a fake looping bar.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/workspaces/ws-1/investigate');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/investigations/case-1/progress');
  });

  it('shows the real step list and current sub-question while running, then the report once done', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const startResponse: InvestigationStartResponse = { id: 'case-1', workspace_id: 'ws-1', status: 'running' };
    const runningProgress: InvestigationProgressResponse = {
      id: 'case-1', query: 'What are the key risks?', status: 'running', step: 'investigate',
      done_steps: 1, total_steps: 4,
      sub_questions: [{ text: 'What are the risks?', status: 'running' }, { text: 'What mitigates them?', status: 'pending' }],
      elapsed_ms: 3000,
    };
    const doneProgress: InvestigationProgressResponse = {
      ...runningProgress, status: 'done', step: 'done', done_steps: 4, elapsed_ms: 6000, report: caseFile,
      sub_questions: [{ text: 'What are the risks?', status: 'done' }, { text: 'What mitigates them?', status: 'done' }],
    };
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => jsonResponse(startResponse, 202))
      .mockImplementationOnce(() => jsonResponse(runningProgress))
      .mockImplementationOnce(() => jsonResponse(doneProgress));
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup({ delay: null });
    renderPage();

    await user.type(screen.getByPlaceholderText(/ask a complex research question/i), 'What are the key risks?');
    await user.click(screen.getByRole('button', { name: /create case file/i }));

    expect(await screen.findByText('What are the risks?')).toBeInTheDocument();
    expect(screen.getByText(/3\.0s elapsed/)).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(2000);
    expect(await screen.findByText('Revenue')).toBeInTheDocument();
  });

  it('loads an existing case straight from the URL without starting a new run', async () => {
    const doneProgress: InvestigationProgressResponse = {
      id: 'case-1', query: caseFile.query, status: 'done', step: 'done',
      done_steps: 3, total_steps: 3, sub_questions: [], elapsed_ms: 4200, report: caseFile,
    };
    const fetchMock = vi.fn().mockImplementationOnce(() => jsonResponse(doneProgress));
    vi.stubGlobal('fetch', fetchMock);

    renderPage('/workspaces/ws-1/investigate/case-1');

    await screen.findByText('Revenue');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/investigations/case-1/progress');
  });

  it('shows a failure card with a retry action when the run fails', async () => {
    const startResponse: InvestigationStartResponse = { id: 'case-1', workspace_id: 'ws-1', status: 'running' };
    const failedProgress: InvestigationProgressResponse = {
      id: 'case-1', query: 'What are the key risks?', status: 'failed', step: 'failed',
      done_steps: 1, total_steps: 4, sub_questions: [], elapsed_ms: 1000, error: 'Ollama timed out', report: null,
    };
    const retryStart: InvestigationStartResponse = { id: 'case-2', workspace_id: 'ws-1', status: 'running' };
    const retryRunningProgress: InvestigationProgressResponse = {
      id: 'case-2', query: 'What are the key risks?', status: 'running', step: 'decompose',
      done_steps: 0, total_steps: 3, sub_questions: [], elapsed_ms: 0,
    };
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => jsonResponse(startResponse, 202))
      .mockImplementationOnce(() => jsonResponse(failedProgress))
      .mockImplementationOnce(() => jsonResponse(retryStart, 202))
      .mockImplementation(() => jsonResponse(retryRunningProgress));
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText(/ask a complex research question/i), 'What are the key risks?');
    await user.click(screen.getByRole('button', { name: /create case file/i }));

    await screen.findByText(/investigation failed/i);
    expect(screen.getByText('Ollama timed out')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /retry investigation/i }));
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(String(fetchMock.mock.calls[2][0])).toContain('/workspaces/ws-1/investigate');
  });
});
