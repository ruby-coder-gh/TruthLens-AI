import type { Source } from './types';

export interface QueryWebSocketCallbacks {
  onToken?: (token: string) => void;
  onSource?: (source: Source) => void;
  onGuardrail?: (result: { passed: boolean; score: number; details: string }) => void;
  onTrustScore?: (score: number, components: Record<string, number>) => void;
  onComplete?: (result: { query_id: string; latency_ms: number; model_used: string; token_count: number }) => void;
  onError?: (code: string, message: string) => void;
  onProgress?: (phase: string, progress: number) => void;
}

type WSMessageData =
  | { type: 'token'; content: string }
  | { type: 'source'; chunk_id: string; document_id: string; excerpt: string; score: number; document_name?: string; relevance_score?: number; rerank_score?: number; page_number?: number }
  | { type: 'guardrail'; passed: boolean; score: number; details: string }
  | { type: 'trust_score'; score: number; components: Record<string, number> }
  | { type: 'complete'; query_id: string; latency_ms: number; model_used: string; token_count: number }
  | { type: 'error'; code: string; message: string }
  | { type: 'progress'; phase: string; progress: number }
  | { type: string; [key: string]: unknown };

export class QueryWebSocket {
  private ws: WebSocket | null = null;
  private workspaceId: string;
  private query: string;
  private conversationId?: string;
  private callbacks: QueryWebSocketCallbacks;
  private isConnected = false;

  constructor(
    workspaceId: string,
    query: string,
    callbacks: QueryWebSocketCallbacks,
    conversationId?: string,
  ) {
    this.workspaceId = workspaceId;
    this.query = query;
    this.callbacks = callbacks;
    this.conversationId = conversationId;
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
        const data = JSON.parse(event.data) as WSMessageData;
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

  private send(data: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private handleMessage(msg: any): void {
    const payload = msg.payload || {};
    
    switch (msg.type) {
      case 'auth_success':
        // Auth confirmed — now send the query
        this.send({
          type: 'query',
          payload: {
            workspace_id: this.workspaceId,
            query: this.query,
            ...(this.conversationId ? { conversation_id: this.conversationId } : {}),
          }
        });
        break;

      case 'token': {
        this.callbacks.onToken?.(payload.content || payload.token || msg.content);
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
          passed: payload.passed,
          score: payload.score,
          details: payload.details,
        });
        break;
      }

      case 'trust_score': {
        this.callbacks.onTrustScore?.(payload.score, payload.components);
        break;
      }

      case 'complete': {
        this.callbacks.onComplete?.({
          query_id: payload.query_id,
          latency_ms: payload.latency_ms,
          model_used: payload.model_used,
          token_count: payload.token_count,
        });
        break;
      }

      case 'error': {
        this.callbacks.onError?.(payload.code || 'error', payload.message || 'Unknown error');
        break;
      }

      case 'progress': {
        this.callbacks.onProgress?.(payload.phase, payload.progress);
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
