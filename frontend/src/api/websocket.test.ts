import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  QueryWebSocket,
  WS_RECONNECT_BACKOFF_MS,
  WS_RECONNECT_MAX,
  type QueryWebSocketCallbacks,
} from './websocket';

// websocket.ts pulls `attemptTokenRefresh` out of the API client; stubbing the
// whole module keeps the real fetch-based client (and its module-level refresh
// dedup state) out of these tests.
const attemptTokenRefresh = vi.hoisted(() => vi.fn<() => Promise<boolean>>());
vi.mock('./client', () => ({ attemptTokenRefresh }));

// ─── Fake WebSocket ──────────────────────────────────────────────────────────
// jsdom has no WebSocket. This stand-in records every frame the client sends
// and exposes `server*` drivers so a test can play the server side by hand.

type Handler<E> = ((event: E) => void) | null;

interface SentFrame {
  type: string;
  payload?: Record<string, unknown>;
}

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState: number = FakeWebSocket.CONNECTING;
  readonly sent: string[] = [];
  closeCalls = 0;

  onopen: Handler<Event> = null;
  onmessage: Handler<MessageEvent> = null;
  onerror: Handler<Event> = null;
  onclose: Handler<CloseEvent> = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = FakeWebSocket.CLOSED;
  }

  // ─── test drivers ──────────────────────────────────────────────────────────

  serverOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  serverSend(frame: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
  }

  serverClose(code = 1006): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason: '', wasClean: false } as CloseEvent);
  }

  frames(): SentFrame[] {
    return this.sent.map((raw) => JSON.parse(raw) as SentFrame);
  }
}

function lastSocket(): FakeWebSocket {
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
}

/** Let pending microtasks (e.g. the token refresh promise) settle. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

type CB = Required<QueryWebSocketCallbacks>;

function makeCallbacks() {
  return {
    onToken: vi.fn<CB['onToken']>(),
    onSource: vi.fn<CB['onSource']>(),
    onGuardrail: vi.fn<CB['onGuardrail']>(),
    onTrustScore: vi.fn<CB['onTrustScore']>(),
    onComplete: vi.fn<CB['onComplete']>(),
    onError: vi.fn<CB['onError']>(),
    onProgress: vi.fn<CB['onProgress']>(),
    onReconnecting: vi.fn<CB['onReconnecting']>(),
    onReconnected: vi.fn<CB['onReconnected']>(),
    onStreamEnd: vi.fn<CB['onStreamEnd']>(),
  };
}

/**
 * Drive a client through connect → auth → ack → one token, leaving it
 * mid-stream with `queryId = 'q-42'` and `lastSeq = 2`.
 */
function startStream() {
  const cb = makeCallbacks();
  const client = new QueryWebSocket('ws-1', 'Why is the sky blue?', cb, 'conv-1');
  client.connect();

  const socket = lastSocket();
  socket.serverOpen();
  socket.serverSend({ type: 'auth_success' });
  socket.serverSend({ type: 'ack', seq: 1, payload: { query_id: 'q-42' } });
  socket.serverSend({ type: 'token', seq: 2, payload: { query_id: 'q-42', token: 'Hel', index: 0 } });

  return { client, cb, socket };
}

describe('api/websocket — QueryWebSocket reconnect + resume', () => {
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    attemptTokenRefresh.mockReset();
    attemptTokenRefresh.mockResolvedValue(true);
    originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
  });

  it('sends the query after auth_success and streams tokens through', () => {
    const { cb, socket } = startStream();

    expect(socket.frames()).toEqual([
      {
        type: 'query',
        payload: { workspace_id: 'ws-1', query: 'Why is the sky blue?', conversation_id: 'conv-1' },
      },
    ]);
    expect(cb.onToken).toHaveBeenCalledWith('Hel');
    expect(cb.onReconnecting).not.toHaveBeenCalled();
  });

  it('reconnects after a non-user close with the exact backoff schedule', async () => {
    const { cb } = startStream();

    for (let attempt = 1; attempt <= WS_RECONNECT_MAX; attempt += 1) {
      const before = FakeWebSocket.instances.length;
      lastSocket().serverClose(1006);

      expect(cb.onReconnecting).toHaveBeenCalledTimes(attempt);
      expect(cb.onReconnecting).toHaveBeenLastCalledWith(attempt);

      const delay = WS_RECONNECT_BACKOFF_MS[attempt - 1];
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(FakeWebSocket.instances).toHaveLength(before);

      await vi.advanceTimersByTimeAsync(1);
      expect(FakeWebSocket.instances).toHaveLength(before + 1);
    }

    expect(WS_RECONNECT_BACKOFF_MS).toEqual([500, 1000, 2000, 4000]);
    expect(cb.onError).not.toHaveBeenCalled();
  });

  it('sends resume with the query id and last seq after auth_success on the new socket', async () => {
    const { socket } = startStream();

    socket.serverClose(1006);
    await vi.advanceTimersByTimeAsync(500);

    const revived = lastSocket();
    revived.serverOpen();
    revived.serverSend({ type: 'auth_success' });

    expect(revived.frames()).toEqual([
      { type: 'resume', payload: { query_id: 'q-42', last_seq: 2 } },
    ]);
  });

  it('delivers replayed frames, clears the reconnect state and advances lastSeq', async () => {
    const { cb, socket } = startStream();

    socket.serverClose(1006);
    await vi.advanceTimersByTimeAsync(500);

    const revived = lastSocket();
    revived.serverOpen();
    revived.serverSend({ type: 'auth_success' });

    // Replay: only the frames the client had not seen (seq > 2), then the
    // `resumed` marker — the backend sends it *after* the replay.
    revived.serverSend({ type: 'token', seq: 3, payload: { query_id: 'q-42', token: 'lo ', index: 1 } });
    revived.serverSend({ type: 'token', seq: 4, payload: { query_id: 'q-42', token: 'world', index: 2 } });
    revived.serverSend({
      type: 'resumed',
      payload: { query_id: 'q-42', from_seq: 2, replayed: 2, live: true },
    });

    expect(cb.onToken.mock.calls.map(([t]) => t)).toEqual(['Hel', 'lo ', 'world']);
    expect(cb.onReconnected).toHaveBeenCalledTimes(1);

    // A second drop resumes from the replayed high-water mark, and the backoff
    // restarts at 500ms because the previous reconnect succeeded.
    revived.serverClose(1006);
    await vi.advanceTimersByTimeAsync(500);

    const third = lastSocket();
    third.serverOpen();
    third.serverSend({ type: 'auth_success' });

    expect(third.frames()).toEqual([
      { type: 'resume', payload: { query_id: 'q-42', last_seq: 4 } },
    ]);
  });

  it('re-sends the original query once when the server answers RESUME_UNAVAILABLE', async () => {
    const { cb, socket } = startStream();

    socket.serverClose(1006);
    await vi.advanceTimersByTimeAsync(500);

    const revived = lastSocket();
    revived.serverOpen();
    revived.serverSend({ type: 'auth_success' });
    revived.serverSend({
      type: 'error',
      payload: {
        code: 'RESUME_UNAVAILABLE',
        message: 'Stream is no longer available; re-send the query',
        query_id: 'q-42',
      },
    });

    expect(revived.frames()).toEqual([
      { type: 'resume', payload: { query_id: 'q-42', last_seq: 2 } },
      {
        type: 'query',
        payload: { workspace_id: 'ws-1', query: 'Why is the sky blue?', conversation_id: 'conv-1' },
      },
    ]);
    // The fallback is invisible to the UI — no error, still reconnecting.
    expect(cb.onError).not.toHaveBeenCalled();
    expect(cb.onReconnected).not.toHaveBeenCalled();

    // The re-run mints a fresh query_id, which the client adopts.
    revived.serverSend({ type: 'ack', seq: 1, payload: { query_id: 'q-99' } });
    expect(cb.onReconnected).toHaveBeenCalledTimes(1);

    revived.serverClose(1006);
    await vi.advanceTimersByTimeAsync(500);
    const third = lastSocket();
    third.serverOpen();
    third.serverSend({ type: 'auth_success' });

    expect(third.frames()).toEqual([
      { type: 'resume', payload: { query_id: 'q-99', last_seq: 1 } },
    ]);
  });

  it('surfaces RESUME_UNAVAILABLE instead of looping when the fallback query also fails', async () => {
    const { cb, socket } = startStream();

    socket.serverClose(1006);
    await vi.advanceTimersByTimeAsync(500);
    const revived = lastSocket();
    revived.serverOpen();
    revived.serverSend({ type: 'auth_success' });
    revived.serverSend({ type: 'error', payload: { code: 'RESUME_UNAVAILABLE', message: 'gone' } });
    revived.serverSend({ type: 'error', payload: { code: 'RESUME_UNAVAILABLE', message: 'gone' } });

    expect(cb.onError).toHaveBeenCalledTimes(1);
    expect(cb.onError).toHaveBeenCalledWith('RESUME_UNAVAILABLE', 'gone');
    // Two resume/query pairs would mean an infinite retry loop.
    expect(revived.frames().filter((f) => f.type === 'query')).toHaveLength(1);
  });

  it('gives up with onError(connection_lost) after the maximum number of attempts', async () => {
    const { cb } = startStream();

    for (let attempt = 1; attempt <= WS_RECONNECT_MAX; attempt += 1) {
      lastSocket().serverClose(1006);
      await vi.advanceTimersByTimeAsync(WS_RECONNECT_BACKOFF_MS[attempt - 1]);
    }
    expect(FakeWebSocket.instances).toHaveLength(1 + WS_RECONNECT_MAX);
    expect(cb.onError).not.toHaveBeenCalled();

    lastSocket().serverClose(1006);

    expect(cb.onError).toHaveBeenCalledTimes(1);
    expect(cb.onError.mock.calls[0][0]).toBe('connection_lost');
    expect(cb.onReconnecting).toHaveBeenCalledTimes(WS_RECONNECT_MAX);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1 + WS_RECONNECT_MAX);
  });

  it('never reconnects after disconnect()', async () => {
    const { client, cb, socket } = startStream();

    // Captured before teardown so the guard itself is exercised, not just the
    // fact that disconnect() detaches the handler.
    const closeHandler = socket.onclose;
    client.disconnect();

    expect(socket.closeCalls).toBe(1);
    expect(socket.onclose).toBeNull();

    closeHandler?.({ code: 1006, reason: '', wasClean: false } as CloseEvent);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(cb.onReconnecting).not.toHaveBeenCalled();
    expect(cb.onError).not.toHaveBeenCalled();
  });

  it('cancels the pending reconnect timer when disconnect() lands mid-backoff', async () => {
    const { client, socket } = startStream();

    socket.serverClose(1006);
    client.disconnect();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('refreshes the token and retries after a 4001 close', async () => {
    const { cb, socket } = startStream();

    socket.serverSend({ type: 'error', payload: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
    socket.serverClose(4001);

    expect(attemptTokenRefresh).toHaveBeenCalledTimes(1);
    // UNAUTHORIZED is swallowed: the 4001 path owns the outcome, so the UI is
    // not flipped to "failed" for a session we are about to renew.
    expect(cb.onError).not.toHaveBeenCalled();
    expect(cb.onReconnecting).toHaveBeenCalledWith(1);

    await flush();
    await vi.advanceTimersByTimeAsync(500);

    expect(FakeWebSocket.instances).toHaveLength(2);
    const revived = lastSocket();
    revived.serverOpen();
    revived.serverSend({ type: 'auth_success' });
    expect(revived.frames()).toEqual([
      { type: 'resume', payload: { query_id: 'q-42', last_seq: 2 } },
    ]);
  });

  it('reports auth_expired when the refresh fails after a 4001 close', async () => {
    attemptTokenRefresh.mockResolvedValue(false);
    const { cb, socket } = startStream();

    socket.serverClose(4001);
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(cb.onError).toHaveBeenCalledTimes(1);
    expect(cb.onError.mock.calls[0][0]).toBe('auth_expired');
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('emits onStreamEnd and stops reconnecting once the stream completes', async () => {
    const { cb, socket } = startStream();

    socket.serverSend({ type: 'stream_end', seq: 3, payload: { query_id: 'q-42' } });
    expect(cb.onStreamEnd).toHaveBeenCalledTimes(1);

    socket.serverSend({
      type: 'complete',
      seq: 4,
      payload: {
        query_id: 'q-42',
        latency_ms: 842,
        model_used: 'qwen3:4b',
        token_count: 12,
        from_cache: false,
      },
    });
    socket.serverClose(1006);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(cb.onReconnecting).not.toHaveBeenCalled();
  });

  it('does not reconnect after a terminal stream error or a user cancel', async () => {
    const failed = startStream();
    failed.socket.serverSend({
      type: 'error',
      seq: 3,
      payload: { code: 'GENERATION_FAILED', message: 'The model timed out' },
    });
    failed.socket.serverClose(1006);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(failed.cb.onError).toHaveBeenCalledWith('GENERATION_FAILED', 'The model timed out');
    expect(FakeWebSocket.instances).toHaveLength(1);

    const stopped = startStream();
    stopped.client.cancel();
    expect(stopped.socket.frames().at(-1)).toEqual({ type: 'cancel', payload: {} });

    stopped.socket.serverClose(1006);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(stopped.cb.onReconnecting).not.toHaveBeenCalled();
  });
});
