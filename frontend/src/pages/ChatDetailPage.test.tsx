import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/utils';
import ChatDetailPage from './ChatDetailPage';
import { __resetAnswerViewForTests } from '../components/ledger/useAnswerView';
import type { QueryDetail, Claim } from '../api/types';

const { getAnywhere, exportMarkdown, feedbackSubmit } = vi.hoisted(() => ({
  getAnywhere: vi.fn(),
  exportMarkdown: vi.fn().mockResolvedValue({ blob: new Blob(['#']), filename: 'a.md' }),
  feedbackSubmit: vi.fn().mockResolvedValue({}),
}));

vi.mock('../api/client', () => ({
  queryApi: { getAnywhere, exportMarkdown, compare: vi.fn() },
  feedbackApi: { submit: feedbackSubmit },
  radarApi: { get: vi.fn().mockResolvedValue({ latest_scan: null, contradictions: [], counts: { open: 0, dismissed: 0, resolved: 0 } }) },
  receiptApi: { create: vi.fn(), listForQuery: vi.fn().mockResolvedValue([]), revoke: vi.fn() },
  // ChatDetailPage mounts <AnnotationThread>, which counts annotations on mount.
  annotationApi: { count: vi.fn().mockResolvedValue({ count: 0 }), list: vi.fn().mockResolvedValue({ items: [] }) },
}));

vi.mock('../context/SourceViewerContext', () => ({
  useSourceViewer: () => ({ open: vi.fn(), close: vi.fn(), target: null }),
}));

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  const text = overrides.text ?? 'Revenue grew 12%.';
  return {
    text,
    start: 0,
    end: text.length,
    verdict: 'supported',
    entailment: 0.88,
    contradiction: 0.01,
    source_index: null,
    chunk_id: null,
    document_id: null,
    document_name: null,
    page_number: null,
    evidence: 'Revenue increased 12% year over year.',
    ...overrides,
  };
}

function makeQuery(overrides: Partial<QueryDetail> = {}): QueryDetail {
  return {
    id: 'q-1',
    workspace_id: 'ws-1',
    query_text: 'How did revenue perform?',
    response_text: 'Revenue grew 12%. **Sales** remained flat elsewhere.',
    trust_score: 0.9,
    guardrail_passed: true,
    is_pinned: false,
    review_status: 'reviewed',
    created_at: '2026-09-01T10:00:00Z',
    ...overrides,
  };
}

function renderDetail(queryId = 'q-1') {
  return renderWithProviders(
    <Routes>
      <Route path="/chat/:queryId" element={<ChatDetailPage />} />
    </Routes>,
    { route: `/chat/${queryId}` },
  );
}

describe('ChatDetailPage', () => {
  beforeEach(() => {
    getAnywhere.mockReset();
    exportMarkdown.mockClear();
    feedbackSubmit.mockClear();
    // The Markdown export clicks a generated <a download>; jsdom can't
    // navigate and logs "Not implemented" for it.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    __resetAnswerViewForTests();
  });

  it('shows the claim-summary tally chips and a Copy/Export/feedback action bar, same as the live chat (BUG-22)', async () => {
    const user = userEvent.setup();
    getAnywhere.mockResolvedValue(
      makeQuery({
        response_text: 'Revenue grew 12%.',
        response_sources: [],
        claims: [makeClaim({ verdict: 'supported' })],
      }),
    );

    renderDetail();

    await waitFor(() => expect(screen.getByRole('button', { name: '1 verified' })).toBeInTheDocument());

    await user.click(screen.getByLabelText('Export as Markdown'));
    expect(exportMarkdown).toHaveBeenCalledWith('q-1');

    await user.click(screen.getByLabelText('Good answer'));
    expect(feedbackSubmit).toHaveBeenCalledWith('q-1', { rating: 5 });

    // BUG-31: Regenerate belongs on every complete answer here too.
    expect(screen.getByLabelText('Regenerate with fresh retrieval')).toBeInTheDocument();
  });

  it('says "Guardrail failed" instead of "Answer verified" for a stored answer whose guardrail did not pass (BUG-6)', async () => {
    getAnywhere.mockResolvedValue(makeQuery({ guardrail_passed: false, response_sources: [] }));

    renderDetail();

    await waitFor(() => expect(screen.getByText('Guardrail failed')).toBeInTheDocument());
    expect(screen.queryByText('How this answer was verified')).not.toBeInTheDocument();
  });

  it('renders the answer as prose with resolved citations, not raw [source:N] markers', async () => {
    getAnywhere.mockResolvedValue(
      makeQuery({ response_text: 'Revenue **grew** 12%. [source:1]', response_sources: [] }),
    );

    renderDetail();

    await waitFor(() => expect(screen.getByText('How did revenue perform?')).toBeInTheDocument());

    // Bold markdown rendered as an element, not literal asterisks.
    expect(screen.getByText('grew', { selector: 'strong' })).toBeInTheDocument();
    // No raw citation marker leaking through as plain text — either resolved to
    // a footnote button or (no matching source) a dimmed superscript, but never
    // the literal bracket text.
    expect(screen.queryByText(/\[source:1\]/)).not.toBeInTheDocument();
  });

  it('shows the claim ledger by default when the query carries claims', async () => {
    getAnywhere.mockResolvedValue(
      makeQuery({
        response_text: 'Revenue grew 12%.',
        response_sources: [],
        claims: [makeClaim({ verdict: 'supported' })],
      }),
    );

    renderDetail();

    await waitFor(() => expect(screen.getByText('C1')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Claim ledger' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read as prose' })).toBeInTheDocument();
  });

  it('switching to "Read as prose" renders the claim text with a verdict icon, not a ledger row', async () => {
    const user = userEvent.setup();
    getAnywhere.mockResolvedValue(
      makeQuery({
        response_text: 'Revenue grew 12%. Costs were stable.',
        response_sources: [],
        claims: [makeClaim({ text: 'Revenue grew 12%.', start: 0, end: 18, verdict: 'supported' })],
      }),
    );

    renderDetail();

    await waitFor(() => screen.getByRole('button', { name: 'Read as prose' }));
    await user.click(screen.getByRole('button', { name: 'Read as prose' }));

    expect(screen.queryByText('C1')).not.toBeInTheDocument();
    expect(screen.getByText('(verified)')).toBeInTheDocument();
  });

  it('renders no ledger/prose toggle when the query has no claims', async () => {
    getAnywhere.mockResolvedValue(makeQuery({ response_sources: [] }));

    renderDetail();

    await waitFor(() => expect(screen.getByText('How did revenue perform?')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Claim ledger' })).not.toBeInTheDocument();
  });

  it('shows an abstention card instead of the ledger when the query abstained', async () => {
    getAnywhere.mockResolvedValue(
      makeQuery({ response_text: "I don't have enough evidence to answer that.", edge_case: 'insufficient_evidence', response_sources: [] }),
    );

    renderDetail();

    await waitFor(() => expect(screen.getByText(/enough evidence/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Claim ledger' })).not.toBeInTheDocument();
  });
});
