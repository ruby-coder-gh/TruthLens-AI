import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/utils';
import { ThemeProvider } from '../context/ThemeContext';
import Layout from './Layout';
import type { QuerySummary, User, Workspace } from '../api/types';

const { mockWorkspaceGet, mockListAll, mockReviewCount } = vi.hoisted(() => ({
  mockWorkspaceGet: vi.fn(),
  mockListAll: vi.fn(),
  mockReviewCount: vi.fn(),
}));

// This jsdom run has no usable `window.localStorage` — Node's experimental
// global shadows jsdom's implementation and is inert without
// `--localstorage-file`. Layout tolerates that (every access is try/caught),
// but persistence is what BUG-49's test asserts, so install a minimal
// in-memory Storage for it. Mirrors ThemeContext.test.tsx's helper.
function installMemoryStorage() {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: storage,
  });
}

vi.mock('../api/client', () => ({
  workspaceApi: { get: mockWorkspaceGet },
  queryApi: { listAll: mockListAll },
  reviewQueueApi: { count: mockReviewCount },
  searchApi: { search: vi.fn() },
  documentApi: { locate: vi.fn(), fileUrl: vi.fn() },
}));

// Demo-mode chrome (warm-up toast, presenter tour) is covered by DemoTour.test.
vi.mock('../hooks/useReady', () => ({
  useReady: () => ({
    demoMode: false,
    warm: true,
    demoWorkspaceId: null,
    models: undefined,
    ollama: undefined,
    isLoading: false,
  }),
}));

const analyst: User = {
  id: 'u1',
  email: 'demo@example.com',
  username: 'demo_analyst',
  role: 'analyst',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const workspace: Workspace = {
  id: 'ws1',
  name: 'Northwind Renewables — Due Diligence',
  description: '',
  owner_id: 'u1',
  member_count: 1,
  document_count: 6,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const recentChat: QuerySummary = {
  id: 'q1',
  workspace_id: 'ws1',
  query_text: "What was Northwind Renewables' revenue in 2025?",
  is_pinned: false,
  review_status: 'reviewed',
  created_at: '2026-09-01T10:42:00Z',
};

function renderLayout(route: string) {
  return renderWithProviders(
    <ThemeProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="*" element={<p>Page body</p>} />
        </Route>
      </Routes>
    </ThemeProvider>,
    { route, authValue: { user: analyst, isAuthenticated: true } },
  );
}

describe('Layout', () => {
  beforeEach(() => {
    mockWorkspaceGet.mockReset().mockResolvedValue(workspace);
    mockListAll.mockReset().mockResolvedValue({ data: [recentChat], meta: { page: 1, page_size: 6, total: 1 } });
    mockReviewCount.mockReset().mockResolvedValue({ count: 0, review_queue_enabled: true });
  });

  it('renders a single top bar with the mark, one search and the theme toggle', () => {
    renderLayout('/dashboard');

    const banners = screen.getAllByRole('banner');
    expect(banners).toHaveLength(1);
    const topBar = banners[0];
    expect(within(topBar).getByRole('link', { name: 'TruthLens home' })).toHaveAttribute('href', '/dashboard');
    expect(within(topBar).getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
    // The old shell rendered a second (mobile) search row; there is one search now.
    expect(screen.getAllByRole('button', { name: 'Search all accessible workspaces' })).toHaveLength(1);
    expect(screen.getByText('Page body')).toBeInTheDocument();
  });

  it('shows the workspace name and document count as a breadcrumb inside a workspace', async () => {
    renderLayout('/workspaces/ws1/chat');

    const topBar = screen.getByRole('banner');
    const crumb = await within(topBar).findByRole('link', { name: /Northwind Renewables — Due Diligence/ });
    expect(crumb).toHaveAttribute('href', '/workspaces/ws1');
    expect(crumb).toHaveTextContent('6 documents');
    expect(mockWorkspaceGet).toHaveBeenCalledWith('ws1');
  });

  it('has no workspace breadcrumb outside a workspace', () => {
    renderLayout('/dashboard');

    expect(within(screen.getByRole('banner')).getAllByRole('link')).toHaveLength(1);
    expect(mockWorkspaceGet).not.toHaveBeenCalled();
  });

  it('lists New chat, the nav and recent chats in the sidebar, scoped to the workspace', async () => {
    renderLayout('/workspaces/ws1');

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: 'New chat' })).toHaveAttribute('href', '/workspaces/ws1/chat');
    for (const name of ['Dashboard', 'Chat History', 'My Documents', 'Settings']) {
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    }
    expect(within(nav).getByRole('link', { name: 'Review Queue' })).toHaveAttribute('href', '/workspaces/ws1/review-queue');
    // A page inside the Workspaces section marks the section, not the page.
    expect(within(nav).getByRole('link', { name: 'Workspaces' })).toHaveAttribute('aria-current', 'true');

    const recent = await within(nav).findByRole('link', { name: recentChat.query_text });
    expect(recent).toHaveAttribute('href', '/workspaces/ws1/queries/q1');
  });

  it('starts a new chat from the workspace picker and disables Review Queue outside a workspace', () => {
    renderLayout('/dashboard');

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: 'New chat' })).toHaveAttribute('href', '/chat/new');
    expect(within(nav).queryByRole('link', { name: /Review Queue/ })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  });

  it('opens global search with ⌘K, as the top bar advertises', async () => {
    const user = userEvent.setup();
    renderLayout('/dashboard');

    await user.keyboard('{Meta>}k{/Meta}');
    expect(await screen.findByRole('dialog', { name: 'Search all workspaces' })).toBeInTheDocument();
  });

  it('opens the mobile drawer from the menu button and closes it with Escape', async () => {
    const user = userEvent.setup();
    renderLayout('/dashboard');

    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    expect(screen.getByRole('button', { name: 'Close navigation menu' })).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Escape}');
    const toggle = screen.getByRole('button', { name: 'Open navigation menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });

  it('traps Tab focus inside the mobile drawer while it is open (BUG-61)', async () => {
    const user = userEvent.setup();
    renderLayout('/dashboard');

    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    const nav = screen.getByRole('navigation', { name: 'Primary' });

    await waitFor(() => expect(within(nav).getByRole('link', { name: 'New chat' })).toHaveFocus());

    // Shift+Tab from the first focusable element wraps to the last one
    // inside the drawer (the sign-out button), never escaping to the header
    // behind the scrim.
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(within(nav).getByRole('button', { name: 'Sign out' })).toHaveFocus();
  });

  it('fetches only the signed-in user\'s recent chats (BUG-59 / C3)', async () => {
    renderLayout('/workspaces/ws1');

    await screen.findByRole('link', { name: recentChat.query_text });
    expect(mockListAll).toHaveBeenCalledWith(expect.objectContaining({ mine: true }));
  });

  it('persists the sidebar collapsed state across a reload (BUG-49)', async () => {
    installMemoryStorage();
    const user = userEvent.setup();
    renderLayout('/dashboard');

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(window.localStorage.getItem('truthlens:sidebar-collapsed')).toBe('true');

    // A fresh mount (simulating reload) reads the stored preference back.
    renderLayout('/dashboard');
    expect(screen.getAllByRole('button', { name: 'Expand sidebar' })[0]).toBeInTheDocument();
  });
});
