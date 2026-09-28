import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/utils';
import AdminDocumentDetailPage from './AdminDocumentDetailPage';

const { listAll, getDetail } = vi.hoisted(() => ({
  listAll: vi.fn(),
  getDetail: vi.fn(),
}));

vi.mock('../api/client', () => ({
  documentApi: { listAll, getDetail },
}));

const LIST_DOC = {
  id: 'doc-1',
  workspace_id: 'ws-1',
  filename: 'server-name.csv',
  original_filename: 'Q3 Pipeline.csv',
  mime_type: 'text/csv',
  file_size: 2048,
  status: 'ready',
  uploaded_by: 'u-editor',
  tags: ['finance', 'q3'],
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:05:00Z',
};

const DETAIL = {
  id: 'doc-1',
  workspace_id: 'ws-1',
  original_filename: 'Q3 Pipeline.csv',
  mime_type: 'text/csv',
  file_size: 2048,
  chunk_count: 2,
  status: 'ready',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:05:00Z',
  chunks: [
    { id: 'c-1', index: 0, content: 'Column: Project; Value: Kestrel Ridge', token_count: 12, created_at: '2026-09-01T00:05:00Z' },
    { id: 'c-2', index: 1, content: 'Column: Status; Value: construction', token_count: 9, created_at: '2026-09-01T00:05:00Z' },
  ],
};

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/documents/:docId" element={<AdminDocumentDetailPage />} />
    </Routes>,
    { route: '/admin/documents/doc-1' },
  );
}

describe('AdminDocumentDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAll.mockResolvedValue({ data: [LIST_DOC] });
    getDetail.mockResolvedValue(DETAIL);
  });

  // BUG-38: "Uploaded by" was blank and tags weren't rendered — the detail
  // endpoint response has no `uploaded_by`/`tags` fields, only the list one
  // does, so the page merges them.
  it('shows the uploader and tags merged in from the workspace document list', async () => {
    renderPage();
    expect(await screen.findByTitle('u-editor')).toBeInTheDocument();
    expect(await screen.findByText('finance')).toBeInTheDocument();
    expect(screen.getByText('q3')).toBeInTheDocument();
  });

  it('renders the real chunk list instead of the "loaded on demand" placeholder', async () => {
    renderPage();
    expect(await screen.findByText(/Column: Project; Value: Kestrel Ridge/)).toBeInTheDocument();
    expect(screen.getByText(/Column: Status; Value: construction/)).toBeInTheDocument();
    expect(screen.queryByText(/loaded on demand/i)).not.toBeInTheDocument();
  });

  it('labels a CSV document CSV, not the generic FILE fallback', async () => {
    renderPage();
    expect(await screen.findByText('CSV')).toBeInTheDocument();
  });

  // K3: prefers the resolved name over the raw uploader id once the backend
  // sends it.
  it('shows uploaded_by_name over the raw id when the backend sends it', async () => {
    listAll.mockResolvedValue({ data: [{ ...LIST_DOC, uploaded_by_name: 'demo_editor' }] });
    renderPage();
    expect(await screen.findByText('demo_editor')).toBeInTheDocument();
    expect(screen.queryByText('u-editor')).not.toBeInTheDocument();
  });

  // R2-10: a `ready` document used to render every timeline step grey
  // because `STATUS_ORDER` never contained any real backend status.
  it('marks every step complete (not grey) for a ready document', async () => {
    renderPage();
    await screen.findByText('Processing Timeline');
    // The "done" text class is `text-text`; a not-done step stays `text-text-dim`.
    expect(screen.getByText('Pending')).toHaveClass('text-text');
    expect(screen.getByText('Processing')).toHaveClass('text-text');
    expect(screen.getByText('Ready')).toHaveClass('text-text');
    expect(screen.getByText('Pending')).not.toHaveClass('text-text-dim');
  });
});
