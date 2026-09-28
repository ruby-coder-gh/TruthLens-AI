import { useQuery } from '@tanstack/react-query';
import { demoApi } from '../api/client';
import type { ReadyStatus } from '../api/types';

// Owning lane: L10 (Demo FE). Polls the PUBLIC `/health/ready` endpoint so
// demo UI (landing CTA, one-click login, warm-up toast) knows whether this
// deployment is running in demo mode and whether the models are warm yet.
// 5s cadence while cold, backs off to 60s once warm — no point hammering the
// backend once there's nothing left to wait for.
const COLD_INTERVAL_MS = 5_000;
const WARM_INTERVAL_MS = 60_000;

export interface UseReadyResult {
  demoMode: boolean;
  warm: boolean;
  demoWorkspaceId: string | null;
  models: ReadyStatus['models'] | undefined;
  ollama: ReadyStatus['ollama'] | undefined;
  isLoading: boolean;
}

export function useReady(): UseReadyResult {
  const { data, isLoading, isError } = useQuery<ReadyStatus>({
    queryKey: ['demo-ready'],
    queryFn: () => demoApi.ready(),
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => (query.state.data?.warm ? WARM_INTERVAL_MS : COLD_INTERVAL_MS),
  });

  // A failed fetch (backend down, not a demo deployment, network hiccup)
  // means we can't confirm demo mode — treat it the same as "not a demo"
  // rather than risk showing demo-only UI against a broken read.
  const demoMode = !isError && Boolean(data?.demo_mode);

  return {
    demoMode,
    warm: data?.warm ?? false,
    demoWorkspaceId: data?.demo_workspace_id ?? null,
    models: data?.models,
    ollama: data?.ollama,
    isLoading,
  };
}
