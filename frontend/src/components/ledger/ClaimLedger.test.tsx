import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/utils';
import { ClaimLedger } from './ClaimLedger';
import type { Claim, Contradiction, Source } from '../../api/types';

const mockOpen = vi.fn();
vi.mock('../../context/SourceViewerContext', () => ({
  useSourceViewer: () => ({ open: mockOpen, close: vi.fn(), target: null }),
}));

// Both share the "Northwind Renewables — " prefix, so shortDocTitle has
// something to strip (mirrors the demo corpus's real Annual/Sustainability pair).
const sources: Source[] = [
  { chunk_id: 'chunk-a', document_id: 'doc-1', document_name: 'Northwind Renewables — Annual Report 2025', excerpt: '', relevance_score: 0.94, page_number: 3 },
  { chunk_id: 'chunk-b', document_id: 'doc-2', document_name: 'Northwind Renewables — Q4 & FY2025 Results', excerpt: '', relevance_score: 0.91, page_number: 1 },
];

const allDocNames = sources.map((s) => s.document_name!);

function claim(overrides: Partial<Claim>): Claim {
  return {
    text: 'Revenue was €412 million for 2025.',
    start: 0,
    end: 10,
    verdict: 'supported',
    entailment: 0.97,
    contradiction: 0.01,
    source_index: 1,
    chunk_id: 'chunk-a',
    document_id: 'doc-1',
    document_name: sources[0].document_name!,
    page_number: 3,
    evidence: 'Revenue in 2025 was €412 million.',
    ...overrides,
  };
}

const contradiction: Contradiction = {
  id: 'contra-1',
  score: 0.9,
  similarity: 0.8,
  status: 'open',
  created_at: '2026-01-01T00:00:00Z',
  a: { document_id: 'doc-1', document_name: sources[0].document_name!, chunk_id: 'chunk-a', page_number: 3, sentence: 'Revenue in 2025 was €412 million.' },
  b: { document_id: 'doc-2', document_name: sources[1].document_name!, chunk_id: 'chunk-b', page_number: 1, sentence: 'Revenue in 2025 was €398 million.' },
};

describe('ClaimLedger', () => {
  it('renders one row per claim with its verdict stamp and short doc title', () => {
    const claims = [claim({}), claim({ text: 'up from €356 million in 2024.', verdict: 'partial', entailment: 0.62 })];
    renderWithProviders(<ClaimLedger claims={claims} sources={sources} allDocNames={allDocNames} />);
    expect(screen.getByText('C1')).toBeInTheDocument();
    expect(screen.getByText('C2')).toBeInTheDocument();
    expect(screen.getAllByText('Verified')).toHaveLength(1);
    expect(screen.getByText('Partial')).toBeInTheDocument();
    // Short title, not the raw "Northwind Renewab…" truncation. Both claims
    // in this fixture cite the same source, so two rows carry the text.
    expect(screen.getAllByText(/\[1\] Annual Report 2025, page 3/)).toHaveLength(2);
  });

  it('expands a row to show the why-explanation on toggle click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ClaimLedger claims={[claim({})]} sources={sources} allDocNames={allDocNames} />);
    expect(screen.queryByText(/Why verified/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /why c1 is verified/i }));
    expect(screen.getByText(/Why verified/)).toBeInTheDocument();
  });

  it('opens the source viewer with the claim chunk when "View in document" is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ClaimLedger claims={[claim({})]} sources={sources} allDocNames={allDocNames} workspaceId="ws-1" />);
    await user.click(screen.getByRole('button', { name: /why c1 is verified/i }));
    await user.click(screen.getByRole('button', { name: /view in document/i }));
    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', documentId: 'doc-1', chunkId: 'chunk-a', pageNumber: 3 }),
    );
  });

  it('adds a discrepancy row and a cross-reference when two claims form an open contradiction', () => {
    const claims = [
      claim({ text: 'Revenue was €412 million.', chunk_id: 'chunk-a' }),
      claim({ text: 'the press release gives €398 million.', chunk_id: 'chunk-b', document_id: 'doc-2', document_name: sources[1].document_name!, source_index: 2, page_number: 1, evidence: 'Revenue in 2025 was €398 million.' }),
    ];
    renderWithProviders(<ClaimLedger claims={claims} sources={sources} allDocNames={allDocNames} contradictions={[contradiction]} />);
    expect(screen.getByText('Sources disagree')).toBeInTheDocument();
    expect(screen.getByText('Conflict')).toBeInTheDocument();
    const c1Row = screen.getByText('C1').closest('li')!;
    expect(within(c1Row).getByRole('button', { name: /differs from c2/i })).toBeInTheDocument();
    // The figure diff table computed from the two claims' numbers, labelled
    // with its currency + scale unit, not a bare "14" (BUG-29).
    expect(screen.getByText('€14M')).toBeInTheDocument();
  });

  it('still shows the discrepancy row when the answer only cites one side of a contradiction (BUG-5)', () => {
    renderWithProviders(<ClaimLedger claims={[claim({})]} sources={sources} allDocNames={allDocNames} contradictions={[contradiction]} />);
    expect(screen.getByText(/Sources disagree/)).toBeInTheDocument();
    // The radar's own doc name for the uncited side, read off `contradiction.b`.
    expect(screen.getAllByText(/Q4 & FY2025 Results/).length).toBeGreaterThan(0);
    // The lone cited claim's row gets a xref chip too, pointing at the
    // discrepancy row (there's no sibling claim row to jump to instead).
    const c1Row = screen.getByText('C1').closest('li')!;
    expect(within(c1Row).getByRole('button', { name: /differs from .*fy2025 results/i })).toBeInTheDocument();
  });

  it('numbers multiple discrepancy rows D1, D2, … instead of a bare "D" (BUG-27)', () => {
    const contradiction2: Contradiction = {
      ...contradiction,
      id: 'contra-2',
      a: { ...contradiction.a, sentence: 'Emissions fell 34% versus 2020.' },
      b: { ...contradiction.b, chunk_id: 'chunk-c', document_id: 'doc-3', document_name: 'Sustainability Report', sentence: 'Emissions fell 41% versus 2020.' },
    };
    renderWithProviders(
      <ClaimLedger claims={[claim({})]} sources={sources} allDocNames={allDocNames} contradictions={[contradiction, contradiction2]} />,
    );
    expect(screen.getByText('D1')).toBeInTheDocument();
    expect(screen.getByText('D2')).toBeInTheDocument();
  });

  it('does not show a numeric entailment score on a Partial row (BUG-26)', () => {
    renderWithProviders(<ClaimLedger claims={[claim({ verdict: 'partial', entailment: 0.02 })]} sources={sources} allDocNames={allDocNames} />);
    expect(screen.getByText('Partial')).toBeInTheDocument();
    expect(screen.queryByText('0.02')).not.toBeInTheDocument();
  });

  it('fills the score bar with the verdict colour via bg-current, not a runtime-built class (BUG-28)', () => {
    const { container } = renderWithProviders(<ClaimLedger claims={[claim({})]} sources={sources} allDocNames={allDocNames} />);
    const fill = container.querySelector('.bg-current');
    expect(fill).toBeInTheDocument();
    expect(fill).toHaveClass('text-v-supported');
  });
});
