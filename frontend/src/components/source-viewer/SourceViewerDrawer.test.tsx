import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SourceViewerDrawer } from './SourceViewerDrawer';
import type { SourceTarget } from '../../context/SourceViewerContext';
import type { ChunkLocation } from '../../api/types';

const { mockLocate, mockFileUrl } = vi.hoisted(() => ({
  mockLocate: vi.fn(),
  mockFileUrl: vi.fn(() => 'http://localhost/api/workspaces/ws-1/documents/doc-1/file'),
}));

vi.mock('../../api/client', () => ({
  documentApi: { locate: mockLocate, fileUrl: mockFileUrl },
}));

function textLocation(content: string): ChunkLocation {
  return {
    mode: 'text',
    page_number: null,
    page_count: null,
    page_width: null,
    page_height: null,
    rects: [],
    content,
    context_before: null,
    context_after: null,
  };
}

const baseTarget: SourceTarget = {
  workspaceId: 'ws-1',
  documentId: 'doc-1',
  chunkId: 'chunk-1',
  documentName: 'Board Memo.docx',
};

describe('SourceViewerDrawer', () => {
  beforeEach(() => {
    mockLocate.mockReset();
    mockFileUrl.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // BUG-17 / C1 regression: when a target carries `highlightText` (the
  // claim's cited sentence), the drawer must pass it to the locate call so
  // the backend returns rects for just that sentence, not the whole chunk.
  it('passes highlightText to documentApi.locate when the target has one', async () => {
    const sentence = 'Aurora is now expected to commission in the first quarter of 2028.';
    mockLocate.mockResolvedValue(textLocation(sentence));

    render(<SourceViewerDrawer target={{ ...baseTarget, highlightText: sentence }} onClose={vi.fn()} />);

    expect(await screen.findByText(/aurora is now expected to commission/i)).toBeInTheDocument();
    expect(mockLocate).toHaveBeenCalledWith('ws-1', 'doc-1', 'chunk-1', sentence);
  });

  it('asks for the whole chunk when there is no highlightText', async () => {
    mockLocate.mockResolvedValue(textLocation('The full chunk text, from the top.'));

    render(<SourceViewerDrawer target={baseTarget} onClose={vi.fn()} />);

    expect(await screen.findByText(/the full chunk text, from the top\./i)).toBeInTheDocument();
    expect(mockLocate).toHaveBeenCalledWith('ws-1', 'doc-1', 'chunk-1', undefined);
  });

  // BUG-17: text-mode used to <mark> the entire chunk regardless of what was
  // asked for. K2's `highlight` span means only the cited sentence is marked.
  it('marks only the K2 highlight span in text mode, not the whole chunk', async () => {
    const content = 'Intro sentence. Aurora is now expected to commission in the first quarter of 2028. Trailing sentence.';
    const start = content.indexOf('Aurora');
    const end = start + 'Aurora is now expected to commission in the first quarter of 2028.'.length;
    mockLocate.mockResolvedValue({ ...textLocation(content), highlight: { start, end } });

    const target: SourceTarget = { ...baseTarget, highlightText: 'Aurora is now expected to commission in the first quarter of 2028.' };
    const { container } = render(<SourceViewerDrawer target={target} onClose={vi.fn()} />);

    const mark = await screen.findByText(/aurora is now expected to commission/i);
    expect(mark.tagName).toBe('MARK');
    expect(mark.textContent).toBe('Aurora is now expected to commission in the first quarter of 2028.');
    // The rest of the chunk is present but plain (not inside the <mark>).
    expect(container.textContent).toContain('Intro sentence.');
    expect(container.textContent).toContain('Trailing sentence.');
    expect(container.querySelectorAll('mark')).toHaveLength(1);
  });
});
