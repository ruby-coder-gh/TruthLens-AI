import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/utils';
import WorkspaceDocumentDetailPage from './WorkspaceDocumentDetailPage';
import { documentApi } from '../api/client';
import { useSourceViewer } from '../context/SourceViewerContext';
import type { DocumentDetail } from '../api/types';

vi.mock('../api/client', () => ({
  documentApi: {
    getDetail: vi.fn(),
  },
}));

// The drawer itself (locate fetch, pdf.js) is covered by
// SourceViewerContext.test.tsx — here we only assert this page calls
// `open()` with the right target (including the `?chunk=` auto-open).
vi.mock('../context/SourceViewerContext', () => ({
  useSourceViewer: vi.fn(),
}));

const mockGetDetail = vi.mocked(documentApi.getDetail);
const mockUseSourceViewer = vi.mocked(useSourceViewer);
const mockOpen = vi.fn();

const baseDoc: DocumentDetail = {
  id: 'doc-1',
  workspace_id: 'ws-1',
  original_filename: 'Handbook.pdf',
  mime_type: 'application/pdf',
  file_size: 4096,
  page_count: 12,
  chunk_count: 2,
  status: 'ready',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  chunks: [
    { id: 'chunk-1', index: 0, content: 'First passage content.', token_count: 20, created_at: '2024-01-01T00:00:00Z' },
    { id: 'chunk-2', index: 1, content: 'Second passage content.', token_count: 25, created_at: '2024-01-01T00:00:00Z' },
  ],
};

function renderPage(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/workspaces/:id/documents/:docId" element={<WorkspaceDocumentDetailPage />} />
    </Routes>,
    { route },
  );
}

describe('WorkspaceDocumentDetailPage — source viewer integration', () => {
  beforeEach(() => {
    mockGetDetail.mockReset();
    mockOpen.mockReset();
    mockUseSourceViewer.mockReturnValue({ open: mockOpen, close: vi.fn(), target: null });
  });

  it('auto-opens the viewer at the chunk named by ?chunk= once the document loads', async () => {
    mockGetDetail.mockResolvedValue(baseDoc);

    renderPage('/workspaces/ws-1/documents/doc-1?chunk=chunk-2');

    await screen.findByText('Handbook.pdf');
    await waitFor(() =>
      expect(mockOpen).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        documentId: 'doc-1',
        chunkId: 'chunk-2',
        documentName: 'Handbook.pdf',
      }),
    );
  });

  it('does not auto-open when no ?chunk= is present', async () => {
    mockGetDetail.mockResolvedValue(baseDoc);

    renderPage('/workspaces/ws-1/documents/doc-1');

    await screen.findByText('Handbook.pdf');
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('"Open document" opens the viewer at the first passage', async () => {
    const user = userEvent.setup();
    mockGetDetail.mockResolvedValue(baseDoc);

    renderPage('/workspaces/ws-1/documents/doc-1');
    await screen.findByText('Handbook.pdf');

    await user.click(screen.getByRole('button', { name: /Open document/i }));

    expect(mockOpen).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      documentId: 'doc-1',
      chunkId: 'chunk-1',
      documentName: 'Handbook.pdf',
    });
  });

  it('clicking a passage opens the viewer at that chunk', async () => {
    const user = userEvent.setup();
    mockGetDetail.mockResolvedValue(baseDoc);

    renderPage('/workspaces/ws-1/documents/doc-1');
    await screen.findByText('Handbook.pdf');

    await user.click(screen.getByText('Second passage content.'));

    expect(mockOpen).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      documentId: 'doc-1',
      chunkId: 'chunk-2',
      documentName: 'Handbook.pdf',
    });
  });
});
