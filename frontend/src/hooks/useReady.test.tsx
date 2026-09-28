import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useReady } from './useReady';
import { demoApi } from '../api/client';
import type { ReadyStatus } from '../api/types';

vi.mock('../api/client', () => ({
  demoApi: { ready: vi.fn() },
}));

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function readyStatus(overrides: Partial<ReadyStatus> = {}): ReadyStatus {
  return {
    status: 'ok',
    demo_mode: true,
    warm: false,
    ollama: { reachable: true, model: 'qwen3:4b', model_present: true },
    models: { embedder: 'warm', reranker: 'warm', nli: 'warm' },
    ...overrides,
  };
}

describe('useReady', () => {
  beforeEach(() => {
    vi.mocked(demoApi.ready).mockReset();
  });

  it('reports demoMode + workspace id once the fetch resolves', async () => {
    vi.mocked(demoApi.ready).mockResolvedValue(readyStatus({ warm: true, demo_workspace_id: 'ws-1' }));

    const { result } = renderHook(() => useReady(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.demoMode).toBe(true);
    expect(result.current.warm).toBe(true);
    expect(result.current.demoWorkspaceId).toBe('ws-1');
  });

  it('treats a failed fetch as "not a demo" instead of surfacing an error', async () => {
    vi.mocked(demoApi.ready).mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useReady(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.demoMode).toBe(false);
    expect(result.current.warm).toBe(false);
    expect(result.current.demoWorkspaceId).toBeNull();
  });
});
