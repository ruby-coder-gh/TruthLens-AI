// Chat, redesigned as a Claim Ledger (Lane D1, design direction C). See
// .superpowers/sdd/deep-spinning-sparkle/artifacts/ui-prototypes/chat-redesign/c-claim-ledger.html
// for the visual/interaction spec this file ports into React + Tailwind v4.
//
// The chat-local header (old "VeritasRAG" title + "Chat active" pill +
// Sources button + panel toggle) is gone — the top bar is now D2's Layout.
// Every claim's evidence now lives inline in the
// Claim Ledger; every source lives in the Exhibits list below it.
import { useState, useRef, useEffect, useCallback, useMemo, memo, type FormEvent, type KeyboardEvent } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import {
  Send,
  Square,
  Copy,
  ThumbsUp,
  ThumbsDown,
  Clock,
  Brain,
  AlertCircle,
  RotateCcw,
  Download,
  RefreshCw,
  ChevronDown,
  FileText,
  Rows3,
  AlignLeft,
} from 'lucide-react';
import { Badge } from '../components/ui';
import { useToast } from '../components/toast-context';
import { useAuth } from '../context/auth-context';
import { feedbackApi, queryApi, radarApi, workspaceApi } from '../api/client';
import { QueryWebSocket, WS_RECONNECT_MAX } from '../api/websocket';
import type { QueryCompleteResult, QueryProgressDetail } from '../api/websocket';
import type { Claim, Contradiction, QueryEdgeCase, Source, SufficiencyVerdict, Workspace } from '../api/types';
import AbstentionCard from '../components/AbstentionCard';
import { SealReceiptButton } from '../components/SealReceiptButton';
import { SuggestedQuestions } from '../components/SuggestedQuestions';
import { downloadBlob } from '../utils/download';
import { AuditTrail, type AuditPhase } from '../components/ledger/AuditTrail';
import { ClaimLedger, flashRows } from '../components/ledger/ClaimLedger';
import { ProseAnswer } from '../components/ledger/ProseAnswer';
import { Exhibits } from '../components/ledger/Exhibits';
import { TrustTotals } from '../components/ledger/TrustTotals';
import { VERDICT_META, tallyClaims } from '../components/ledger/verdict';
import { useAnswerView } from '../components/ledger/useAnswerView';
import { citedSourceIndices } from '../components/ledger/citedSources';
import { pairClaimConflicts } from '../components/ledger/conflicts';

// ─── Constants ───────────────────────────────────────────────────────────────

const EXAMPLE_QUESTIONS = [
  'What are the key findings in my documents?',
  'Summarise the main topics',
  'Show me the important data points',
];

const MAX_TEXTAREA_ROWS = 6;

const ERROR_TITLES: Record<string, string> = {
  connection_error: 'Connection lost',
  connection_lost: 'Connection lost',
  auth_error: 'Authentication error',
  auth_expired: 'Session expired',
  RESUME_UNAVAILABLE: 'Answer no longer available',
  stream_ended: 'Answer incomplete',
};

const CONNECTION_ERROR_CODES = new Set(['connection_error', 'connection_lost']);

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  sources: Source[];
  trustScore: number | null;
  trustComponents: Record<string, number>;
  latencyMs: number | null;
  modelUsed: string | null;
  tokenCount: number | null;
  servedFromCache: boolean;
  queryId: string | null;
  error: { code: string; message: string } | null;
  status: 'pending' | 'streaming' | 'complete' | 'error' | 'cancelled';
  claims: Claim[] | null;
  reconnectAttempt: number | null;
  edgeCase?: QueryEdgeCase | null;
  sufficiency?: SufficiencyVerdict | null;
  // Audit trail (Claim Ledger) — driven by WS `progress` frames.
  phase: AuditPhase | null;
  foundCount: number | null;
  keptCount: number | null;
  wordsCount: number | null;
  startedAt: number | null;
}

interface StartQueryOptions {
  topK?: number;
  forceRefresh?: boolean;
  replaceAssistantId?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function liveWordCount(content: string): number {
  const trimmed = content.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function initials(name: string | undefined): string {
  if (!name) return '?';
  return name.slice(0, 2).toUpperCase();
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN PAGE COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

// Sidebar "New chat" links to this same route (/workspaces/:id/chat), so a
// click there doesn't change the path — `location.key` is React Router's
// only signal that "the user navigated here again". Keying the real page
// component on it makes React unmount + remount the whole subtree (every
// hook, every ref, the live WebSocket) on that signal, which is the
// documented way to reset all of a component's state on a prop/key change —
// simpler and safer than hand-resetting each piece of state individually.
// Also fires (correctly) when switching workspaces, since the route element
// is shared and only its :id param changes.
export default function ChatPage() {
  const location = useLocation();
  return <ChatPageForConversation key={location.key} />;
}

function ChatPageForConversation() {
  const { id: workspaceId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { user } = useAuth();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const streamingMsgIdRef = useRef<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [contradictions, setContradictions] = useState<Contradiction[]>([]);

  const wsRef = useRef<QueryWebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputKeyRef = useRef(0);
  const [inputKey, setInputKey] = useState(0);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    return () => {
      wsRef.current?.disconnect();
      wsRef.current = null;
    };
  }, []);

  // Workspace metadata (doc count for the audit trail + composer scope chip)
  // and open Radar contradictions (Claim Ledger conflict pairing) — each
  // fetched once per workspace. Best-effort: a failed fetch just means no
  // conflict rows / no doc count, never a broken chat.
  useEffect(() => {
    if (!workspaceId) return undefined;
    let cancelled = false;
    workspaceApi.get(workspaceId).then((ws) => { if (!cancelled) setWorkspace(ws); }).catch(() => {});
    radarApi.get(workspaceId, 'open').then((r) => { if (!cancelled) setContradictions(r.contradictions); }).catch(() => {});
    return () => { cancelled = true; };
  }, [workspaceId]);

  const genId = useCallback(() => crypto.randomUUID(), []);

  // ─── Start query via WebSocket ─────────────────────────────────────────────
  const startQuery = useCallback(
    (queryText: string, options: StartQueryOptions = {}) => {
      const { topK, forceRefresh = false, replaceAssistantId } = options;
      if (!workspaceId || !queryText.trim() || isStreaming) return;

      wsRef.current?.disconnect();

      let convId = conversationId;
      if (!convId) {
        convId = genId();
        setConversationId(convId);
      }

      const userMsgId = genId();
      const assistantMsgId = genId();

      const userMsg: ChatMessage = {
        id: userMsgId,
        role: 'user',
        content: queryText.trim(),
        timestamp: new Date().toISOString(),
        sources: [],
        trustScore: null,
        trustComponents: {},
        latencyMs: null,
        modelUsed: null,
        tokenCount: null,
        servedFromCache: false,
        queryId: null,
        error: null,
        status: 'complete',
        reconnectAttempt: null,
        claims: null,
        phase: null,
        foundCount: null,
        keptCount: null,
        wordsCount: null,
        startedAt: null,
      };

      const assistantMsg: ChatMessage = {
        ...userMsg,
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        status: 'pending',
        startedAt: Date.now(),
      };

      setMessages((prev) => {
        if (replaceAssistantId) {
          const idx = prev.findIndex((m) => m.id === replaceAssistantId);
          if (idx !== -1) {
            const next = prev.slice();
            next[idx] = assistantMsg;
            return next;
          }
        }
        return [...prev, userMsg, assistantMsg];
      });
      streamingMsgIdRef.current = assistantMsgId;
      setIsStreaming(true);

      inputKeyRef.current += 1;
      setInputKey(inputKeyRef.current);

      const ws = new QueryWebSocket(workspaceId, queryText.trim(), {
        onToken: (token: string) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsgId ? { ...m, content: m.content + token, status: 'streaming' as const } : m)),
          );
        },

        onSource: (source: Source) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsgId ? { ...m, sources: [...m.sources, source] } : m)),
          );
        },

        onGuardrail: (result: { claims: Claim[] }) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsgId ? { ...m, claims: result.claims } : m)),
          );
        },

        onTrustScore: (score: number, components: Record<string, number>) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsgId ? { ...m, trustScore: score, trustComponents: components } : m)),
          );
        },

        onComplete: (result: QueryCompleteResult) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    status: 'complete' as const,
                    reconnectAttempt: null,
                    queryId: result.query_id || m.queryId,
                    latencyMs: result.latency_ms,
                    modelUsed: result.model_used,
                    tokenCount: result.token_count,
                    servedFromCache: result.from_cache,
                    edgeCase: result.edge_case ?? null,
                    sufficiency: result.sufficiency ?? null,
                  }
                : m,
            ),
          );
          setIsStreaming(false);
          streamingMsgIdRef.current = null;
          // The sidebar's "Recent" list (Layout.tsx) reads
          // ['queries', 'recent', pathname] — a bare ['queries', 'recent']
          // invalidation matches every pathname suffix, so this chat's new
          // question shows up there without waiting for a refetch interval.
          void queryClient.invalidateQueries({ queryKey: ['queries', 'recent'] });
        },

        onError: (code: string, message: string) => {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantMsgId) return m;
              if (code === 'CANCELLED' || m.status === 'cancelled') {
                return { ...m, status: 'cancelled' as const, reconnectAttempt: null };
              }
              return { ...m, status: 'error' as const, error: { code, message }, reconnectAttempt: null };
            }),
          );
          setIsStreaming(false);
          streamingMsgIdRef.current = null;
        },

        onProgress: (phase: string, _progress: number, detail: QueryProgressDetail) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    phase: phase as AuditPhase,
                    foundCount: detail.found ?? m.foundCount,
                    keptCount: detail.kept ?? m.keptCount,
                    wordsCount: detail.words ?? m.wordsCount,
                  }
                : m,
            ),
          );
        },

        onReconnecting: (attempt: number) => {
          setMessages((prev) => prev.map((m) => (m.id === assistantMsgId ? { ...m, reconnectAttempt: attempt } : m)));
        },

        onReconnected: () => {
          setMessages((prev) => prev.map((m) => (m.id === assistantMsgId ? { ...m, reconnectAttempt: null } : m)));
        },

        onAck: (ackQueryId: string) => {
          setMessages((prev) => prev.map((m) => (m.id === assistantMsgId ? { ...m, queryId: ackQueryId } : m)));
        },

        onStreamRestart: () => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: '', sources: [], claims: null, trustScore: null, trustComponents: {}, servedFromCache: false, queryId: null, error: null, phase: null, foundCount: null, keptCount: null, wordsCount: null }
                : m,
            ),
          );
        },
      }, convId, topK, forceRefresh);

      wsRef.current = ws;
      ws.connect();
    },
    [workspaceId, conversationId, genId, isStreaming, queryClient],
  );

  const lastUserQuestion = useCallback(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user' && messages[i].content.trim()) return messages[i].content.trim();
    }
    return '';
  }, [messages]);

  const handleRephrase = useCallback(() => {
    const last = lastUserQuestion();
    if (last) setInputValue(last);
    textareaRef.current?.focus();
  }, [lastUserQuestion]);

  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      const text = inputValue.trim();
      if (!text || isStreaming) return;
      setInputValue('');
      startQuery(text);
    },
    [inputValue, isStreaming, startQuery],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleStop = useCallback(() => {
    const targetId = streamingMsgIdRef.current;
    wsRef.current?.cancel();
    if (targetId) {
      setMessages((prev) => prev.map((m) => (m.id === targetId ? { ...m, status: 'cancelled' as const } : m)));
    }
    setIsStreaming(false);
    streamingMsgIdRef.current = null;
  }, []);

  const handleRetry = useCallback(
    (assistantMsgId: string) => {
      const idx = messages.findIndex((m) => m.id === assistantMsgId);
      if (idx <= 0) return;
      const precedingUser = [...messages.slice(0, idx)].reverse().find((m) => m.role === 'user');
      if (!precedingUser) return;
      startQuery(precedingUser.content, { replaceAssistantId: assistantMsgId });
    },
    [messages, startQuery],
  );

  const handleRegenerate = useCallback(
    (assistantMsgId: string) => {
      const idx = messages.findIndex((m) => m.id === assistantMsgId);
      if (idx <= 0 || isStreaming) return;
      const precedingUser = [...messages.slice(0, idx)].reverse().find((m) => m.role === 'user');
      if (!precedingUser) return;
      startQuery(precedingUser.content, { forceRefresh: true });
    },
    [isStreaming, messages, startQuery],
  );

  const handleCopy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        addToast('Copied to clipboard', 'success');
      } catch {
        addToast('Failed to copy', 'error');
      }
    },
    [addToast],
  );

  const handleExport = useCallback(
    async (queryId: string) => {
      try {
        const { blob, filename } = await queryApi.exportMarkdown(queryId);
        downloadBlob(blob, filename);
      } catch {
        addToast('Failed to export', 'error');
      }
    },
    [addToast],
  );

  const feedbackMutation = useMutation({
    mutationFn: ({ queryId, rating }: { queryId: string; rating: number }) => feedbackApi.submit(queryId, { rating }),
    onSuccess: () => addToast('Feedback submitted', 'success'),
    onError: () => addToast('Failed to submit feedback', 'error'),
  });

  return (
    <div className="-m-4 flex h-full flex-col lg:-m-6">
      <div className="min-h-0 flex-1 overflow-y-auto" id="chat-scroll">
        <div className="mx-auto max-w-[880px] px-4 py-8 sm:px-6">
          {messages.length === 0 ? (
            <EmptyChatState workspaceId={workspaceId} workspace={workspace} onPick={(q) => startQuery(q)} />
          ) : (
            <div className="space-y-10">
              <AnimatePresence initial={false}>
                {messages.map((msg) =>
                  msg.role === 'user' ? (
                    <UserTurn key={msg.id} message={msg} username={user?.username} />
                  ) : (
                    <AnswerTurn
                      key={msg.id}
                      message={msg}
                      workspaceId={workspaceId}
                      documentCount={workspace?.document_count ?? null}
                      contradictions={contradictions}
                      onCopy={handleCopy}
                      onExport={() => msg.queryId && handleExport(msg.queryId)}
                      onFeedback={(rating) => msg.queryId && feedbackMutation.mutate({ queryId: msg.queryId, rating })}
                      onRetry={() => handleRetry(msg.id)}
                      onRegenerate={() => handleRegenerate(msg.id)}
                      onRephrase={handleRephrase}
                    />
                  ),
                )}
              </AnimatePresence>
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* ─── Composer ────────────────────────────────────────────────────── */}
      <div className="flex-none px-4 pb-4 pt-2 sm:px-6">
        <form onSubmit={handleSubmit} className="mx-auto max-w-[832px] rounded-panel border border-border-strong bg-solid shadow-e1 transition-colors focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--color-primary-tint)]">
          <label htmlFor="ask" className="sr-only">Ask a question about this workspace</label>
          <textarea
            key={inputKey}
            id="ask"
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, MAX_TEXTAREA_ROWS * 1.5 * 16)}px`;
            }}
            onKeyDown={handleKeyDown}
            placeholder={`Ask about the ${workspace?.name ?? 'workspace'} documents`}
            disabled={isStreaming}
            rows={1}
            className="block w-full resize-none border-0 bg-transparent px-4 pb-1 pt-3.5 text-sm text-text placeholder-text-dim focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />
          <div className="flex items-center gap-2 px-2 pb-2 pt-1">
            <button
              type="button"
              onClick={() => addToast('Choose which documents to search', 'info')}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-control px-2 text-xs font-medium text-text-muted hover:bg-card-2 hover:text-text [@media(pointer:coarse)]:min-h-11"
            >
              <FileText size={14} aria-hidden="true" />
              {workspace ? `All ${workspace.document_count} document${workspace.document_count === 1 ? '' : 's'}` : 'All documents'}
              <ChevronDown size={13} aria-hidden="true" />
            </button>
            <span className="ml-auto hidden text-[11px] text-text-dim sm:inline">Enter to send, Shift + Enter for a new line</span>
            {isStreaming ? (
              <button
                type="button"
                onClick={handleStop}
                aria-label="Stop generating"
                title="Stop generating"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-red/40 bg-card-2 text-text-muted transition-colors hover:border-red/60 hover:bg-red/12 hover:text-red [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
              >
                <Square size={15} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!inputValue.trim()}
                aria-label="Send question"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-primary text-on-primary transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-card-2 disabled:text-text-dim [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
              >
                <Send size={16} />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  EMPTY STATE
// ═══════════════════════════════════════════════════════════════════════════

const EmptyChatState = memo(function EmptyChatState({
  workspaceId,
  workspace,
  onPick,
}: {
  workspaceId?: string;
  workspace: Workspace | null;
  onPick: (q: string) => void;
}) {
  return (
    <div className="py-8 sm:py-16">
      <h2 className="text-[26px] font-semibold leading-9 tracking-tight text-text">What would you like to verify?</h2>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-6 text-text-muted">
        {workspace
          ? `Answers draw only on the ${workspace.document_count} document${workspace.document_count === 1 ? '' : 's'} in ${workspace.name}. Every claim is checked against the passage it cites before you see it.`
          : 'Every claim is checked against the passage it cites before you see it.'}
      </p>
      {workspaceId && (
        <div className="mt-10">
          <h3 className="text-[13px] font-medium text-text-dim">Suggested for this workspace</h3>
          <div className="mt-2">
            <SuggestedQuestions workspaceId={workspaceId} onPick={onPick} fallback={EXAMPLE_QUESTIONS} />
          </div>
        </div>
      )}
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════
//  USER TURN — the question, document-heading style (not a chat bubble)
// ═══════════════════════════════════════════════════════════════════════════

const UserTurn = memo(function UserTurn({ message, username }: { message: ChatMessage; username?: string }) {
  return (
    <motion.div
      className="flex items-start gap-3"
      initial={{ opacity: 0.99, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/12 font-mono text-xs font-semibold text-primary-soft" aria-hidden="true">
        {initials(username)}
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="text-xs text-text-dim"><span className="sr-only">Question from </span>{username ?? 'You'}, {formatTimestamp(message.timestamp)}</p>
        <h2 className="mt-0.5 text-xl font-semibold leading-7 tracking-tight text-text">{message.content}</h2>
      </div>
    </motion.div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════
//  ANSWER TURN
// ═══════════════════════════════════════════════════════════════════════════

const AnswerTurn = memo(function AnswerTurn({
  message,
  workspaceId,
  documentCount,
  contradictions,
  onCopy,
  onExport,
  onFeedback,
  onRetry,
  onRegenerate,
  onRephrase,
}: {
  message: ChatMessage;
  workspaceId?: string;
  documentCount: number | null;
  contradictions: Contradiction[];
  onCopy: (text: string) => void;
  onExport: () => void;
  onFeedback: (rating: number) => void;
  onRetry: () => void;
  onRegenerate: () => void;
  onRephrase?: () => void;
}) {
  const [view, setView] = useAnswerView();
  const isAbstained = message.edgeCase === 'insufficient_evidence';
  const isComplete = message.status === 'complete' && !isAbstained;
  const isError = message.status === 'error';
  const isCancelled = message.status === 'cancelled';
  const isRunning = message.status === 'pending' || message.status === 'streaming';
  const claims = useMemo(() => message.claims ?? [], [message.claims]);
  const hasClaims = claims.length > 0;
  const tally = useMemo(() => (hasClaims ? tallyClaims(claims) : null), [hasClaims, claims]);
  const conflictPairs = useMemo(() => (hasClaims ? pairClaimConflicts(claims, contradictions) : []), [hasClaims, claims, contradictions]);
  const allDocNames = useMemo(() => message.sources.map((s) => s.document_name).filter((n): n is string => Boolean(n)), [message.sources]);
  const cited = useMemo(() => citedSourceIndices(message.content, message.claims), [message.content, message.claims]);

  const showAuditTrail = !isAbstained && !(isError);

  return (
    <motion.div
      className="space-y-5"
      role="log"
      aria-live="polite"
      aria-atomic="false"
      aria-busy={isRunning}
      initial={{ opacity: 0.99, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0.05 }}
    >
      {isRunning && message.reconnectAttempt !== null && (
        <div role="status" aria-label={`Reconnecting, attempt ${message.reconnectAttempt} of ${WS_RECONNECT_MAX}`} className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/15 px-2.5 py-1 text-[11px] font-medium text-gold">
          <RefreshCw size={11} className="animate-spin" aria-hidden="true" />
          {`Reconnecting… (${message.reconnectAttempt}/${WS_RECONNECT_MAX})`}
        </div>
      )}

      {showAuditTrail && (
        <AuditTrail
          running={isRunning}
          stopped={isCancelled}
          phase={message.phase}
          foundCount={message.foundCount}
          keptCount={message.keptCount}
          wordsCount={message.wordsCount}
          liveWordCount={liveWordCount(message.content)}
          documentsSearched={documentCount}
          claimsTally={tally}
          modelUsed={message.modelUsed}
          startedAt={message.startedAt}
          latencyMs={message.status === 'complete' ? message.latencyMs : null}
        />
      )}

      {message.status === 'pending' && (
        <div className="space-y-2.5" aria-hidden="true">
          <div className="h-3.5 w-[92%] animate-pulse rounded bg-card-2" />
          <div className="h-3.5 w-[80%] animate-pulse rounded bg-card-2" />
          <div className="h-3.5 w-[55%] animate-pulse rounded bg-card-2" />
        </div>
      )}

      {message.status === 'streaming' && (
        <ProseAnswer content={message.content} sources={message.sources} workspaceId={workspaceId} streaming />
      )}

      {isCancelled && (
        <>
          {message.content && <ProseAnswer content={message.content} sources={message.sources} workspaceId={workspaceId} />}
          <div className="flex items-center justify-between">
            <Badge color="gray" className="gap-1">
              <Square size={9} fill="currentColor" />
              Stopped
            </Badge>
            <RetryButton onClick={onRetry} />
          </div>
        </>
      )}

      {isAbstained && message.status === 'complete' && (
        <AbstentionCard answer={message.content} sufficiency={message.sufficiency} workspaceId={workspaceId} onRephrase={onRephrase} />
      )}

      {isComplete && message.content && (
        <>
          {hasClaims && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex gap-0.5 rounded-control border border-border bg-card-2 p-0.5">
                <button
                  type="button"
                  onClick={() => setView('ledger')}
                  aria-pressed={view === 'ledger'}
                  className={clsx('inline-flex min-h-8 items-center gap-1.5 rounded px-2.5 text-sm font-medium [@media(pointer:coarse)]:min-h-11', view === 'ledger' ? 'bg-solid text-text shadow-e1' : 'text-text-muted hover:text-text')}
                >
                  <Rows3 size={14} aria-hidden="true" />
                  Claim ledger
                </button>
                <button
                  type="button"
                  onClick={() => setView('prose')}
                  aria-pressed={view === 'prose'}
                  className={clsx('inline-flex min-h-8 items-center gap-1.5 rounded px-2.5 text-sm font-medium [@media(pointer:coarse)]:min-h-11', view === 'prose' ? 'bg-solid text-text shadow-e1' : 'text-text-muted hover:text-text')}
                >
                  <AlignLeft size={14} aria-hidden="true" />
                  Read as prose
                </button>
              </div>
              <div className="flex flex-wrap gap-0.5" role="group" aria-label="Claim summary">
                {tally && tally.supported > 0 && (
                  <TallyChip verdict="supported" count={tally.supported} label="verified" onClick={() => { setView('ledger'); flashRows(claims.map((c, i) => c.verdict === 'supported' ? `row-C${i + 1}` : null).filter((v): v is string => Boolean(v))); }} />
                )}
                {tally && tally.partial > 0 && (
                  <TallyChip verdict="partial" count={tally.partial} label="partial" onClick={() => { setView('ledger'); flashRows(claims.map((c, i) => c.verdict === 'partial' ? `row-C${i + 1}` : null).filter((v): v is string => Boolean(v))); }} />
                )}
                {tally && tally.unsupported > 0 && (
                  <TallyChip verdict="unsupported" count={tally.unsupported} label="unsupported" onClick={() => { setView('ledger'); flashRows(claims.map((c, i) => c.verdict === 'unsupported' ? `row-C${i + 1}` : null).filter((v): v is string => Boolean(v))); }} />
                )}
                {tally && tally.contradicted > 0 && (
                  <TallyChip verdict="contradicted" count={tally.contradicted} label="contradicted" onClick={() => { setView('ledger'); flashRows(claims.map((c, i) => c.verdict === 'contradicted' ? `row-C${i + 1}` : null).filter((v): v is string => Boolean(v))); }} />
                )}
                {conflictPairs.length > 0 && (
                  <TallyChip verdict="conflict" count={conflictPairs.length} label="conflict" onClick={() => { setView('ledger'); flashRows([`row-C${conflictPairs[0].claimAIndex + 1}`]); }} />
                )}
              </div>
            </div>
          )}

          {hasClaims && view === 'ledger' ? (
            <ClaimLedger claims={claims} sources={message.sources} allDocNames={allDocNames} contradictions={contradictions} workspaceId={workspaceId} />
          ) : (
            <ProseAnswer content={message.content} sources={message.sources} claims={hasClaims ? claims : null} workspaceId={workspaceId} />
          )}

          {message.sources.length > 0 && (
            <Exhibits sources={message.sources} citedIndices={cited} allDocNames={allDocNames} workspaceId={workspaceId} />
          )}

          {message.trustScore !== null && <TrustTotals score={message.trustScore} components={message.trustComponents} />}

          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {message.queryId && <SealReceiptButton queryId={message.queryId} />}
            <ActionIconButton icon={Copy} label="Copy response" onClick={() => onCopy(message.content)} />
            {message.queryId && (
              <>
                <ActionIconButton icon={Download} label="Export as Markdown" onClick={onExport} />
                <ActionIconButton icon={ThumbsUp} label="Good answer" onClick={() => onFeedback(5)} hoverClass="hover:text-green" />
                <ActionIconButton icon={ThumbsDown} label="Bad answer" onClick={() => onFeedback(1)} hoverClass="hover:text-red" />
              </>
            )}
            {message.servedFromCache && <ActionIconButton icon={RotateCcw} label="Regenerate with fresh retrieval" onClick={onRegenerate} />}
            <span className="ml-auto flex flex-wrap items-center gap-3 text-xs text-text-dim">
              {message.servedFromCache && (
                <span className="inline-flex items-center gap-1" title="Served from a valid cached result. Regenerate to run retrieval and generation again.">
                  <Clock size={11} aria-hidden="true" /> Cached
                </span>
              )}
              {message.modelUsed && (
                <span className="inline-flex items-center gap-1">
                  <Brain size={12} aria-hidden="true" /> {message.modelUsed}
                </span>
              )}
              {message.latencyMs !== null && <span>{formatLatency(message.latencyMs)}</span>}
            </span>
          </div>
        </>
      )}

      {isError && message.error && (
        <div className="flex items-start gap-3 rounded-control border border-red/35 bg-red/12 p-3 shadow-[inset_3px_0_0_var(--color-trust-low)]" role="alert">
          <AlertCircle size={18} className="mt-0.5 shrink-0 text-red" />
          <div className="flex-1 text-sm">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-red">{ERROR_TITLES[message.error.code] ?? 'Query failed'}</p>
              <RetryButton onClick={onRetry} />
            </div>
            <p className="mt-0.5 text-text-muted">{message.error.message}</p>
            {CONNECTION_ERROR_CODES.has(message.error.code) && (
              <p className="mt-1 text-xs text-text-dim">Try reconnecting or starting a new conversation.</p>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
});

function TallyChip({ verdict, count, label, onClick }: { verdict: keyof typeof VERDICT_META; count: number; label: string; onClick: () => void }) {
  const meta = VERDICT_META[verdict];
  const Icon = meta.icon;
  return (
    <button type="button" onClick={onClick} className={clsx('inline-flex min-h-8 items-center gap-1.5 rounded px-2.5 text-sm font-medium hover:bg-card-2 [@media(pointer:coarse)]:min-h-11', meta.textClass)}>
      <Icon size={14} aria-hidden="true" />
      {count} {label}
    </button>
  );
}

function ActionIconButton({ icon: Icon, label, onClick, hoverClass }: { icon: typeof Copy; label: string; onClick: () => void; hoverClass?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={clsx('flex h-9 w-9 items-center justify-center rounded-control text-text-dim transition-colors hover:bg-card-2 hover:text-text [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11', hoverClass)}
    >
      <Icon size={15} />
    </button>
  );
}

const RetryButton = memo(function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 shrink-0 items-center gap-1 rounded-control px-2.5 text-xs font-medium text-text-dim transition-colors hover:bg-card-2 hover:text-text"
      aria-label="Retry this question"
      title="Retry"
    >
      <RotateCcw size={13} />
      Retry
    </button>
  );
});
