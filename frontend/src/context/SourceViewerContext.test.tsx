import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/utils';
import { SourceViewerProvider, useSourceViewer } from './SourceViewerContext';
import { documentApi } from '../api/client';
import type { ChunkLocation } from '../api/types';

vi.mock('../api/client', () => ({
  documentApi: {
    locate: vi.fn(),
    fileUrl: vi.fn((workspaceId: string, documentId: string) => `/api/workspaces/${workspaceId}/documents/${documentId}/file`),
  },
}));

// pdf.js itself is never exercised — only the drawer's wiring to it — so a
// minimal fake page/document stands in. `getViewport` ignores scale so the
// overlay-box assertions don't depend on the drawer's internal zoom default.
vi.mock('pdfjs-dist', () => {
  const mockPage = {
    getViewport: () => ({
      width: 300,
      height: 400,
      convertToViewportPoint: (x: number, y: number) => [x, 400 - y],
    }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
  };
  const mockDoc = { getPage: vi.fn().mockResolvedValue(mockPage) };
  return {
    getDocument: vi.fn(() => ({ promise: Promise.resolve(mockDoc) })),
    GlobalWorkerOptions: {},
  };
});
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'mock-worker-url' }));

const mockLocate = vi.mocked(documentApi.locate);

function textLocation(overrides: Partial<ChunkLocation> = {}): ChunkLocation {
  return {
    mode: 'text',
    page_number: null,
    page_count: null,
    page_width: null,
    page_height: null,
    rects: [],
    content: 'MATCHED PASSAGE',
    context_before: null,
    context_after: null,
    ...overrides,
  };
}

function TestConsumer() {
  const { open } = useSourceViewer();
  return (
    <button
      onClick={() =>
        open({ workspaceId: 'ws-1', documentId: 'doc-1', chunkId: 'chunk-1', documentName: 'Doc One', pageNumber: 2 })
      }
    >
      Open Source
    </button>
  );
}

function renderHarness() {
  return renderWithProviders(
    <SourceViewerProvider>
      <TestConsumer />
    </SourceViewerProvider>,
  );
}

describe('SourceViewerProvider + SourceViewerDrawer', () => {
  beforeEach(() => {
    mockLocate.mockReset();
  });

  it('opens the drawer on open() and closes via the close button', async () => {
    const user = userEvent.setup();
    mockLocate.mockResolvedValue(textLocation());

    renderHarness();
    await user.click(screen.getByRole('button', { name: 'Open Source' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(await screen.findByText('MATCHED PASSAGE')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close source viewer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes on Escape and returns focus to the opener', async () => {
    const user = userEvent.setup();
    mockLocate.mockResolvedValue(textLocation());

    renderHarness();
    const opener = screen.getByRole('button', { name: 'Open Source' });
    await user.click(opener);
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('renders the matched passage as a highlighted <mark> with its surrounding context in text mode', async () => {
    const user = userEvent.setup();
    mockLocate.mockResolvedValue(
      textLocation({ content: 'the matched sentence', context_before: 'lead in.', context_after: 'trail out.' }),
    );

    renderHarness();
    await user.click(screen.getByRole('button', { name: 'Open Source' }));

    const mark = await screen.findByText('the matched sentence');
    expect(mark.tagName).toBe('MARK');
    expect(screen.getByText(/lead in\./)).toBeInTheDocument();
    expect(screen.getByText(/trail out\./)).toBeInTheDocument();
  });

  it('renders PDF-mode overlay highlight boxes scaled to the viewport', async () => {
    const user = userEvent.setup();
    mockLocate.mockResolvedValue({
      mode: 'pdf',
      page_number: 2,
      page_count: 5,
      page_width: 300,
      page_height: 400,
      rects: [[10, 20, 30, 40]],
      content: 'matched text',
      context_before: null,
      context_after: null,
    });

    renderHarness();
    await user.click(screen.getByRole('button', { name: 'Open Source' }));

    const boxes = await screen.findAllByTestId('source-highlight');
    expect(boxes).toHaveLength(1);
    // BUG-2: the backend rect [10, 20, 30, 40] is page space (top-left
    // origin, y down) with page_height 400 — near the *top* of the page.
    // rectToViewportBox flips it into PDF user space first (y' = 400 - y),
    // so this mock viewport's own bottom-left -> top-left flip
    // (convertToViewportPoint: (x, y) => [x, 400 - y]) lands it back near the
    // top of the CSS box (top: 20px), not mirrored to the bottom.
    expect(boxes[0]).toHaveStyle({ left: '10px', top: '20px', width: '20px', height: '20px' });

    expect(await screen.findByText('Page 2 / 5')).toBeInTheDocument();
  });

  it('falls back to text mode when the passage cannot be located', async () => {
    const user = userEvent.setup();
    mockLocate.mockRejectedValue(new Error('Document not found'));

    renderHarness();
    await user.click(screen.getByRole('button', { name: 'Open Source' }));

    expect(await screen.findByText('Document not found')).toBeInTheDocument();
  });
});
