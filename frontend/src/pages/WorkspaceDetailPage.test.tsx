import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/utils';
import WorkspaceDetailPage from './WorkspaceDetailPage';
import type { Workspace, WorkspaceMember, User, RadarState } from '../api/types';

vi.mock('../api/client', () => ({
  workspaceApi: {
    get: vi.fn(),
    listMembers: vi.fn(),
    activity: vi.fn(),
  },
  documentApi: {
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

import { workspaceApi, documentApi, radarApi } from '../api/client';

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
    // Documents tab content should not have been rendered instead.
    expect(documentApi.list).not.toHaveBeenCalled();
  });
});
