import type { Source } from './types';
import { attemptTokenRefresh } from './client';

/**
 * Reconnect backoff schedule, in milliseconds — one entry per attempt.
 * Attempt N waits `WS_RECONNECT_BACKOFF_MS[N - 1]` before opening a new socket.
 */
export const WS_RECONNECT_BACKOFF_MS = [500, 1000, 2000, 4000] as const;

/** Reconnect attempts before the client gives up and reports `connection_lost`. */
export const WS_RECONNECT_MAX = WS_RECONNECT_BACKOFF_MS.length;

/** Close code the server uses when the connection failed authentication. */
const WS_AUTH_CLOSE_CODE = 4001;

export interface QueryWebSocketCallbacks {
  onToken?: (token: string) => void;
  onSource?: (source: Source) => void;
  onGuardrail?: (result: { passed: boolean; score: number; details: string }) => void;
  onTrustScore?: (score: number, components: Record<string, number>) => void;
  onComplete?: (result: { query_id: string; latency_ms: number; model_used: string; token_count: number; from_cache: boolean }) => void;
  onError?: (code: string, message: string) => void;
  onProgress?: (phase: string, progress: number) => void;
  /** The socket dropped mid-stream; attempt `attempt` of `WS_RECONNECT_MAX` is pending. */
  onReconnecting?: (attempt: number) => void;
  /** A reconnect succeeded and the stream is flowing again — clear any "reconnecting" UI. */
  onReconnected?: () => void;
  /** Generation finished emitting tokens (the `complete` frame still follows). */
  onStreamEnd?: () => void;
  /**
   * The buffered stream could not be resumed, so the query is being re-run from
   * scratch. Everything already rendered for this answer is stale and must be
   * discarded — consumers append tokens and sources, so skipping this would
   * concatenate the new answer onto the old partial one.
   */
  onStreamRestart?: () => void;
  /** The server accepted the query and minted `queryId` for it. */
  onAck?: (queryId: string) => void;
}

/** Raw source object as delivered inside a `sources` message payload. */
interface WSSourcePayload {
  chunk_id: string;
  document_id: string;
  excerpt: string;
  score?: number;
  relevance_score?: number;
  rerank_score?: number;
  document_name?: string;
  page_number?: number;
  confidence?: number;
  matched_chunks?: number;
  explanation?: string;
  updated_at?: string;
  file_type?: string;
}

/** Payload fields the server may attach to a message envelope. */
interface WSMessagePayload {
  content?: string;
  token?: string;
  sources?: WSSourcePayload[];
  passed?: boolean;
  score?: number;
  details?: string;
  components?: Record<string, number>;
  query_id?: string;
  latency_ms?: number;
  model_used?: string;
  token_count?: number;
  from_cache?: boolean;
  code?: string;
  message?: string;
  phase?: string;
  progress?: number;
  index?: number;
  /** `resumed` only — the `last_seq` the replay started from. */
  from_seq?: number;
  /** `resumed` only — how many buffered frames were replayed. */
  replayed?: number;
  /** `resumed` only — false when the stream had already finished before the replay. */
  live?: boolean;
}

/**
 * Envelope for every message received over the query WebSocket.
 *
 * `seq` sits at the top level, a sibling of `type`/`payload`. It is present on
 * every frame belonging to a query stream (monotonic, gapless, 1-based, scoped
 * to one `query_id`) and absent on connection-level frames (`auth_success`,
 * `resumed`, and errors raised outside a stream).
 */
interface WSServerMessage {
  type: string;
  seq?: number;
  payload?: WSMessagePayload;
  content?: string;
}

/**
 * Streaming client for `/api/ws/query`.
 *
 * Beyond the happy path it survives a mid-stream disconnect: the server buffers
 * every frame it emitted for a `query_id`, so on an unexpected close the client
 * reopens the socket on a backoff schedule and asks to `resume` from the last
 * `seq` it rendered. The server replays only what was missed, then sends a
 * `resumed` marker and keeps streaming live frames into the new socket.
 */
export class QueryWebSocket {
  private ws: WebSocket | null = null;
  private workspaceId: string;
  private query: string;
  private conversationId?: string;
  private callbacks: QueryWebSocketCallbacks;
  private isConnected = false;
  private topK?: number;
  private forceRefresh: boolean;

  // ─── Resume state ──────────────────────────────────────────────────────────
  /** Server-minted id of the stream in flight, learned from the `ack` frame. */
  private queryId: string | null = null;
  /** Highest `seq` already handed to the callbacks — the replay high-water mark. */
  private lastSeq = 0;
  /** True once `disconnect()`/`cancel()` ran: teardown must never reconnect. */
  private userInitiated = false;
  /** True once the stream reached a terminal state; nothing left to resume. */
  private finished = false;
  /** True once the server sent a terminal frame (`complete` or a fatal `error`). */
  private terminalSeen = false;
  /** True between a dropped socket and the reconnect being confirmed. */
  private reconnecting = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Guards the RESUME_UNAVAILABLE → re-send-query fallback against looping. */
  private resumeFallbackUsed = false;

  constructor(
    workspaceId: string,
    query: string,
    callbacks: QueryWebSocketCallbacks,
    conversationId?: string,
    topK?: number,
    forceRefresh = false,
  ) {
    this.workspaceId = workspaceId;
    this.query = query;
    this.callbacks = callbacks;
    this.conversationId = conversationId;
    this.topK = topK;
    this.forceRefresh = forceRefresh;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }
    this.openSocket();
  }

  private openSocket(): void {
    // Drop the previous socket's handlers first — a dying connection must not
    // be able to fire events into the state the new one is about to own.
    if (this.ws) {
      this.detachHandlers(this.ws);
    }

    // Use the Vite proxy path — the dev server proxies /api to the backend
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/ws/query`;

    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.isConnected = true;
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as WSServerMessage;
        this.handleMessage(data);
      } catch {
        // Non-JSON message, ignore
      }
    };

    // A transport `error` is always followed by `close` (WHATWG), and close is
    // where the reconnect decision lives. Reporting here too would flip the UI
    // to "failed" for a drop we are about to recover from.
    ws.onerror = () => {};

    ws.onclose = (event: CloseEvent) => {
      this.handleClose(event);
    };
  }

  disconnect(): void {
    // Set before anything else: a close event racing this teardown (or a timer
    // already queued) must see that the user asked to stop.
    this.userInitiated = true;
    this.clearReconnectTimer();

    if (this.ws) {
      this.isConnected = false;
      this.detachHandlers(this.ws);
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Ask the server to cancel the in-flight query.
   *
   * If the socket is already OPEN, sends a `cancel` frame so the server can stop
   * generation server-side. If the socket is still CONNECTING (or in any other
   * non-OPEN state), there's no way to deliver the frame — sending it would
   * silently no-op, and once the socket opens the server would keep streaming,
   * resurrecting a bubble the user already stopped. In that case we tear the
   * socket down the same way disconnect() does (null the handlers first so no
   * queued open/message/close event can fire against this instance) so no
   * further tokens can land. A new socket is always created on Retry, so this
   * instance is never reused either way.
   *
   * Either way the stream is over as far as this client is concerned, so a
   * subsequent close must not trigger a reconnect + resume.
   */
  cancel(): void {
    this.userInitiated = true;
    this.clearReconnectTimer();

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: 'cancel', payload: {} });
      return;
    }
    this.disconnect();
  }

  private detachHandlers(ws: WebSocket): void {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private send(data: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private sendQuery(): void {
    this.send({
      type: 'query',
      payload: {
        workspace_id: this.workspaceId,
        query: this.query,
        ...(this.conversationId ? { conversation_id: this.conversationId } : {}),
        ...(this.topK ? { top_k: this.topK } : {}),
        ...(this.forceRefresh ? { force_refresh: true } : {}),
      },
    });
  }

  // ─── Reconnect ─────────────────────────────────────────────────────────────

  private handleClose(event: CloseEvent): void {
    this.isConnected = false;

    // Nothing worth recovering: the user tore the socket down, or the stream
    // already reached `complete` / a terminal error.
    if (this.userInitiated || this.finished) return;

    if (this.reconnectAttempts >= WS_RECONNECT_MAX) {
      this.finished = true;
      this.callbacks.onError?.(
        'connection_lost',
        `Lost connection to the server and could not reconnect after ${WS_RECONNECT_MAX} attempts.`,
      );
      return;
    }

    this.reconnectAttempts += 1;
    this.reconnecting = true;
    const attempt = this.reconnectAttempts;
    const delay = WS_RECONNECT_BACKOFF_MS[attempt - 1];
    this.callbacks.onReconnecting?.(attempt);

    // 4001 means the cookie/token was rejected. Reopening with the same
    // credentials would just fail again, so renew them first.
    if (event.code === WS_AUTH_CLOSE_CODE) {
      void this.refreshThenReconnect(delay);
      return;
    }

    this.scheduleReconnect(delay);
  }

  private async refreshThenReconnect(delay: number): Promise<void> {
    const refreshed = await attemptTokenRefresh();
    if (this.userInitiated || this.finished) return;

    if (!refreshed) {
      this.finished = true;
      this.callbacks.onError?.('auth_expired', 'Your session expired. Please sign in again.');
      return;
    }
    this.scheduleReconnect(delay);
  }

  private scheduleReconnect(delay: number): void {
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.userInitiated || this.finished) return;
      this.openSocket();
    }, delay);
  }

  /** A reconnected socket picked the stream back up (`resumed`, or a fresh `ack`). */
  private markReconnected(): void {
    if (!this.reconnecting) return;
    this.reconnecting = false;
    this.reconnectAttempts = 0;
    // The budgets are per drop episode: a stream that recovered gets a full
    // set of retries, and a fresh fallback, if it drops again later.
    this.resumeFallbackUsed = false;
    this.callbacks.onReconnected?.();
  }

  /**
   * The server no longer holds a buffer for our `query_id` (expired, swept,
   * cancelled, or over the frame cap). Re-run the query from scratch — once.
   * The re-run mints a new `query_id` and a new `seq` run starting at 1, so the
   * stale ids are dropped first.
   */
  private handleResumeUnavailable(payload: WSMessagePayload): void {
    if (this.resumeFallbackUsed) {
      this.finished = true;
      this.callbacks.onError?.(
        'RESUME_UNAVAILABLE',
        payload.message ?? 'This answer is no longer available. Please ask again.',
      );
      return;
    }

    this.resumeFallbackUsed = true;
    this.queryId = null;
    this.lastSeq = 0;
    // Must precede the re-send: the answer already on screen belongs to a
    // stream that no longer exists, and the re-run replays it from the top.
    this.callbacks.onStreamRestart?.();
    this.sendQuery();
  }

  // ─── Inbound frames ────────────────────────────────────────────────────────

  private handleMessage(msg: WSServerMessage): void {
    const payload: WSMessagePayload = msg.payload ?? {};

    // Track the replay high-water mark. Only stream frames carry `seq`;
    // connection-level frames (`auth_success`, `resumed`, `cancel_ack`,
    // pre-stream errors) carry none and must not move it.
    if (typeof msg.seq === 'number') {
      // The server replays `seq > last_seq`, but an overlapping replay must
      // never double-append tokens or sources. `ack` is exempt because it only
      // records the (idempotent) query id.
      if (msg.seq <= this.lastSeq && msg.type !== 'ack') return;
      this.lastSeq = Math.max(this.lastSeq, msg.seq);
    }

    switch (msg.type) {
      case 'auth_success':
        if (this.reconnecting && this.queryId) {
          // Pick up where the dropped socket left off instead of re-running.
          this.send({
            type: 'resume',
            payload: { query_id: this.queryId, last_seq: this.lastSeq },
          });
        } else {
          this.sendQuery();
        }
        break;

      case 'token': {
        this.callbacks.onToken?.(payload.content ?? payload.token ?? msg.content ?? '');
        break;
      }

      case 'sources': {
        if (Array.isArray(payload.sources)) {
          for (const s of payload.sources) {
            const source: Source = {
              chunk_id: s.chunk_id,
              document_id: s.document_id,
              excerpt: s.excerpt,
              relevance_score: s.relevance_score ?? s.score ?? 0,
              document_name: s.document_name,
              rerank_score: s.rerank_score,
              page_number: s.page_number,
              confidence: s.confidence,
              matched_chunks: s.matched_chunks ?? 1,
              explanation: s.explanation,
              updated_at: s.updated_at,
              file_type: s.file_type,
            };
            this.callbacks.onSource?.(source);
          }
        }
        break;
      }

      case 'guardrail': {
        this.callbacks.onGuardrail?.({
          passed: payload.passed ?? false,
          score: payload.score ?? 0,
          details: payload.details ?? '',
        });
        break;
      }

      case 'trust_score': {
        this.callbacks.onTrustScore?.(payload.score ?? 0, payload.components ?? {});
        break;
      }

      case 'stream_end': {
        this.callbacks.onStreamEnd?.();
        break;
      }

      case 'complete': {
        this.finished = true;
        this.terminalSeen = true;
        this.callbacks.onComplete?.({
          query_id: payload.query_id ?? '',
          latency_ms: payload.latency_ms ?? 0,
          model_used: payload.model_used ?? '',
          token_count: payload.token_count ?? 0,
          from_cache: payload.from_cache ?? false,
        });
        break;
      }

      case 'error': {
        const code = payload.code ?? 'error';

        if (code === 'RESUME_UNAVAILABLE') {
          this.handleResumeUnavailable(payload);
          break;
        }

        // The server closes with 4001 straight after this frame; that handler
        // renews the session and retries, so don't fail the query here.
        if (code === 'UNAUTHORIZED') break;

        this.finished = true;
        this.terminalSeen = true;
        this.callbacks.onError?.(code, payload.message ?? 'Unknown error');
        break;
      }

      case 'progress': {
        this.callbacks.onProgress?.(payload.phase ?? '', payload.progress ?? 0);
        break;
      }

      case 'ack': {
        // The server mints the query id; remember it so a dropped socket can
        // ask to resume this exact stream.
        if (payload.query_id) {
          this.queryId = payload.query_id;
          this.callbacks.onAck?.(payload.query_id);
        }
        this.markReconnected();
        break;
      }

      case 'resumed': {
        // Sent *after* the replayed frames — the "replay flushed" marker.
        const exhausted = payload.live === false;
        if (exhausted) {
          this.finished = true;
        }
        this.markReconnected();
        // The buffer was already done and the replay carried no `complete` or
        // fatal `error`. Nothing further will arrive for this query_id, so say
        // so explicitly — otherwise the consumer waits on a stream forever.
        if (exhausted && !this.terminalSeen) {
          this.callbacks.onError?.('stream_ended', 'Stream ended without completion');
        }
        break;
      }

      default:
        // Unknown message type — silently ignore
        break;
    }
  }

  get connected(): boolean {
    return this.isConnected;
  }
}
