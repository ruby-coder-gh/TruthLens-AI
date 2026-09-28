import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/utils';
import ChatDetailPage from './ChatDetailPage';
import type { QueryDetail, Claim } from '../api/types';

const { getAnywhere } = vi.hoisted(() => ({ getAnywhere: vi.fn() }));

vi.mock('../api/client', () => ({
  queryApi: { getAnywhere },
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
  });

  it('renders the answer as markdown with resolved citations, not raw [source:N] markers', async () => {
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

  it('shows the Truth Lens summary chip and toggle when the query carries claims', async () => {
    getAnywhere.mockResolvedValue(
      makeQuery({
        response_text: 'Revenue grew 12%.',
        response_sources: [],
        claims: [makeClaim({ verdict: 'supported' })],
      }),
    );

    renderDetail();

    await waitFor(() => expect(screen.getByText('1 claim · 1 verified')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /truth lens/i })).toBeInTheDocument();
  });

  it('toggling the lens renders a verdict-styled span for the claim', async () => {
    const user = userEvent.setup();
    getAnywhere.mockResolvedValue(
      makeQuery({
        response_text: 'Revenue grew 12%. Costs were stable.',
        response_sources: [],
        claims: [makeClaim({ text: 'Revenue grew 12%.', verdict: 'supported' })],
      }),
    );

    renderDetail();

    await waitFor(() => screen.getByRole('button', { name: /truth lens/i }));
    await user.click(screen.getByRole('button', { name: /truth lens/i }));

    const span = screen.getByRole('button', { name: /supported claim/i });
    expect(span).toHaveTextContent('Revenue grew 12%.');
  });

  it('renders nothing Truth-Lens-related when the query has no claims', async () => {
    getAnywhere.mockResolvedValue(makeQuery({ response_sources: [] }));

    renderDetail();

    await waitFor(() => expect(screen.getByText('How did revenue perform?')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /truth lens/i })).not.toBeInTheDocument();
  });
});
