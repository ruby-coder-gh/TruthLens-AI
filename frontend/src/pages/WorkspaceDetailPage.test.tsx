import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route, useLocation } from 'react-router-dom';
import { renderWithProviders } from '../test/utils';
import WorkspaceDetailPage from './WorkspaceDetailPage';
import type { Workspace, WorkspaceMember, User, RadarState } from '../api/types';

vi.mock('../api/client', () => ({
  workspaceApi: {
    get: vi.fn(),
    listMembers: vi.fn(),
    activity: vi.fn(),
    addMember: vi.fn(),
    removeMember: vi.fn(),
    updateMemberRole: vi.fn(),
  },
  documentApi: {
    list: vi.fn(),
  },
  queryApi: {
    list: vi.fn(),
  },
  radarApi: {
    get: vi.fn(),
    scan: vi.fn(),
    setStatus: vi.fn(),
  },
}));

vi.mock('../context/SourceViewerContext', () => ({
  useSourceViewer: () => ({ open: vi.fn(), close: vi.fn(), target: null }),
}));

import { workspaceApi, documentApi, queryApi, radarApi } from '../api/client';

const user: User = {
  id: 'u1',
  email: 'a@b.com',
  username: 'alice',
  role: 'user',
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const workspace: Workspace = {
  id: 'ws-1',
  name: 'Acme',
  description: 'Test workspace',
  owner_id: 'u1',
  member_count: 1,
  document_count: 0,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const members: WorkspaceMember[] = [
  { id: 'm1', workspace_id: 'ws-1', user_id: 'u1', role: 'owner', username: 'alice', email: 'a@b.com', joined_at: '2024-01-01T00:00:00Z' },
];

function radarState(overrides: Partial<RadarState> = {}): RadarState {
  return {
    latest_scan: null,
    contradictions: [],
    counts: { open: 0, dismissed: 0, resolved: 0 },
    ...overrides,
  };
}

function renderPage(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/workspaces/:id" element={<WorkspaceDetailPage />} />
    </Routes>,
    { route, authValue: { user, isAuthenticated: true } },
  );
}

describe('WorkspaceDetailPage — Radar tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(workspaceApi.get).mockResolvedValue(workspace);
    vi.mocked(workspaceApi.listMembers).mockResolvedValue({ data: members });
    vi.mocked(workspaceApi.activity).mockResolvedValue({ data: [] });
    vi.mocked(documentApi.list).mockResolvedValue({ data: [] });
    vi.mocked(queryApi.list).mockResolvedValue({ data: [], meta: { page: 1, page_size: 1, total: 0 } });
  });

  it('shows an open-count badge on the Radar tab', async () => {
    vi.mocked(radarApi.get).mockResolvedValue(radarState({ counts: { open: 3, dismissed: 0, resolved: 1 } }));

    renderPage('/workspaces/ws-1');

    expect(await screen.findByRole('tab', { name: /Radar \(3\)/i })).toBeInTheDocument();
  });

  it('opens the Radar tab directly when ?tab=radar is present', async () => {
    vi.mocked(radarApi.get).mockResolvedValue(radarState());

    renderPage('/workspaces/ws-1?tab=radar');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Contradiction Radar/i })).toBeInTheDocument();
    });
    // The Documents tab body (upload dropzone) should not have been rendered
    // instead — the header's own stats query legitimately fetches the same
    // document list regardless of which tab is active (BUG-30).
    expect(screen.queryByLabelText(/Upload document/i)).not.toBeInTheDocument();
  });

  it('puts every tab in the URL, not just Radar (BUG-54)', async () => {
    const testUser = userEvent.setup();
    vi.mocked(radarApi.get).mockResolvedValue(radarState());

    function LocationProbe() {
      return <p data-testid="search">{useLocation().search}</p>;
    }

    renderWithProviders(
      <Routes>
        <Route path="/workspaces/:id" element={<><WorkspaceDetailPage /><LocationProbe /></>} />
      </Routes>,
      { route: '/workspaces/ws-1', authValue: { user, isAuthenticated: true } },
    );
    await screen.findByText('No documents yet');

    await testUser.click(screen.getByRole('tab', { name: /^Members$/i }));

    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent('?tab=members'));
    expect(screen.getByRole('tab', { name: /^Members$/i })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('WorkspaceDetailPage — Documents tab upload permission (BUG-14)', () => {
  const viewerUser: User = { ...user, id: 'u2' };
  const membersWithViewer: WorkspaceMember[] = [
    ...members,
    { id: 'm2', workspace_id: 'ws-1', user_id: 'u2', role: 'viewer', username: 'val', email: 'v@b.com', joined_at: '2024-01-01T00:00:00Z' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(workspaceApi.get).mockResolvedValue(workspace);
    vi.mocked(workspaceApi.listMembers).mockResolvedValue({ data: membersWithViewer });
    vi.mocked(workspaceApi.activity).mockResolvedValue({ data: [] });
    vi.mocked(documentApi.list).mockResolvedValue({ data: [] });
    vi.mocked(queryApi.list).mockResolvedValue({ data: [], meta: { page: 1, page_size: 1, total: 0 } });
    vi.mocked(radarApi.get).mockResolvedValue(radarState());
  });

  it('hides the upload control and dropzone from a viewer', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/workspaces/:id" element={<WorkspaceDetailPage />} />
      </Routes>,
      { route: '/workspaces/ws-1', authValue: { user: viewerUser, isAuthenticated: true } },
    );

    await screen.findByText('No documents yet');
    expect(screen.queryByLabelText(/Upload document/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Upload document$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Ask a workspace editor or the owner/i)).toBeInTheDocument();
  });

  it('shows the upload control to the owner', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/workspaces/:id" element={<WorkspaceDetailPage />} />
      </Routes>,
      { route: '/workspaces/ws-1', authValue: { user, isAuthenticated: true } },
    );

    await screen.findByText('No documents yet');
    expect(screen.getByLabelText(/Upload document/i)).toBeInTheDocument();
  });
});

describe('WorkspaceDetailPage — Members tab invite by email (BUG-15)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(workspaceApi.get).mockResolvedValue(workspace);
    vi.mocked(workspaceApi.listMembers).mockResolvedValue({ data: members });
    vi.mocked(workspaceApi.activity).mockResolvedValue({ data: [] });
    vi.mocked(documentApi.list).mockResolvedValue({ data: [] });
    vi.mocked(queryApi.list).mockResolvedValue({ data: [], meta: { page: 1, page_size: 1, total: 0 } });
    vi.mocked(radarApi.get).mockResolvedValue(radarState());
  });

  it('invites a member by email instead of a raw user ID', async () => {
    vi.mocked(workspaceApi.addMember).mockResolvedValue({
      id: 'm2', workspace_id: 'ws-1', user_id: 'u2', role: 'editor', username: 'val', email: 'val@b.com', joined_at: '2024-01-01T00:00:00Z',
    });
    const testUser = userEvent.setup();

    renderPage('/workspaces/ws-1');

    await testUser.click(await screen.findByRole('tab', { name: /^Members$/i }));
    await testUser.click(await screen.findByRole('button', { name: /invite member/i }));

    const emailInput = await screen.findByLabelText(/email/i);
    expect(emailInput).toHaveAttribute('type', 'email');

    await testUser.type(emailInput, 'val@b.com');
    await testUser.click(screen.getByRole('button', { name: /^Add$/i }));

    await waitFor(() => expect(workspaceApi.addMember).toHaveBeenCalledWith('ws-1', { email: 'val@b.com', role: 'editor' }));
  });

  it('rejects an empty or malformed email before calling the API', async () => {
    const testUser = userEvent.setup();
    renderPage('/workspaces/ws-1');

    await testUser.click(await screen.findByRole('tab', { name: /^Members$/i }));
    await testUser.click(await screen.findByRole('button', { name: /invite member/i }));
    await testUser.click(screen.getByRole('button', { name: /^Add$/i }));

    expect(await screen.findByText(/email is required/i)).toBeInTheDocument();
    expect(workspaceApi.addMember).not.toHaveBeenCalled();
  });
});

describe('WorkspaceDetailPage — Members tab actions menu (BUG-15/R2-9)', () => {
  // A second, non-self, non-owner member so the actions menu (role change +
  // remove) renders — it's gated to isOwner && !isSelf && role !== 'owner'.
  const editorMember: WorkspaceMember = {
    id: 'm2', workspace_id: 'ws-1', user_id: 'u2', role: 'editor', username: 'val', email: 'v@b.com', joined_at: '2024-01-01T00:00:00Z',
  };
  const membersWithEditor: WorkspaceMember[] = [...members, editorMember];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(workspaceApi.get).mockResolvedValue(workspace);
    vi.mocked(workspaceApi.listMembers).mockResolvedValue({ data: membersWithEditor });
    vi.mocked(workspaceApi.activity).mockResolvedValue({ data: [] });
    vi.mocked(documentApi.list).mockResolvedValue({ data: [] });
    vi.mocked(queryApi.list).mockResolvedValue({ data: [], meta: { page: 1, page_size: 1, total: 0 } });
    vi.mocked(radarApi.get).mockResolvedValue(radarState());
  });

  it('changing the role select calls the existing PUT member-role endpoint', async () => {
    vi.mocked(workspaceApi.updateMemberRole).mockResolvedValue({ ...editorMember, role: 'viewer' });
    const testUser = userEvent.setup();

    renderPage('/workspaces/ws-1');
    await testUser.click(await screen.findByRole('tab', { name: /^Members$/i }));
    await testUser.click(await screen.findByRole('button', { name: /member actions/i }));

    const roleSelect = await screen.findByLabelText(/change val's role/i);
    await testUser.selectOptions(roleSelect, 'viewer');

    await waitFor(() => expect(workspaceApi.updateMemberRole).toHaveBeenCalledWith('ws-1', 'u2', 'viewer'));
  });

  it('closes the menu on Escape', async () => {
    const testUser = userEvent.setup();
    renderPage('/workspaces/ws-1');
    await testUser.click(await screen.findByRole('tab', { name: /^Members$/i }));
    await testUser.click(await screen.findByRole('button', { name: /member actions/i }));

    expect(await screen.findByText('Remove member')).toBeInTheDocument();
    await testUser.keyboard('{Escape}');
    expect(screen.queryByText('Remove member')).not.toBeInTheDocument();
  });

  // R2-9: the old `fixed inset-0 z-30` backdrop blocked every other control
  // on the page while the menu was open.
  it('does not block other controls with a full-screen backdrop while open', async () => {
    const testUser = userEvent.setup();
    renderPage('/workspaces/ws-1');
    await testUser.click(await screen.findByRole('tab', { name: /^Members$/i }));
    await testUser.click(await screen.findByRole('button', { name: /member actions/i }));

    expect(await screen.findByText('Remove member')).toBeInTheDocument();
    // The Invite Member button is elsewhere on the same tab — with a
    // blocking backdrop it would swallow the click instead of firing.
    await testUser.click(screen.getByRole('button', { name: /invite member/i }));
    expect(await screen.findByLabelText(/email/i)).toBeInTheDocument();
  });
});
