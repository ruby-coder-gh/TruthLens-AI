import type { QueryEdgeCase, Source, SufficiencyVerdict } from './types';

/** Payload of the terminal `complete` frame. `edge_case`/`sufficiency` are
 *  present only when the evidence-sufficiency gate abstained (F7c); the cached
 *  replay path carries `edge_case` but not `sufficiency`. */
export interface QueryCompleteResult {
  query_id: string;
  latency_ms: number;
  model_used: string;
  token_count: number;
  from_cache: boolean;
  edge_case?: QueryEdgeCase | null;
  sufficiency?: SufficiencyVerdict | null;
}

export interface QueryWebSocketCallbacks {
  onToken?: (token: string) => void;
  onSource?: (source: Source) => void;
  onGuardrail?: (result: { passed: boolean; score: number; details: string }) => void;
  onTrustScore?: (score: number, components: Record<string, number>) => void;
  onComplete?: (result: QueryCompleteResult) => void;
  onError?: (code: string, message: string) => void;
  onProgress?: (phase: string, progress: number) => void;
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
  edge_case?: QueryEdgeCase | null;
  sufficiency?: SufficiencyVerdict | null;
  code?: string;
  message?: string;
  phase?: string;
  progress?: number;
}

/** Envelope for every message received over the query WebSocket. */
interface WSServerMessage {
  type: string;
  payload?: WSMessagePayload;
  content?: string;
}

export class QueryWebSocket {
  private ws: WebSocket | null = null;
  private workspaceId: string;
  private query: string;
  private conversationId?: string;
  private callbacks: QueryWebSocketCallbacks;
  private isConnected = false;
  private topK?: number;
  private forceRefresh: boolean;

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

    // Use the Vite proxy path — the dev server proxies /api to the backend
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/ws/query`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.isConnected = true;
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as WSServerMessage;
        this.handleMessage(data);
      } catch {
        // Non-JSON message, ignore
      }
    };

    this.ws.onerror = () => {
      this.callbacks.onError?.('connection_error', 'WebSocket connection error');
    };

    this.ws.onclose = () => {
      this.isConnected = false;
    };
  }

  disconnect(): void {
    if (this.ws) {
      this.isConnected = false;
      this.ws.onclose = null; // prevent reconnect logic if any
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
   */
  cancel(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: 'cancel', payload: {} });
      return;
    }
    this.disconnect();
  }

  private send(data: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private handleMessage(msg: WSServerMessage): void {
    const payload: WSMessagePayload = msg.payload ?? {};

    switch (msg.type) {
      case 'auth_success':
        // Auth confirmed — now send the query
        this.send({
          type: 'query',
          payload: {
            workspace_id: this.workspaceId,
            query: this.query,
            ...(this.conversationId ? { conversation_id: this.conversationId } : {}),
            ...(this.topK ? { top_k: this.topK } : {}),
            ...(this.forceRefresh ? { force_refresh: true } : {}),
          }
        });
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

      case 'complete': {
        this.callbacks.onComplete?.({
          query_id: payload.query_id ?? '',
          latency_ms: payload.latency_ms ?? 0,
          model_used: payload.model_used ?? '',
          token_count: payload.token_count ?? 0,
          from_cache: payload.from_cache ?? false,
          edge_case: payload.edge_case ?? null,
          sufficiency: payload.sufficiency ?? null,
        });
        break;
      }

      case 'error': {
        this.callbacks.onError?.(payload.code ?? 'error', payload.message ?? 'Unknown error');
        break;
      }

      case 'progress': {
        this.callbacks.onProgress?.(payload.phase ?? '', payload.progress ?? 0);
        break;
      }

      case 'ack': {
        // Query accepted, can track query_id here if needed
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
