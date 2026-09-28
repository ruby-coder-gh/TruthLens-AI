import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/utils';
import AdminCollectionsPage from './AdminCollectionsPage';

const { list: listWorkspaces } = vi.hoisted(() => ({ list: vi.fn() }));
const { list, update, delete: deleteCollection, create, addDocuments, removeDocument } = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  create: vi.fn(),
  addDocuments: vi.fn(),
  removeDocument: vi.fn(),
}));
const { list: listDocuments } = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('../api/client', () => ({
  workspaceApi: { list: listWorkspaces },
  collectionApi: { list, update, delete: deleteCollection, create, addDocuments, removeDocument },
  documentApi: { list: listDocuments },
}));

const WORKSPACE = { id: 'ws-1', name: 'Demo Workspace' };

const COLLECTION = {
  id: 'col-1',
  name: 'Financial Reports',
  description: 'Annual filings',
  document_count: 3,
  created_at: '2026-09-01T00:00:00Z',
};

const DOC_IN_COLLECTION = { id: 'doc-1', original_filename: 'Annual Report.pdf', collection_id: 'col-1' };
const DOC_UNASSIGNED = { id: 'doc-2', original_filename: 'Notes.txt', collection_id: null };

describe('AdminCollectionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listWorkspaces.mockResolvedValue({ data: [WORKSPACE] });
    list.mockResolvedValue({ data: [COLLECTION] });
    listDocuments.mockResolvedValue({ data: [DOC_IN_COLLECTION, DOC_UNASSIGNED] });
  });

  // BUG-18: only Create worked — cards had no edit or delete action at all.
  it('edits a collection name via the API', async () => {
    const user = userEvent.setup();
    update.mockResolvedValue({ ...COLLECTION, name: 'Annual Reports' });
    renderWithProviders(<AdminCollectionsPage />);

    await user.click(await screen.findByRole('button', { name: /^edit$/i }));
    const dialog = await screen.findByRole('dialog', { name: /edit collection/i });
    const nameInput = within(dialog).getByLabelText(/collection name/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'Annual Reports');
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(update).toHaveBeenCalledWith(
      'ws-1', 'col-1', { name: 'Annual Reports', description: 'Annual filings' },
    ));
  });

  it('deletes a collection after confirmation', async () => {
    const user = userEvent.setup();
    deleteCollection.mockResolvedValue(undefined);
    renderWithProviders(<AdminCollectionsPage />);

    await user.click(await screen.findByRole('button', { name: /^delete$/i }));
    const dialog = await screen.findByRole('dialog', { name: /delete collection/i });
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(deleteCollection).toHaveBeenCalledWith('ws-1', 'col-1'));
  });

  // BUG-18: there was no way to add or remove a document from a collection
  // after it was created.
  it('opens a document picker showing which documents are already assigned', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminCollectionsPage />);

    await user.click(await screen.findByRole('button', { name: /^documents$/i }));

    const dialog = await screen.findByRole('dialog', { name: /manage documents/i });
    const inRow = within(dialog).getByText('Annual Report.pdf').closest('li');
    const outRow = within(dialog).getByText('Notes.txt').closest('li');
    if (!inRow || !outRow) throw new Error('document rows not found');

    expect(within(inRow).getByRole('button', { name: /^remove$/i })).toBeInTheDocument();
    expect(within(outRow).getByRole('button', { name: /^add$/i })).toBeInTheDocument();
  });

  it('adds an unassigned document to the collection', async () => {
    const user = userEvent.setup();
    addDocuments.mockResolvedValue({ ...COLLECTION, document_count: 4 });
    renderWithProviders(<AdminCollectionsPage />);

    await user.click(await screen.findByRole('button', { name: /^documents$/i }));
    const dialog = await screen.findByRole('dialog', { name: /manage documents/i });
    const outRow = within(dialog).getByText('Notes.txt').closest('li');
    if (!outRow) throw new Error('row not found');

    await user.click(within(outRow).getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(addDocuments).toHaveBeenCalledWith('ws-1', 'col-1', ['doc-2']));
    expect(await within(outRow).findByRole('button', { name: /^remove$/i })).toBeInTheDocument();
  });

  it('removes an assigned document from the collection', async () => {
    const user = userEvent.setup();
    removeDocument.mockResolvedValue(undefined);
    renderWithProviders(<AdminCollectionsPage />);

    await user.click(await screen.findByRole('button', { name: /^documents$/i }));
    const dialog = await screen.findByRole('dialog', { name: /manage documents/i });
    const inRow = within(dialog).getByText('Annual Report.pdf').closest('li');
    if (!inRow) throw new Error('row not found');

    await user.click(within(inRow).getByRole('button', { name: /^remove$/i }));

    await waitFor(() => expect(removeDocument).toHaveBeenCalledWith('ws-1', 'col-1', 'doc-1'));
    expect(await within(inRow).findByRole('button', { name: /^add$/i })).toBeInTheDocument();
  });
});
