import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/utils';
import AdminCollectionsPage from './AdminCollectionsPage';

const { list: listWorkspaces } = vi.hoisted(() => ({ list: vi.fn() }));
const { list, update, delete: deleteCollection, create } = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  create: vi.fn(),
}));

vi.mock('../api/client', () => ({
  workspaceApi: { list: listWorkspaces },
  collectionApi: { list, update, delete: deleteCollection, create },
}));

const WORKSPACE = { id: 'ws-1', name: 'Demo Workspace' };

const COLLECTION = {
  id: 'col-1',
  name: 'Financial Reports',
  description: 'Annual filings',
  document_count: 3,
  created_at: '2026-09-01T00:00:00Z',
};

describe('AdminCollectionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listWorkspaces.mockResolvedValue({ data: [WORKSPACE] });
    list.mockResolvedValue({ data: [COLLECTION] });
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
});
