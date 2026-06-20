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

  private handleMessage(msg: WSMessageData): void {
    switch (msg.type) {
      case 'auth_success':
        // Auth confirmed — now send the query
        this.send({
          type: 'query',
          workspace_id: this.workspaceId,
          query: this.query,
          ...(this.conversationId ? { conversation_id: this.conversationId } : {}),
        });
        break;

      case 'token': {
        const d = msg as { type: 'token'; content: string };
        this.callbacks.onToken?.(d.content);
        break;
      }

      case 'source': {
        const d = msg as { type: 'source'; chunk_id: string; document_id: string; excerpt: string; score: number; document_name?: string; relevance_score?: number; rerank_score?: number; page_number?: number };
        const source: Source = {
          chunk_id: d.chunk_id,
          document_id: d.document_id,
          excerpt: d.excerpt,
          relevance_score: d.relevance_score ?? d.score ?? 0,
          document_name: d.document_name,
          rerank_score: d.rerank_score,
          page_number: d.page_number,
        };
        this.callbacks.onSource?.(source);
        break;
      }

      case 'guardrail': {
        const d = msg as { type: 'guardrail'; passed: boolean; score: number; details: string };
        this.callbacks.onGuardrail?.({
          passed: d.passed,
          score: d.score,
          details: d.details,
        });
        break;
      }

      case 'trust_score': {
        const d = msg as { type: 'trust_score'; score: number; components: Record<string, number> };
        this.callbacks.onTrustScore?.(d.score, d.components);
        break;
      }

      case 'complete': {
        const d = msg as { type: 'complete'; query_id: string; latency_ms: number; model_used: string; token_count: number };
        this.callbacks.onComplete?.({
          query_id: d.query_id,
          latency_ms: d.latency_ms,
          model_used: d.model_used,
          token_count: d.token_count,
        });
        break;
      }

      case 'error': {
        const d = msg as { type: 'error'; code: string; message: string };
        this.callbacks.onError?.(d.code, d.message);
        break;
      }

      case 'progress': {
        const d = msg as { type: 'progress'; phase: string; progress: number };
        this.callbacks.onProgress?.(d.phase, d.progress);
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
