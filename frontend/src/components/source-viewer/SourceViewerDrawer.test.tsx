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
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockLocate.mockReset();
    mockFileUrl.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // BUG-17 / C1 regression: when a target carries `highlightText` (the
  // claim's cited sentence), the drawer must ask the locate endpoint for
  // rects on just that text — not fall back to `documentApi.locate`, which
  // has no way to pass it and would highlight the whole chunk instead.
  it('requests the locate endpoint with ?text= when the target has highlightText', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(textLocation('Aurora is now expected to commission in the first quarter of 2028.')),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const target: SourceTarget = {
      ...baseTarget,
      highlightText: 'Aurora is now expected to commission in the first quarter of 2028.',
    };

    render(<SourceViewerDrawer target={target} onClose={vi.fn()} />);

    expect(await screen.findByText(/aurora is now expected to commission/i)).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/workspaces/ws-1/documents/doc-1/chunks/chunk-1/locate?text=');
    expect(url).toContain(encodeURIComponent('Aurora is now expected to commission in the first quarter of 2028.'));
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include' });

    // The generic client method — which cannot carry `text` — must not be used.
    expect(mockLocate).not.toHaveBeenCalled();
  });

  it('falls back to documentApi.locate (whole chunk) when there is no highlightText', async () => {
    mockLocate.mockResolvedValue(textLocation('The full chunk text, from the top.'));

    render(<SourceViewerDrawer target={baseTarget} onClose={vi.fn()} />);

    expect(await screen.findByText(/the full chunk text, from the top\./i)).toBeInTheDocument();
    expect(mockLocate).toHaveBeenCalledWith('ws-1', 'doc-1', 'chunk-1');
  });

  // BUG-17: text-mode used to <mark> the entire chunk regardless of what was
  // asked for. K2's `highlight` span means only the cited sentence is marked.
  it('marks only the K2 highlight span in text mode, not the whole chunk', async () => {
    const content = 'Intro sentence. Aurora is now expected to commission in the first quarter of 2028. Trailing sentence.';
    const start = content.indexOf('Aurora');
    const end = start + 'Aurora is now expected to commission in the first quarter of 2028.'.length;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ...textLocation(content), highlight: { start, end } }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

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
