import type { Source } from './types';
import { getStoredAccessToken } from './client';

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

    const token = getStoredAccessToken();
    if (!token) {
      this.callbacks.onError?.('auth_error', 'No authentication token available');
      return;
    }

    // Use the Vite proxy path — the dev server proxies /api to the backend
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/ws/query`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.isConnected = true;
      // First message: authenticate
      this.send({ type: 'auth', token });
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

  private handleMessage(data: WSMessageData): void {
    switch (data.type) {
      case 'auth_success':
        // Auth confirmed — now send the query
        this.send({
          type: 'query',
          workspace_id: this.workspaceId,
          query: this.query,
          ...(this.conversationId ? { conversation_id: this.conversationId } : {}),
        });
        break;

      case 'token':
        this.callbacks.onToken?.(data.content);
        break;

      case 'source': {
        const source: Source = {
          chunk_id: data.chunk_id,
          document_id: data.document_id,
          excerpt: data.excerpt,
          relevance_score: data.relevance_score ?? data.score ?? 0,
          document_name: data.document_name,
          rerank_score: data.rerank_score,
          page_number: data.page_number,
        };
        this.callbacks.onSource?.(source);
        break;
      }

      case 'guardrail':
        this.callbacks.onGuardrail?.({
          passed: data.passed,
          score: data.score,
          details: data.details,
        });
        break;

      case 'trust_score':
        this.callbacks.onTrustScore?.(data.score, data.components);
        break;

      case 'complete':
        this.callbacks.onComplete?.({
          query_id: data.query_id,
          latency_ms: data.latency_ms,
          model_used: data.model_used,
          token_count: data.token_count,
        });
        break;

      case 'error':
        this.callbacks.onError?.(data.code, data.message);
        break;

      case 'progress':
        this.callbacks.onProgress?.(data.phase, data.progress);
        break;

      default:
        // Unknown message type — silently ignore
        break;
    }
  }

  get connected(): boolean {
    return this.isConnected;
  }
}
