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

  it('keeps the caret inside the last paragraph, not on its own line below it (R2-20)', () => {
    const { container } = renderWithProviders(<ProseAnswer content="Writing the answer" sources={[]} streaming />);
    const paragraphs = container.querySelectorAll('.prose-answer > p');
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].querySelector('.bg-primary-soft')).toBeInTheDocument();
  });

  it('renders no caret once streaming stops', () => {
    const { container } = renderWithProviders(<ProseAnswer content="Done writing." sources={[]} />);
    expect(container.querySelector('.bg-primary-soft')).not.toBeInTheDocument();
  });

  it('keeps a citation and its trailing punctuation on the same line as the sentence (BUG-4)', () => {
    const { container } = renderWithProviders(
      <ProseAnswer content="Revenue grew [source:1]. However, costs rose too." sources={sources} workspaceId="ws-1" />,
    );
    // One flowing paragraph, not "Revenue grew" / [1] / ". However…" split
    // into separate blocks (the old per-fragment ReactMarkdown behaviour).
    const paragraphs = container.querySelectorAll('.prose-answer > p');
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]).toHaveTextContent('Revenue grew 1. However, costs rose too.');
  });

  it('keeps citations inline while streaming, before claims land (BUG-4)', () => {
    const { container } = renderWithProviders(
      <ProseAnswer content="Third quarter of 2027 [source:1]. Growth continued." sources={sources} workspaceId="ws-1" streaming />,
    );
    const paragraphs = container.querySelectorAll('.prose-answer > p');
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]).toHaveTextContent('Third quarter of 2027 1. Growth continued.');
  });

  // R3-5: the old "claims present" branch skipped ReactMarkdown entirely and
  // dumped the whole answer as plain text into one `<p>`, so a bulleted list
  // rendered as literal "- item" dashes collapsed onto a single line.
  it('keeps a markdown list as real list items once claims are present (R3-5)', () => {
    const claims: Claim[] = [
      { text: 'Aurora remains on schedule', start: 77, end: 103, verdict: 'supported', entailment: 0.9, contradiction: 0.01, source_index: 1, chunk_id: 'chunk-a', document_id: 'doc-1', document_name: 'Annual Report', page_number: 3, evidence: 'Aurora remains on schedule.' },
    ];
    const content = 'Key risks include:\n\n- Weather delays construction\n- Supply chain disruption\n\nAurora remains on schedule overall.';
    const { container } = renderWithProviders(
      <ProseAnswer content={content} sources={sources} claims={claims} workspaceId="ws-1" />,
    );

    const items = container.querySelectorAll('.prose-answer li');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Weather delays construction');
    expect(items[1]).toHaveTextContent('Supply chain disruption');
    // The bullets must be real <li>s, not dashes flattened into running text.
    expect(container.querySelector('.prose-answer')).not.toHaveTextContent('- Weather delays');
    // The verdict icon for the trailing claim still lands correctly.
    expect(screen.getByText('(verified)')).toBeInTheDocument();
  });
});
