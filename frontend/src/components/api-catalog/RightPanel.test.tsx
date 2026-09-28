import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import RightPanel from './RightPanel';
import { useReady } from '../../hooks/useReady';
import type { UseReadyResult } from '../../hooks/useReady';

vi.mock('../../hooks/useReady', () => ({ useReady: vi.fn() }));

function mockReady(overrides: Partial<UseReadyResult> = {}) {
  vi.mocked(useReady).mockReturnValue({
    demoMode: false,
    warm: false,
    demoWorkspaceId: null,
    models: undefined,
    ollama: undefined,
    isLoading: false,
    ...overrides,
  });
}

// R3-8: the "System Status" card used to hard-code "Operational"/"Connected"
// in green regardless of reality — it now reads off the same public health
// check `useReady` polls (`GET /health/ready`).
describe('RightPanel — System Status (R3-8)', () => {
  it('shows "Checking…" while the health check is still in flight', () => {
    mockReady({ isLoading: true });
    renderWithProviders(<RightPanel />);
    expect(screen.getByText(/checking/i)).toBeInTheDocument();
    expect(screen.queryByText(/operational/i)).not.toBeInTheDocument();
  });

  it('shows "Operational" once the health check confirms the backend is reachable', () => {
    mockReady({ ollama: { reachable: true, model: 'qwen3:4b', model_present: true } });
    renderWithProviders(<RightPanel />);
    expect(screen.getByText(/operational/i)).toBeInTheDocument();
  });

  it('shows "Unreachable" instead of a fake green "Operational" when the health check fails', () => {
    mockReady({ ollama: undefined, isLoading: false });
    renderWithProviders(<RightPanel />);
    expect(screen.getByText(/unreachable/i)).toBeInTheDocument();
    expect(screen.queryByText(/operational/i)).not.toBeInTheDocument();
  });

  it('no longer claims a WebSocket is "Connected" — this page never opens one', () => {
    mockReady({ ollama: { reachable: true, model: 'qwen3:4b', model_present: true } });
    renderWithProviders(<RightPanel />);
    expect(screen.queryByText(/connected/i)).not.toBeInTheDocument();
  });
});
