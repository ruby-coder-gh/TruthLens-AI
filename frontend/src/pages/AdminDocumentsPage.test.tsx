import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/utils';
import AdminDocumentsPage from './AdminDocumentsPage';
import { documentApi } from '../api/client';
import type { Document } from '../api/types';

vi.mock('../api/client', () => ({
  documentApi: {
    listAll: vi.fn(),
    bulk: vi.fn(),
  },
}));

const mockListAll = vi.mocked(documentApi.listAll);
const mockBulk = vi.mocked(documentApi.bulk);

const baseDoc = {
  workspace_id: 'ws-1',
  filename: 'file.pdf',
  mime_type: 'application/pdf',
  file_size: 2048,
  chunk_count: 5,
  status: 'indexed',
  uploaded_by: 'alice',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockDocs: Document[] = [
  { ...baseDoc, id: 'doc-1', original_filename: 'Contract.pdf', tags: ['legal'] },
  { ...baseDoc, id: 'doc-2', original_filename: 'Invoice.pdf', tags: ['legal', 'finance'] },
  { ...baseDoc, id: 'doc-3', original_filename: 'Report.pdf', tags: [] },
];

function mockDocsResponse() {
  return {
    data: mockDocs,
    meta: { page: 1, page_size: 20, total: mockDocs.length },
  };
}

async function renderPage(addToast = vi.fn()) {
  const utils = renderWithProviders(<AdminDocumentsPage />, {
    toastValue: { addToast },
  });
  await screen.findByText('Contract.pdf');
  return { ...utils, addToast };
}

describe('AdminDocumentsPage — bulk document ops', () => {
  beforeEach(() => {
    mockListAll.mockReset();
    mockBulk.mockReset();
    mockListAll.mockResolvedValue(mockDocsResponse());
    mockBulk.mockResolvedValue({
      results: [
        { id: 'doc-2', status: 'ok' },
        { id: 'doc-3', status: 'ok' },
      ],
      summary: { ok: 2, accepted: 0, failed: 0 },
    });
  });

  it('select-all toggles all 3 rows', async () => {
    const user = userEvent.setup();
    await renderPage();

    const selectAll = screen.getByLabelText('Select all documents');
    await user.click(selectAll);

    expect(screen.getByLabelText('Select Contract.pdf')).toBeChecked();
    expect(screen.getByLabelText('Select Invoice.pdf')).toBeChecked();
    expect(screen.getByLabelText('Select Report.pdf')).toBeChecked();
    expect(screen.getByText('3 selected')).toBeInTheDocument();
  });

  it('unchecking one row after select-all shows "2 selected"', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByLabelText('Select all documents'));
    await user.click(screen.getByLabelText('Select Contract.pdf'));

    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.getByLabelText('Select Contract.pdf')).not.toBeChecked();
  });

  it('bulk delete: confirm calls documentApi.bulk("delete", ids) and shows a summary toast', async () => {
    const user = userEvent.setup();
    const addToast = vi.fn();
    await renderPage(addToast);

    // Select all 3, then uncheck doc-1 -> selection is [doc-2, doc-3].
    await user.click(screen.getByLabelText('Select all documents'));
    await user.click(screen.getByLabelText('Select Contract.pdf'));
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /delete/i }));

    const dialog = await screen.findByRole('dialog', { name: 'Delete Documents' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockBulk).toHaveBeenCalledWith('delete', ['doc-2', 'doc-3'], undefined);
    });

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('Delete: 2 ok, 0 accepted, 0 failed', 'success');
    });

    // Selection is cleared after the action.
    expect(screen.queryByText('2 selected')).not.toBeInTheDocument();
  });

  it('tag modal submits the parsed comma-separated tags', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByLabelText('Select Report.pdf'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Tag' }));

    const dialog = await screen.findByRole('dialog', { name: 'Tag Documents' });
    await user.type(within(dialog).getByLabelText('Add tags (comma-separated)'), 'legal');
    await user.click(within(dialog).getByRole('button', { name: 'Apply Tags' }));

    await waitFor(() => {
      expect(mockBulk).toHaveBeenCalledWith('tag', ['doc-3'], ['legal']);
    });
  });

  it('regression: typed search text is passed to documentApi.listAll', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.type(screen.getByPlaceholderText('Search documents...'), 'Contract');

    await waitFor(() => {
      expect(mockListAll).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'Contract' }),
      );
    });
  });
});
