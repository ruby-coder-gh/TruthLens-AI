import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/utils';
import AdminGoldenPage from './AdminGoldenPage';
import type { GoldenEntryResponse } from '../api/types';

const { list, approve, remove } = vi.hoisted(() => ({
  list: vi.fn(),
  approve: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('../api/client', () => ({
  adminApi: {
    golden: { list, approve, remove },
  },
}));

function makeEntry(overrides: Partial<GoldenEntryResponse> & Pick<GoldenEntryResponse, 'id'>): GoldenEntryResponse {
  return {
    question: 'What is the PTO carryover limit?',
    reference_answer: 'Employees may carry over up to 5 days.',
    source_documents: ['doc-1'],
    expected_grounding: true,
    category: 'answerable',
    difficulty: 2,
    notes: null,
    source: 'promoted',
    source_query_id: 'q-1',
    workspace_id: 'ws-1',
    created_by: 'u-editor',
    created_at: '2026-09-01T10:00:00Z',
    status: 'pending',
    approved_by: null,
    approved_at: null,
    ...overrides,
  };
}

const pendingEntry = makeEntry({ id: 'ge-1' });
const approvedEntry = makeEntry({
  id: 'ge-2',
  question: 'Does the handbook cover remote work?',
  status: 'approved',
  approved_by: 'u-admin',
  approved_at: '2026-09-02T09:00:00Z',
});

function listResponse(data: GoldenEntryResponse[], total = data.length) {
  return {
    data,
    meta: {
      page: 1,
      page_size: 20,
      total,
      source: 'promoted' as const,
      status: null,
      builtin_count: 0,
      promoted_count: data.length,
      golden_set_version: 'v1',
    },
  };
}

/**
 * Calls made by the *table* query. The header's "awaiting approval" badge runs
 * its own `?source=promoted&status=pending&page_size=1` request against the
 * same mock, so raw call counts would conflate the two.
 */
function tableListCalls() {
  return list.mock.calls.filter(([params]) => params?.page_size === undefined);
}

describe('AdminGoldenPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue(listResponse([pendingEntry]));
    approve.mockResolvedValue({ ...pendingEntry, status: 'approved' });
    remove.mockResolvedValue(undefined);
  });

  it('lists pending rows by default, scoped to promoted source', async () => {
    renderWithProviders(<AdminGoldenPage />, { route: '/admin/golden' });

    expect(await screen.findByText(/what is the pto carryover limit/i)).toBeInTheDocument();
    await waitFor(() => expect(list).toHaveBeenCalledWith({ source: 'promoted', status: 'pending' }));

    const row = screen.getByRole('row', { name: /what is the pto carryover limit/i });
    expect(within(row).getByText('pending')).toBeInTheDocument();
    expect(within(row).getByText('answerable')).toBeInTheDocument();
    expect(within(row).getByText('ws-1')).toBeInTheDocument();
  });

  // Contract: `meta.promoted_count` counts pending *and* approved rows, so the
  // backlog badge has to come from `?source=promoted&status=pending`.
  it('reads the awaiting-approval count from a status=pending list, not promoted_count', async () => {
    list.mockImplementation((params?: { page_size?: number }) =>
      Promise.resolve(
        params?.page_size === 1
          // 3 pending out of 9 promoted overall.
          ? listResponse([pendingEntry], 3)
          : listResponse([pendingEntry, approvedEntry], 9),
      ));

    renderWithProviders(<AdminGoldenPage />, { route: '/admin/golden' });

    expect(await screen.findByText('3 awaiting approval')).toBeInTheDocument();
    await waitFor(() => expect(list).toHaveBeenCalledWith({
      source: 'promoted', status: 'pending', page_size: 1,
    }));
    expect(screen.queryByText(/9 awaiting approval/)).not.toBeInTheDocument();
  });

  it('calls approve for the row and refetches on success', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminGoldenPage />, { route: '/admin/golden' });

    await user.click(await screen.findByRole('button', { name: /approve what is the pto carryover/i }));

    await waitFor(() => expect(approve).toHaveBeenCalledWith('ge-1'));
    // Refetch after the mutation invalidates the query.
    await waitFor(() => expect(tableListCalls()).toHaveLength(2));
  });

  it('requires confirmation before deleting, then calls remove', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminGoldenPage />, { route: '/admin/golden' });

    await user.click(await screen.findByRole('button', { name: /delete what is the pto carryover/i }));

    const dialog = await screen.findByRole('dialog', { name: /delete golden entry/i });
    expect(remove).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: /delete entry/i }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith('ge-1'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('refetches with the selected status when the filter changes', async () => {
    const user = userEvent.setup();
    list.mockResolvedValue(listResponse([pendingEntry]));
    renderWithProviders(<AdminGoldenPage />, { route: '/admin/golden' });

    await screen.findByText(/what is the pto carryover limit/i);
    expect(tableListCalls()).toHaveLength(1);

    list.mockResolvedValue(listResponse([approvedEntry]));
    await user.selectOptions(screen.getByLabelText(/status/i), 'approved');

    await waitFor(() => expect(tableListCalls().at(-1)).toEqual([{ source: 'promoted', status: 'approved' }]));
    expect(await screen.findByText(/does the handbook cover remote work/i)).toBeInTheDocument();

    list.mockResolvedValue(listResponse([pendingEntry, approvedEntry]));
    await user.selectOptions(screen.getByLabelText(/status/i), 'all');
    await waitFor(() => expect(tableListCalls().at(-1)).toEqual([{ source: 'promoted' }]));
  });

  it('does not show Approve for an already-approved entry', async () => {
    list.mockResolvedValue(listResponse([approvedEntry]));
    renderWithProviders(<AdminGoldenPage />, { route: '/admin/golden' });

    const row = await screen.findByRole('row', { name: /does the handbook cover remote work/i });
    expect(within(row).queryByRole('button', { name: /^approve/i })).not.toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /^delete/i })).toBeInTheDocument();
  });

  it('renders an empty state when nothing is pending', async () => {
    list.mockResolvedValue(listResponse([]));
    renderWithProviders(<AdminGoldenPage />, { route: '/admin/golden' });

    expect(await screen.findByText(/nothing awaiting approval/i)).toBeInTheDocument();
  });

  it('renders an error state with a retry when the list fails', async () => {
    const user = userEvent.setup();
    list.mockRejectedValueOnce(new Error('boom'));

    renderWithProviders(<AdminGoldenPage />, { route: '/admin/golden' });

    expect(await screen.findByRole('alert')).toHaveTextContent(/boom/i);
    list.mockResolvedValue(listResponse([pendingEntry]));
    await user.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.getByText(/what is the pto carryover limit/i)).toBeInTheDocument());
  });
});
