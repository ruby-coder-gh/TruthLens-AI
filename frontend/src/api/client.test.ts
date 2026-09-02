import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// `request()` keeps refresh-dedup state (`isRefreshing`/`refreshPromise`) at
// module scope, so each case gets a fresh module instance via dynamic import
// after `vi.resetModules()` — otherwise state from an earlier case would leak
// into the next assertion.
describe('api/client', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('sends credentials: "include" on every request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'u1' }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { api } = await import('./client');
    await api.auth.me();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/auth/me');
    expect(init).toMatchObject({ credentials: 'include' });
  });

  it('replays the original request once after a successful 401 refresh', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 })) // initial /auth/me
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 })) // /auth/refresh
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'u1' }), { status: 200 })); // replay
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { api } = await import('./client');
    const result = await api.auth.me();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1][0])).toContain('/auth/refresh');
    expect(String(fetchMock.mock.calls[2][0])).toContain('/auth/me');
    expect(result).toEqual({ id: 'u1' });
  });

  it('never attempts a refresh for PUBLIC_AUTH_PATHS — surfaces the real 401', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Invalid credentials' }), { status: 401 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { api } = await import('./client');
    await expect(
      api.auth.login({ email: 'user@example.com', password: 'wrong' }),
    ).rejects.toMatchObject({ message: 'Invalid credentials', status: 401 });

    // Exactly one call — no refresh attempt, no replay.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ApiError carries the HTTP status and backend detail', async () => {
    // A fresh Response per call — a Response body stream can only be read
    // once, and `handleResponse` calls `.json()` on it.
    const fetchMock = vi.fn().mockImplementation(
      async () => new Response(JSON.stringify({ detail: 'Workspace not found' }), { status: 404 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { api, ApiError } = await import('./client');

    try {
      await api.workspaces.get('ws-404');
      expect.unreachable('expected api.workspaces.get to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as InstanceType<typeof ApiError>;
      expect(apiErr.status).toBe(404);
      expect(apiErr.detail).toBe('Workspace not found');
    }
  });

  // The prompt promote gate answers 409 through the app's standard error
  // envelope, and AdminPromptsPage reads the machine-readable body off
  // `ApiError.details`. This binds `parseErrorResponse` to that contract.
  it('ApiError.details carries the error envelope details (promote gate 409)', async () => {
    const details = {
      detail: 'eval_gate_failed',
      reason: 'thresholds_not_met',
      failed_metrics: ['faithfulness', 'trust'],
      thresholds: {
        min_faithfulness: 0.6,
        min_trust: 0.5,
        min_context_precision: 0.5,
        refusal_accuracy_min: 0.7,
      },
      scores: { faithfulness: 0.05, trust: 0.46, refusal_accuracy: 1, context_precision: null },
    };
    const fetchMock = vi.fn().mockImplementation(
      async () => new Response(
        JSON.stringify({ error: { code: 'CONFLICT', message: 'eval_gate_failed', details } }),
        { status: 409 },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { adminApi, ApiError } = await import('./client');

    try {
      await adminApi.prompts.promote('pv-1');
      expect.unreachable('expected promote to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as InstanceType<typeof ApiError>;
      expect(apiErr.status).toBe(409);
      expect(apiErr.message).toBe('eval_gate_failed');
      expect(apiErr.details).toEqual(details);
    }

    // A 409 is not a 401, so nothing is retried, and an unforced promote must
    // not send `?force=`.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/admin/prompts/pv-1/promote');
    expect(url).not.toContain('force');
  });
});
