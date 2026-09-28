import { Suspense, lazy } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../test/utils';
import GlobalSearch from './GlobalSearch';
import type { SearchResult } from '../api/types';

const { mockSearch } = vi.hoisted(() => ({ mockSearch: vi.fn() }));

vi.mock('../api/client', () => ({
  searchApi: { search: mockSearch },
}));

const result: SearchResult = {
  id: 'q-1',
  resource_type: 'query',
  workspace_id: 'ws-1',
  workspace_name: 'Northwind Renewables',
  title: 'What was 2025 revenue?',
  snippet: 'Revenue was €412M in fiscal 2025.',
  score: 0.9,
};

// Mirrors Layout.tsx: GlobalSearch sits next to the routed page, both inside
// one Suspense boundary (App.tsx wraps <Routes> in a single <Suspense>).
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <GlobalSearch />
      {children}
    </>
  );
}

let resolveTarget: (() => void) | undefined;

function makeLazyTarget() {
  return lazy(
    () =>
      new Promise<{ default: () => React.ReactElement }>((resolve) => {
        resolveTarget = () => resolve({ default: () => <p>Chat detail page</p> });
      }),
  );
}

function renderHarness() {
  const LazyTarget = makeLazyTarget();
  return renderWithProviders(
    <Suspense fallback={<p>Loading…</p>}>
      <Routes>
        <Route path="/" element={<Shell><p data-testid="page">Dashboard</p></Shell>} />
        <Route path="/workspaces/ws-1/queries/q-1" element={<Shell><LazyTarget /></Shell>} />
      </Routes>
    </Suspense>,
  );
}

beforeEach(() => {
  mockSearch.mockReset();
  mockSearch.mockResolvedValue({ data: [result], meta: { page: 1, page_size: 50, total: 1, workspace_count: 1 } });
  resolveTarget = undefined;
});

describe('GlobalSearch', () => {
  it('closes the modal as soon as a result is picked, even while the target route is still loading (BUG-3)', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: /search all accessible workspaces/i }));
    await user.type(screen.getByPlaceholderText(/search questions/i), 'revenue');
    const resultButton = await waitFor(() => {
      const match = screen
        .getAllByRole('button')
        .find((button) => button.textContent?.toLowerCase().includes('what was 2025 revenue'));
      if (!match) throw new Error('result not rendered yet');
      return match;
    });
    await user.click(resultButton);

    // The navigation target hasn't resolved yet, but the search modal (and
    // its scrim) must already be gone, and the current page must not have
    // been swapped for a Suspense fallback — both are what `startTransition`
    // guarantees and what the un-fixed synchronous navigate() broke.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('.bg-scrim')).not.toBeInTheDocument();
    expect(screen.getByTestId('page')).toBeInTheDocument();

    resolveTarget?.();
    await waitFor(() => expect(screen.getByText('Chat detail page')).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('focuses the search input, not the modal Close button, on open (BUG-13)', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: /search all accessible workspaces/i }));

    await waitFor(() => expect(screen.getByPlaceholderText(/search questions/i)).toHaveFocus());
  });

  it('closes on Escape while focus is in the search input', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: /search all accessible workspaces/i }));
    await waitFor(() => expect(screen.getByPlaceholderText(/search questions/i)).toHaveFocus());

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows a friendly file type instead of a raw MIME snippet for document results (BUG-53)', async () => {
    mockSearch.mockResolvedValue({
      data: [{
        id: 'd-1',
        resource_type: 'document',
        workspace_id: 'ws-1',
        workspace_name: 'Northwind Renewables',
        title: 'Annual Report 2025.docx',
        snippet: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        score: 0.8,
      }],
      meta: { page: 1, page_size: 50, total: 1, workspace_count: 1 },
    });
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: /search all accessible workspaces/i }));
    await user.type(screen.getByPlaceholderText(/search questions/i), 'annual');

    expect(await screen.findByText('DOCX document')).toBeInTheDocument();
    expect(screen.queryByText(/application\/vnd/i)).not.toBeInTheDocument();
  });

  it('strips raw [source:N] markers from result snippets (BUG-9)', async () => {
    mockSearch.mockResolvedValue({
      data: [{
        ...result,
        snippet: 'Revenue was €412 million [source:2].',
      }],
      meta: { page: 1, page_size: 50, total: 1, workspace_count: 1 },
    });
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: /search all accessible workspaces/i }));
    // A query that doesn't match the snippet text, so `highlight()` doesn't
    // split it into multiple nodes and the assertion below stays simple.
    await user.type(screen.getByPlaceholderText(/search questions/i), 'workspace');

    expect(await screen.findByText('Revenue was €412 million [2].')).toBeInTheDocument();
    expect(screen.queryByText(/\[source:2\]/)).not.toBeInTheDocument();
  });
});
