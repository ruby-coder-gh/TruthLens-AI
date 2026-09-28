import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { ProseAnswer } from './ProseAnswer';
import type { Claim, Source } from '../../api/types';

const mockOpen = vi.fn();
vi.mock('../../context/SourceViewerContext', () => ({
  useSourceViewer: () => ({ open: mockOpen, close: vi.fn(), target: null }),
}));

const sources: Source[] = [
  { chunk_id: 'chunk-a', document_id: 'doc-1', document_name: 'Annual Report', excerpt: '', relevance_score: 0.9, page_number: 3 },
];

describe('ProseAnswer', () => {
  it('renders a plain markdown answer with no claims', () => {
    renderWithProviders(<ProseAnswer content="Revenue grew **fast**." sources={[]} />);
    expect(screen.getByText('fast', { exact: false })).toBeInTheDocument();
  });

  it('turns a [source:N] marker into a clickable citation chip', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProseAnswer content="Revenue was €412M [source:1]." sources={sources} workspaceId="ws-1" />);
    await user.click(screen.getByRole('button', { name: /open source 1/i }));
    expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws-1', chunkId: 'chunk-a' }));
  });

  it('appends a small verdict icon after each claim once claims are present', () => {
    const claims: Claim[] = [
      { text: 'Revenue was strong', start: 0, end: 19, verdict: 'supported', entailment: 0.9, contradiction: 0.01, source_index: 1, chunk_id: 'chunk-a', document_id: 'doc-1', document_name: 'Annual Report', page_number: 3, evidence: 'Revenue was strong.' },
    ];
    const content = 'Revenue was strong this year.';
    renderWithProviders(<ProseAnswer content={content} sources={sources} claims={claims} workspaceId="ws-1" />);
    // VERDICT_META['supported'].label is "Verified", not the raw verdict key.
    expect(screen.getByText('(verified)')).toBeInTheDocument();
  });

  it('shows a blinking caret while streaming with no claims yet', () => {
    const { container } = renderWithProviders(<ProseAnswer content="Writing" sources={[]} streaming />);
    expect(container.querySelector('.bg-primary-soft')).toBeInTheDocument();
  });
});
