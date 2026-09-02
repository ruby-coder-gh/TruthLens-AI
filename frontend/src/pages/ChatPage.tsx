import { useState, useRef, useEffect, useCallback, useMemo, memo, type FormEvent, type KeyboardEvent } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import {
  Send,
  Plus,
  Sparkles,
  FileText,
  Shield,
  Brain,
  ChevronRight,
  Copy,
  ThumbsUp,
  ThumbsDown,
  Clock,
  AlertCircle,
  CheckCircle2,
  PanelRightOpen,
  PanelRightClose,
  Layers,
  Square,
  RotateCcw,
  Download,
  RefreshCw,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button, Badge } from '../components/ui';
import { fadeInUp, staggerContainer, staggerItem, pageTransition } from '../components/motion';
import { useToast } from '../components/toast-context';
import { PageShell } from '../components/PageWrappers';
import { feedbackApi, queryApi } from '../api/client';
import EvidenceSidebar from '../components/EvidenceSidebar';
import { QueryWebSocket, WS_RECONNECT_MAX } from '../api/websocket';
import type { QueryCompleteResult } from '../api/websocket';
import type { QueryEdgeCase, Source, SufficiencyVerdict } from '../api/types';
import AbstentionCard from '../components/AbstentionCard';
import { getRelevanceMeta, getTrustBadgeColor, relevancePercent } from '../utils/relevance';
import { useMediaQuery } from '../utils/useMediaQuery';
import { downloadBlob } from '../utils/download';

// ─── Constants ───────────────────────────────────────────────────────────────

const EXAMPLE_QUESTIONS = [
  'What are the key findings in my documents?',
  'Summarise the main topics',
  'Show me the important data points',
];

const MAX_TEXTAREA_ROWS = 6;
// Retrieval window for the "Expand search scope" action — wider than the
// default (5). Backend clamps to its own MAX_TOP_K, so overshooting is safe.
const WIDE_SEARCH_TOP_K = 12;

// Error-code → headline shown on a failed bubble. `connection_lost` /
// `auth_expired` come from the WebSocket client after its reconnect budget
// (or the token refresh) is exhausted.
const ERROR_TITLES: Record<string, string> = {
  connection_error: 'Connection lost',
  connection_lost: 'Connection lost',
  auth_error: 'Authentication error',
  auth_expired: 'Session expired',
  RESUME_UNAVAILABLE: 'Answer no longer available',
  stream_ended: 'Answer incomplete',
};

/** Codes whose recovery hint is "reconnect or start over". */
const CONNECTION_ERROR_CODES = new Set(['connection_error', 'connection_lost']);

// ─── Types ───────────────────────────────────────────────────────────────────

interface GuardrailResult {
  passed: boolean;
  score: number;
  details: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  sources: Source[];
  guardrail: GuardrailResult | null;
  trustScore: number | null;
  trustComponents: Record<string, number>;
  latencyMs: number | null;
  modelUsed: string | null;
  tokenCount: number | null;
  servedFromCache: boolean;
  queryId: string | null;
  error: { code: string; message: string } | null;
  status: 'pending' | 'streaming' | 'complete' | 'error' | 'cancelled';
  /** 1-based reconnect attempt currently in flight, or null when connected. */
  reconnectAttempt: number | null;
  // F7c — set from the `complete` frame when the sufficiency gate abstained.
  // `sufficiency` is absent on the cache-replay path (see AbstentionCard).
  edgeCase?: QueryEdgeCase | null;
  sufficiency?: SufficiencyVerdict | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function parseGuardrailDetails(details: string): string[] {
  try {
    const parsed = JSON.parse(details) as string[] | Record<string, unknown>;
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed === 'object' && parsed !== null) {
      const claims = parsed.unsupported_claims as string[] | undefined;
      if (Array.isArray(claims)) return claims;
      return Object.values(parsed).filter((v): v is string => typeof v === 'string');
    }
    return [];
  } catch {
    return details ? [details] : [];
  }
}

// Trust verdict → wax-seal stamp. Mirrors the Evidence sidebar's own
// thresholds (0.7 / 0.4) so the same message reads identically whether you're
// looking at the bubble or the panel.
function getTrustStampMeta(score: number): { label: string; colorClass: string } {
  if (score >= 0.7) return { label: 'Verified', colorClass: 'text-accent' };
  if (score >= 0.4) return { label: 'Review', colorClass: 'text-primary' };
  return { label: 'Flagged', colorClass: 'text-accent-2' };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN PAGE COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function ChatPage() {
  const { id: workspaceId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();

  // ─── State ────────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [, setStreamingMessageId] = useState<string | null>(null);
  // Readable mirror of the in-flight assistant message id — refs avoid stale closures
  // in event handlers (handleStop) that run outside the WS callback chain.
  const streamingMsgIdRef = useRef<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState('sources');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const [tracingBeam, setTracingBeam] = useState<{ startId: string; targetId: string } | null>(null);
  const [highlightedSourceId, setHighlightedSourceId] = useState<string | null>(null);
  const [sourcesModalOpen, setSourcesModalOpen] = useState(false);
  const [pipelinePhase, setPipelinePhase] = useState<string | null>(null);

  // Refs
  const wsRef = useRef<QueryWebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputKeyRef = useRef(0); // force re-mount textarea after send
  const [inputKey, setInputKey] = useState(0);

  // ─── Auto-scroll ──────────────────────────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // ─── Cleanup WebSocket on unmount ─────────────────────────────────────────
  useEffect(() => {
    return () => {
      wsRef.current?.disconnect();
      wsRef.current = null;
    };
  }, []);

  // ─── Generate unique IDs ───────────────────────────────────────────────────
  const genId = useCallback(() => crypto.randomUUID(), []);

  // ─── Start query via WebSocket ─────────────────────────────────────────────
  const startQuery = useCallback(
    (queryText: string, topK?: number, forceRefresh = false) => {
      if (!workspaceId || !queryText.trim() || isStreaming) return;

      // Tear down any previous socket before creating a new one — otherwise the
      // old (still-OPEN, still-handler-attached) socket is orphaned and leaks
      // until unmount, since only wsRef.current gets overwritten below.
      wsRef.current?.disconnect();

      // Generate conversation ID for first message
      let convId = conversationId;
      if (!convId) {
        convId = genId();
        setConversationId(convId);
      }

      const userMsgId = genId();
      const assistantMsgId = genId();

      // Add user message
      const userMsg: ChatMessage = {
        id: userMsgId,
        role: 'user',
        content: queryText.trim(),
        timestamp: new Date().toISOString(),
        sources: [],
        guardrail: null,
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
      };

      // Add pending assistant message
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        sources: [],
        guardrail: null,
        trustScore: null,
        trustComponents: {},
        latencyMs: null,
        modelUsed: null,
        tokenCount: null,
        servedFromCache: false,
        queryId: null,
        error: null,
        status: 'pending',
        reconnectAttempt: null,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setStreamingMessageId(assistantMsgId);
      streamingMsgIdRef.current = assistantMsgId;
      setIsStreaming(true);

      // Update textarea key to clear
      inputKeyRef.current += 1;
      setInputKey(inputKeyRef.current);

      // Create WebSocket
      const ws = new QueryWebSocket(workspaceId, queryText.trim(), {
        onToken: (token: string) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: m.content + token, status: 'streaming' as const }
                : m,
            ),
          );
        },

        onSource: (source: Source) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, sources: [...m.sources, source] }
                : m,
            ),
          );
        },

        onGuardrail: (result: { passed: boolean; score: number; details: string }) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, guardrail: result } : m,
            ),
          );
        },

        onTrustScore: (score: number, components: Record<string, number>) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, trustScore: score, trustComponents: components }
                : m,
            ),
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
                    // The `ack` id is authoritative; never clobber it with an
                    // empty one.
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
          setStreamingMessageId(null);
          streamingMsgIdRef.current = null;
          setPipelinePhase(null);
        },

        onError: (code: string, message: string) => {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantMsgId) return m;
              // Server echoes a CANCELLED frame after a user-initiated stop — that's
              // not a failure, so keep (or set) the neutral `cancelled` state instead
              // of flipping to the red error state.
              if (code === 'CANCELLED' || m.status === 'cancelled') {
                return { ...m, status: 'cancelled' as const, reconnectAttempt: null };
              }
              return { ...m, status: 'error' as const, error: { code, message }, reconnectAttempt: null };
            }),
          );
          // Every terminal error releases the composer — including the ones the
          // socket only reports after a failed reconnect (`connection_lost`,
          // `auth_expired`). A dropped socket used to report nothing at all,
          // which left `isStreaming` true and the textarea disabled forever.
          setIsStreaming(false);
          setStreamingMessageId(null);
          streamingMsgIdRef.current = null;
          setPipelinePhase(null);
        },

        onProgress: (phase: string) => {
          setPipelinePhase(phase);
        },

        // The socket dropped mid-answer and is retrying — keep the partial
        // answer and the streaming lock in place, just say so on the bubble.
        onReconnecting: (attempt: number) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, reconnectAttempt: attempt } : m,
            ),
          );
        },

        onReconnected: () => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, reconnectAttempt: null } : m,
            ),
          );
        },

        // The server accepted the query — learn its id now rather than waiting
        // for `complete`, which a dropped stream may never deliver.
        onAck: (ackQueryId: string) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, queryId: ackQueryId } : m,
            ),
          );
        },

        // The buffered stream expired and the query is being re-run, so the
        // answer on screen is stale. Every field below is *appended* to as the
        // stream arrives — without this reset the re-run's answer would be
        // concatenated onto the old partial one and sources would be doubled.
        onStreamRestart: () => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content: '',
                    sources: [],
                    guardrail: null,
                    trustScore: null,
                    trustComponents: {},
                    servedFromCache: false,
                    queryId: null,
                    error: null,
                  }
                : m,
            ),
          );
        },
      }, convId, topK, forceRefresh);

      wsRef.current = ws;
      ws.connect();
    },
    [workspaceId, conversationId, genId, isStreaming],
  );

  // ─── Evidence panel quick-actions (empty state) ───────────────────────────
  const lastUserQuestion = useCallback(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user' && messages[i].content.trim()) {
        return messages[i].content.trim();
      }
    }
    return '';
  }, [messages]);

  const handleUploadDocuments = useCallback(() => {
    navigate('/documents');
  }, [navigate]);

  const handleRephrase = useCallback(() => {
    const last = lastUserQuestion();
    if (last) setInputValue(last);
    textareaRef.current?.focus();
  }, [lastUserQuestion]);

  // Re-run the last question with a wider retrieval window (more chunks) —
  // streams live into the panel just like a normal query.
  const handleExpandScope = useCallback(() => {
    if (isStreaming) return;
    const last = lastUserQuestion();
    if (last) {
      startQuery(last, WIDE_SEARCH_TOP_K);
    } else {
      textareaRef.current?.focus();
    }
  }, [isStreaming, lastUserQuestion, startQuery]);

  // ─── Submit handler ───────────────────────────────────────────────────────
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

  // ─── Keyboard shortcut ────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  // ─── New conversation ────────────────────────────────────────────────────
  const handleNewConversation = useCallback(() => {
    if (isStreaming) {
      wsRef.current?.disconnect();
      wsRef.current = null;
    }
    setMessages([]);
    setConversationId(null);
    setStreamingMessageId(null);
    streamingMsgIdRef.current = null;
    setIsStreaming(false);
    setPipelinePhase(null);
    setExpandedSource(null);
    setTracingBeam(null);
    setHighlightedSourceId(null);
    setSidebarTab('sources');
    inputKeyRef.current += 1;
    setInputKey(inputKeyRef.current);
    textareaRef.current?.focus();
  }, [isStreaming]);

  // ─── Stop / cancel mid-stream ─────────────────────────────────────────────
  const handleStop = useCallback(() => {
    const targetId = streamingMsgIdRef.current;
    wsRef.current?.cancel();
    if (targetId) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === targetId
            ? { ...m, status: 'cancelled' as const } // preserves partial `content` as-is
            : m,
        ),
      );
    }
    setIsStreaming(false);
    setStreamingMessageId(null);
    streamingMsgIdRef.current = null;
    setPipelinePhase(null);
  }, []);

  // ─── Retry a cancelled/errored response ───────────────────────────────────
  const handleRetry = useCallback(
    (assistantMsgId: string) => {
      const idx = messages.findIndex((m) => m.id === assistantMsgId);
      if (idx <= 0) return;
      const precedingUser = [...messages.slice(0, idx)].reverse().find((m) => m.role === 'user');
      if (!precedingUser) return;
      startQuery(precedingUser.content);
    },
    [messages, startQuery],
  );

  const handleRegenerate = useCallback(
    (assistantMsgId: string) => {
      const idx = messages.findIndex((m) => m.id === assistantMsgId);
      if (idx <= 0 || isStreaming) return;
      const precedingUser = [...messages.slice(0, idx)].reverse().find((m) => m.role === 'user');
      if (!precedingUser) return;
      startQuery(precedingUser.content, undefined, true);
    },
    [isStreaming, messages, startQuery],
  );

  // ─── Copy response ────────────────────────────────────────────────────────
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

  // ─── Export response as Markdown ──────────────────────────────────────────
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

  // ─── Feedback mutation ────────────────────────────────────────────────────
  const feedbackMutation = useMutation({
    mutationFn: ({ queryId, rating }: { queryId: string; rating: number }) =>
      feedbackApi.submit(queryId, { rating }),
    onSuccess: () => {
      addToast('Feedback submitted', 'success');
    },
    onError: () => {
      addToast('Failed to submit feedback', 'error');
    },
  });

  // ─── Click example question ───────────────────────────────────────────────
  const handleExampleClick = useCallback(
    (question: string) => {
      setInputValue(question);
      // Focus textarea
      textareaRef.current?.focus();
    },
    [],
  );

  // ─── Compute active message (for sidebar context) ─────────────────────────
  // Include 'cancelled' so a stopped message's already-streamed sources/guardrail/
  // trust score still populate the Evidence sidebar instead of going blank.
  const lastAssistantMessage = [...messages]
    .reverse()
    .find(
      (m) =>
        m.role === 'assistant' &&
        (m.status === 'complete' || m.status === 'error' || m.status === 'cancelled'),
    );

  const lastAssistantHasError = lastAssistantMessage?.status === 'error';
  // F7c — an abstention has no generated answer to verify; the evidence panel
  // must show the "Abstained" terminus instead of a green verified pipeline.
  const lastAssistantAbstained = lastAssistantMessage?.edgeCase === 'insufficient_evidence';

  const latestSources = lastAssistantMessage?.sources ?? [];
  // An errored generation never has real verification/trust data — even if a
  // guardrail or trust-score frame happened to land before the failure, it
  // must not be presented as a "Verified" / passed result.
  const latestGuardrail = lastAssistantHasError ? null : lastAssistantMessage?.guardrail ?? null;
  const latestTrustScore = lastAssistantHasError ? null : lastAssistantMessage?.trustScore ?? null;
  const latestTrustComponents = lastAssistantHasError ? {} : lastAssistantMessage?.trustComponents ?? {};

  // ─── Responsive sidebar toggle ────────────────────────────────────────────
  // Reactive to viewport resize/rotation (unlike a one-shot `window.innerWidth`
  // read), so the evidence-sidebar/drawer logic below doesn't get stuck on
  // whatever breakpoint was true at first render.
  const isMobile = useMediaQuery('(max-width: 1023px)');
  const effectiveSidebarOpen = sidebarOpen;

  // ══════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════════════════════

  return (
    <>
      {/* Ambient background blobs */}
      <div className="ambient-blob ambient-blob-1" aria-hidden="true" />
      <div className="ambient-blob ambient-blob-2" aria-hidden="true" />
      <div className="ambient-blob ambient-blob-3" aria-hidden="true" />

      <PageShell className="h-full space-y-0">
      <motion.div
        className="flex h-full -m-4 lg:-m-6 relative z-10"
        {...pageTransition}
      >
        {/* ─── Chat Panel ─────────────────────────────────────────────────── */}
        <motion.div
          layout
          className={clsx(
            'flex flex-col flex-1 min-w-0',
            // The Evidence sidebar renders `position: fixed` (right: 16px, w-72 = 18rem)
            // so it never participates in this flex layout — at lg+ it visually floats
            // over whatever sits at that screen position. Without reserving matching
            // space here, the sidebar's higher z-index (30 vs this panel's 10)
            // intercepts real clicks on the Send/Stop button underneath it
            // (~1024–1440px). Reserve the sidebar's full footprint (18rem width + 1rem
            // right offset) plus a small extra buffer on the content column whenever
            // the sidebar is open at lg+, so its floating card always sits beside the
            // input with room to spare, never on top of it.
            !isMobile && effectiveSidebarOpen && 'lg:mr-[20rem]',
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/60 glass px-4 py-3 lg:px-6 rounded-tl-2xl">
            <div className="flex items-center gap-3">
              <motion.button
                type="button"
                onClick={() => navigate(`/workspaces/${workspaceId}`)}
                className="flex items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-text"
                whileHover={{ x: -3 }}
                transition={{ duration: 0.2 }}
              >
                <ChevronRight size={16} className="rotate-180" />
                Back
              </motion.button>
              <div className="h-4 w-px bg-border" />
              <div className="flex items-center gap-2">
                <motion.div
                  animate={{ rotate: [0, 5, -5, 0] }}
                  transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
                >
                  <Sparkles size={18} className="text-primary-soft" />
                </motion.div>
                <h2 className="text-base font-semibold text-text">VeritasRAG</h2>
              </div>
              {conversationId && (
                <Badge color="purple" className="hidden sm:inline-flex">
                  Chat active
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Evidence toggle — always visible */}
              <motion.button
                type="button"
                onClick={() => setSidebarOpen((prev) => !prev)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-card-2 hover:text-text"
                aria-label={sidebarOpen ? 'Close evidence panel' : 'Open evidence panel'}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                {sidebarOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
              </motion.button>

              {/* Sources button */}
              <motion.button
                type="button"
                onClick={() => setSourcesModalOpen(true)}
                disabled={latestSources.length === 0}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-text-muted transition-all duration-150 hover:border-primary/30 hover:bg-primary/[0.06] hover:text-primary-soft disabled:cursor-not-allowed disabled:opacity-40"
                whileTap={{ scale: 0.97 }}
              >
                <FileText size={15} />
                <span className="hidden sm:inline">Sources</span>
                {latestSources.length > 0 && (
                  <span className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary/20 px-1 text-[9px] font-semibold text-primary-soft">{latestSources.length}</span>
                )}
              </motion.button>

              {/* New conversation */}
              <Button
                variant="secondary"
                size="sm"
                onClick={handleNewConversation}
                disabled={isStreaming && messages.length === 0}
              >
                <Plus size={16} />
                <span className="hidden sm:inline">New chat</span>
              </Button>
            </div>
          </div>

          {/* ─── Messages Area ───────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto px-4 py-4 lg:px-6">
            {messages.length === 0 ? (
              <EmptyChatState onExampleClick={handleExampleClick} />
            ) : (
              <motion.div
                className="mx-auto max-w-3xl space-y-6"
                variants={staggerContainer}
                initial="initial"
                animate="animate"
              >
                <AnimatePresence mode="popLayout">
                  {messages.map((msg) => (
                    <ChatMessageBubble
                      key={msg.id}
                      message={msg}
                      onCopy={handleCopy}
                      onExport={() => {
                        if (msg.queryId) handleExport(msg.queryId);
                      }}
                      onFeedback={(rating) => {
                        if (msg.queryId) {
                          feedbackMutation.mutate({ queryId: msg.queryId, rating });
                        }
                      }}
                      onRetry={() => handleRetry(msg.id)}
                      onRegenerate={() => handleRegenerate(msg.id)}
                      onRephrase={handleRephrase}
                      workspaceId={workspaceId}
                      onSourceClick={(source, _e, msgId, index) => {
                        const markerId = `cite-${msgId}-${index}`;
                        const targetId = `source-${source.chunk_id}`;
                        setSidebarTab('sources');
                        setExpandedSource(source.chunk_id);
                        if (isMobile) setSidebarOpen(true);
                        setTracingBeam({ startId: markerId, targetId });
                      }}
                    />
                  ))}
                </AnimatePresence>
                <div ref={messagesEndRef} />
              </motion.div>
            )}
          </div>

          {/* ─── Input Area ──────────────────────────────────────────────── */}
          <div className="border-t border-border/30 px-4 py-4 lg:px-6 rounded-bl-2xl">
            <motion.form
              onSubmit={handleSubmit}
              className="mx-auto flex max-w-3xl items-start gap-3"
              initial={{ opacity: 0.99, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.3 }}
            >
              <div className="relative flex-1">
                <textarea
                  key={inputKey}
                  ref={textareaRef}
                  value={inputValue}
                  onChange={(e) => {
                    setInputValue(e.target.value);
                    // Auto-resize
                    e.target.style.height = 'auto';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, MAX_TEXTAREA_ROWS * 1.5 * 16)}px`;
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask a question about your documents…"
                  disabled={isStreaming}
                  rows={1}
                  className="relative w-full resize-none rounded-xl border border-border/40 bg-bg-soft/90 px-4 py-3 pr-12 text-sm text-text placeholder-text-dim backdrop-blur-sm transition-all disabled:cursor-not-allowed disabled:opacity-50 z-10"
                  aria-label="Type your question"
                />
                {/* Breathing glow border — idle + has-text only, never while streaming */}
                <motion.div
                  className="absolute inset-0 rounded-xl pointer-events-none -z-10"
                  animate={
                    inputValue.trim() && !isStreaming
                      ? {
                          boxShadow: [
                            '0 0 10px 2px rgba(99,102,241,0.12), inset 0 0 10px 2px rgba(99,102,241,0.03)',
                            '0 0 18px 6px rgba(99,102,241,0.22), inset 0 0 14px 4px rgba(99,102,241,0.06)',
                            '0 0 10px 2px rgba(99,102,241,0.12), inset 0 0 10px 2px rgba(99,102,241,0.03)',
                          ],
                        }
                      : { boxShadow: 'none' }
                  }
                  transition={{ duration: 2.5, repeat: inputValue.trim() && !isStreaming ? Infinity : 0, ease: 'easeInOut' }}
                />
              </div>
              {isStreaming ? (
                <motion.button
                  type="button"
                  onClick={handleStop}
                  aria-label="Stop generating"
                  title="Stop generating"
                  className="shrink-0 flex items-center justify-center rounded-xl border border-red/30 bg-white/5 text-text-muted transition-all duration-150 hover:border-red/50 hover:bg-red/15 hover:text-red"
                  style={{ height: '44px', minWidth: '44px' }}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <Square size={16} fill="currentColor" />
                </motion.button>
              ) : (
                <motion.button
                  type="submit"
                  disabled={!inputValue.trim()}
                  aria-label="Send message"
                  className="shrink-0 flex items-center justify-center rounded-xl border border-primary/30 bg-primary px-4 text-white transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40 disabled:border-transparent disabled:bg-white/5"
                  style={{ height: '44px', minWidth: '44px' }}
                  animate={
                    inputValue.trim()
                      ? {
                          boxShadow: [
                            '0 0 10px 3px rgba(99,102,241,0.3)',
                            '0 0 22px 8px rgba(99,102,241,0.45)',
                            '0 0 10px 3px rgba(99,102,241,0.3)',
                          ],
                          borderColor: 'rgba(99,102,241,0.6)',
                        }
                      : {
                          boxShadow: 'none',
                          borderColor: 'rgba(255,255,255,0.08)',
                        }
                  }
                  transition={{ duration: 2, repeat: inputValue.trim() ? Infinity : 0, ease: 'easeInOut' }}
                  whileHover={inputValue.trim() ? { scale: 1.04, boxShadow: '0 0 28px 10px rgba(99,102,241,0.5)' } : {}}
                  whileTap={{ scale: 0.95 }}
                >
                  <Send size={18} />
                </motion.button>
              )}
            </motion.form>
          </div>
        </motion.div>

        {/* ─── Evidence Sidebar ──────────────────────────────────────────── */}
        <EvidenceSidebar
          sources={latestSources}
          guardrail={latestGuardrail}
          trustScore={latestTrustScore}
          trustComponents={latestTrustComponents}
          isLoading={isStreaming && !pipelinePhase}
          isStreaming={isStreaming}
          hasError={lastAssistantHasError}
          abstained={lastAssistantAbstained}
          sidebarOpen={effectiveSidebarOpen}
          onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
          pipelinePhase={pipelinePhase}
          isMobile={isMobile}
          activeTab={sidebarTab}
          onTabChange={setSidebarTab}
          expandedSourceId={expandedSource}
          onToggleSource={setExpandedSource}
          highlightedSourceId={highlightedSourceId}
          onUploadDocuments={handleUploadDocuments}
          onRephrase={handleRephrase}
          onExpandScope={handleExpandScope}
        />
      </motion.div>
      </PageShell>

      {/* ─── Sources Popup Modal ──────────────────────────────────────────── */}
      <AnimatePresence>
        {sourcesModalOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
              initial={{ opacity: 0.99 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
              onClick={() => setSourcesModalOpen(false)}
            />
            <motion.div
              className="fixed inset-x-4 top-[10%] z-50 mx-auto max-w-2xl max-h-[70vh] overflow-y-auto rounded-2xl border border-border/40 bg-bg/97 backdrop-blur-2xl shadow-2xl"
              initial={{ opacity: 0.99, scale: 0.93, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
            >
              <div className="flex items-center justify-between border-b border-border/40 px-5 py-4">
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-primary-soft" />
                  <h3 className="text-sm font-bold text-text">Sources Used</h3>
                  <Badge color="purple">{latestSources.length}</Badge>
                </div>
                <motion.button
                  type="button"
                  onClick={() => setSourcesModalOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim hover:bg-card-2 hover:text-text"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M11 3L3 11M3 3l8 8" />
                  </svg>
                </motion.button>
              </div>
              <div className="p-4 space-y-3">
                {latestSources.length === 0 ? (
                  <p className="text-sm text-text-muted text-center py-8">No sources retrieved yet.</p>
                ) : (
                  latestSources.map((source, i) => {
                    const relevance = getRelevanceMeta(source.relevance_score);
                    const relevancePct = relevance.percent;
                    const confidencePct = relevancePercent(source.confidence ?? source.relevance_score);
                    const docName = source.document_name || `Source ${i + 1}`;
                    const fileExt = docName.includes('.') ? docName.split('.').pop()?.toUpperCase() : 'DOC';

                    return (
                      <motion.div
                        key={source.chunk_id || i}
                        initial={{ opacity: 0.99, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className="group relative rounded-2xl border border-border/40 bg-card/60 p-4 hover:border-primary/30 hover:bg-card-hover transition-all duration-300"
                        whileHover={{ y: -2, scale: 1.005 }}
                      >
                        <div className="space-y-3">
                          {/* Row 1: Icon + Exhibit tag + Name + Type */}
                          <div className="flex items-start gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-primary-dark/20 border border-primary/20">
                              <FileText size={16} className="text-primary-soft" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="mb-1 flex items-center gap-1.5">
                                <span className="inline-flex items-center rounded-[3px] bg-primary px-1.5 py-[1px] font-mono text-[8px] font-bold uppercase tracking-widest text-bg">
                                  Exhibit {String(i + 1).padStart(2, '0')}
                                </span>
                                <Badge color="gray" className="shrink-0 text-[10px]">{fileExt}</Badge>
                              </div>
                              <p className="truncate font-mono text-sm font-medium text-primary">
                                {docName}
                                {source.page_number ? <span className="font-sans font-normal text-text-dim"> · p.{source.page_number}</span> : null}
                              </p>
                              {source.updated_at && (
                                <p className="mt-0.5 text-xs text-text-dim">
                                  Updated {new Date(source.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Row 2: Relevance bar */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-text-dim">Relevance</span>
                              <span className={clsx('font-mono font-medium tabular-nums', relevance.colors.text)}>
                                {relevancePct}%
                              </span>
                            </div>
                            <div className="relative h-2 rounded-full bg-white/5 overflow-hidden">
                              <motion.div
                                className={clsx('absolute inset-y-0 left-0 rounded-full', relevance.colors.bar)}
                                initial={{ width: 0 }}
                                animate={{ width: `${relevancePct}%` }}
                                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
                              />
                            </div>
                          </div>

                          {/* Row 3: Excerpt */}
                          <p className="text-xs text-text-muted leading-relaxed line-clamp-2">
                            {source.excerpt || 'No content'}
                          </p>

                          {/* Row 4: Confidence + Meta */}
                          <div className="flex items-center gap-3 font-mono text-[11px] text-text-dim">
                            <span className="flex items-center gap-1 tabular-nums">
                              <Shield size={10} /> {confidencePct}%
                            </span>
                            {source.matched_chunks !== undefined && (
                              <span className="flex items-center gap-1 tabular-nums">
                                <Layers size={10} /> {source.matched_chunks} chunk{source.matched_chunks !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {tracingBeam && (
        <TraceBeamOverlay
          startId={tracingBeam.startId}
          targetId={tracingBeam.targetId}
          onComplete={() => {
            const target = tracingBeam.targetId.replace('source-', '');
            setHighlightedSourceId(target);
            setTracingBeam(null);
            setTimeout(() => setHighlightedSourceId(null), 1500);
          }}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  EMPTY CHAT STATE
// ═══════════════════════════════════════════════════════════════════════════════

const EmptyChatState = memo(function EmptyChatState({ onExampleClick }: { onExampleClick: (q: string) => void }) {
  return (
    <motion.div
      className="flex h-full flex-col items-center justify-center py-16 text-center"
      variants={fadeInUp}
      initial="initial"
      animate="animate"
    >
      <motion.div
        className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl glass shadow-lg shadow-primary/10"
        initial={{ scale: 0, rotate: -10 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', damping: 12, stiffness: 150, delay: 0.1 }}
      >
        <motion.div
          animate={{ rotate: [0, 5, -5, 0] }}
          transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
        >
          <Sparkles size={36} className="text-primary-soft" />
        </motion.div>
      </motion.div>

      <motion.h2
        className="text-2xl font-bold text-text"
        variants={staggerItem}
      >
        Ask anything
      </motion.h2>
      <motion.p
        className="mt-2 max-w-md text-sm text-text-muted"
        variants={staggerItem}
      >
        Search, summarise, and analyse your documents with AI-powered retrieval.
      </motion.p>

      <motion.div
        className="mt-8 flex flex-wrap justify-center gap-2"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        {EXAMPLE_QUESTIONS.map((q) => (
          <motion.button
            key={q}
            type="button"
            onClick={() => onExampleClick(q)}
            className="inline-flex items-center gap-2 rounded-full glass px-4 py-2 text-sm text-text-muted transition-all duration-200 hover:border-primary/30 hover:bg-card-hover hover:text-text hover:shadow-lg hover:shadow-primary/10"
            variants={staggerItem}
            whileHover={{ scale: 1.04, y: -2 }}
            whileTap={{ scale: 0.97 }}
          >
            <Sparkles size={14} className="text-primary-soft" />
            {q}
          </motion.button>
        ))}
      </motion.div>

      <motion.div
        className="mt-12 grid grid-cols-3 gap-6 text-center"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        {[
          { icon: FileText, color: 'text-accent', label: 'Semantic search', desc: 'Retrieve relevant chunks' },
          { icon: Shield, color: 'text-primary-soft', label: 'Guardrails', desc: 'Factual accuracy checks' },
          { icon: Brain, color: 'text-gold', label: 'Trust scores', desc: 'Confidence metrics' },
        ].map((item) => (
          <motion.div key={item.label} className="space-y-2" variants={staggerItem}>
            <motion.div
              className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl glass"
              whileHover={{ scale: 1.1, rotate: [0, -5, 5, 0] }}
              transition={{ duration: 0.3 }}
            >
              <item.icon size={22} className={item.color} />
            </motion.div>
            <p className="text-xs font-medium text-text">{item.label}</p>
            <p className="text-[11px] text-text-dim">{item.desc}</p>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
//  CHAT MESSAGE BUBBLE
// ═══════════════════════════════════════════════════════════════════════════════

const ChatMessageBubble = memo(function ChatMessageBubble({
  message,
  onCopy,
  onExport,
  onFeedback,
  onRetry,
  onRegenerate,
  onSourceClick,
  onRephrase,
  workspaceId,
}: {
  message: ChatMessage;
  onCopy: (text: string) => void;
  onExport: () => void;
  onFeedback: (rating: number) => void;
  onRetry: () => void;
  onRegenerate: () => void;
  onSourceClick: (source: Source, e: React.MouseEvent, msgId: string, index: number) => void;
  /** F7c — "Rephrase" chip on the abstention card (the textarea ref lives on the page). */
  onRephrase?: () => void;
  workspaceId?: string;
}) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  // F7c — the sufficiency gate abstained: nothing was generated, so the normal
  // complete-card (citations, trust ring, feedback thumbs) must not render.
  const isAbstained = message.edgeCase === 'insufficient_evidence';
  const isComplete = message.status === 'complete' && !isAbstained;
  const isError = message.status === 'error';
  const isCancelled = message.status === 'cancelled';
  const isMessageStreaming = message.status === 'pending' || message.status === 'streaming';
  const trustStamp = message.trustScore !== null ? getTrustStampMeta(message.trustScore) : null;

  return (
    <motion.div
      className={clsx(
        'flex',
        isUser ? 'justify-end' : 'justify-start',
      )}
      variants={staggerItem}
      layout
      initial={{ opacity: 0.99, y: 20, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.97 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] as const }}
    >
      <div
        className={clsx(
          'max-w-[85%]',
          isUser && 'order-1',
        )}
      >
        {/* ─── USER MESSAGE ───────────────────────────────────────────── */}
        {isUser && (
          <motion.div
            className="rounded-2xl rounded-br-md bg-gradient-to-br from-primary to-primary-dark px-4 py-2.5 shadow-lg shadow-primary/20"
            initial={{ opacity: 0.99, scale: 0.9, x: 20 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] as const }}
          >
            <p className="text-sm text-white">{message.content}</p>
          </motion.div>
        )}

        {/* ─── ASSISTANT MESSAGE ─────────────────────────────────────── */}
        {isAssistant && (
          <div
            className="glass rounded-2xl bg-card/60 border border-white/10 p-5 flex flex-col gap-4 shadow-xl"
            role="log"
            aria-live="polite"
            aria-atomic="false"
            aria-busy={isMessageStreaming}
          >
            {/* Reconnecting — the socket dropped mid-answer and is resuming */}
            {isMessageStreaming && message.reconnectAttempt !== null && (
              <div
                role="status"
                aria-label={`Reconnecting, attempt ${message.reconnectAttempt} of ${WS_RECONNECT_MAX}`}
                className="flex items-center gap-1.5 self-start rounded-full border border-gold/30 bg-gold/15 px-2.5 py-1 text-[11px] font-medium text-gold"
              >
                <RefreshCw size={11} className="animate-spin" aria-hidden="true" />
                {`Reconnecting… (${message.reconnectAttempt}/${WS_RECONNECT_MAX})`}
              </div>
            )}

            {/* Pending state */}
            {message.status === 'pending' && (
              <div className="flex items-center gap-2 py-2">
                <TypingIndicator />
                <motion.span
                  className="text-sm text-text-muted"
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                >
                  Thinking…
                </motion.span>
              </div>
            )}

            {/* Streaming cursor — live markdown */}
            {message.status === 'streaming' && (
              <div className="text-sm leading-relaxed text-text">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.content}
                </ReactMarkdown>
                <motion.span
                  className="ml-0.5 inline-block h-4 w-[3px] rounded-sm bg-primary-soft align-text-bottom"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ repeat: Infinity, duration: 0.8, ease: 'easeInOut' }}
                />
              </div>
            )}

            {/* Cancelled state — user-initiated stop, not a failure. Keep the partial answer. */}
            {isCancelled && (
              <>
                {message.content && (
                  <div className="text-sm leading-relaxed text-text">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {message.content}
                    </ReactMarkdown>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <Badge color="gray" className="gap-1">
                    <Square size={9} fill="currentColor" />
                    Stopped
                  </Badge>
                  <RetryButton onClick={onRetry} />
                </div>
              </>
            )}

            {/* Abstained — evidence-sufficiency gate refused before generation (F7c) */}
            {isAbstained && message.status === 'complete' && (
              <AbstentionCard
                answer={message.content}
                sufficiency={message.sufficiency}
                workspaceId={workspaceId}
                onRephrase={onRephrase}
              />
            )}

            {/* Complete content — full card */}
            {isComplete && message.content && (
              <>
                {/* TOP: Metadata row (guardrail + trust score) */}
                <div className="flex items-center gap-3 border-b border-white/5 pb-3">
                  {message.guardrail && (
                    <GuardrailBadge guardrail={message.guardrail} />
                  )}
                  {message.trustScore !== null && trustStamp && (
                    <div className="flex items-center gap-2">
                      <TrustScoreRing score={message.trustScore} />
                      <span className={clsx('wax-seal text-[9px]', trustStamp.colorClass)}>
                        {trustStamp.label}
                      </span>
                      <span className="font-mono text-xs tabular-nums text-text-dim">
                        {(message.trustScore * 100).toFixed(0)}%
                      </span>
                    </div>
                  )}
                  {message.servedFromCache && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card-2 px-2 py-0.5 text-[11px] font-medium text-text-dim" title="Served from a valid cached result. Regenerate to run retrieval and generation again.">
                      <Clock size={11} aria-hidden="true" /> Cached
                    </span>
                  )}
                </div>

                {/* MIDDLE: Markdown content with citations */}
                <div className="text-sm text-text leading-relaxed">
                  {renderMessageWithCitations(message.id, message.content, message.sources, onSourceClick)}
                </div>

                {/* BOTTOM: Footer — latency, model, actions */}
                <div className="flex items-center justify-between pt-2 border-t border-white/5 text-xs text-text-dim">
                  <div className="flex flex-wrap items-center gap-3">
                    {message.latencyMs !== null && (
                      <span className="flex items-center gap-1">
                        <Clock size={12} />
                        {formatLatency(message.latencyMs)}
                      </span>
                    )}
                    {message.modelUsed && (
                      <span className="flex items-center gap-1">
                        <Brain size={12} />
                        {message.modelUsed}
                      </span>
                    )}
                    {message.tokenCount !== null && (
                      <span>{message.tokenCount} tokens</span>
                    )}
                    <span>{formatTimestamp(message.timestamp)}</span>
                  </div>
                  <div className="flex items-center -mr-2">
                    {message.servedFromCache && (
                      <motion.button
                        type="button"
                        onClick={onRegenerate}
                        className="flex h-10 w-10 items-center justify-center rounded-md text-text-dim transition-colors hover:bg-card-2 hover:text-primary-soft"
                        aria-label="Regenerate with fresh retrieval"
                        title="Regenerate fresh answer"
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                      >
                        <RotateCcw size={14} />
                      </motion.button>
                    )}
                    <motion.button
                      type="button"
                      onClick={() => onCopy(message.content)}
                      className="flex h-10 w-10 items-center justify-center rounded-md text-text-dim transition-colors hover:bg-card-2 hover:text-text"
                      aria-label="Copy response"
                      title="Copy response"
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <Copy size={14} />
                    </motion.button>
                    {message.queryId && (
                      <>
                        <motion.button
                          type="button"
                          onClick={() => onFeedback(5)}
                          className="flex h-10 w-10 items-center justify-center rounded-md text-text-dim transition-colors hover:bg-card-2 hover:text-green"
                          aria-label="Thumbs up"
                          title="Helpful"
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                        >
                          <ThumbsUp size={14} />
                        </motion.button>
                        <motion.button
                          type="button"
                          onClick={() => onFeedback(1)}
                          className="flex h-10 w-10 items-center justify-center rounded-md text-text-dim transition-colors hover:bg-card-2 hover:text-red"
                          aria-label="Thumbs down"
                          title="Not helpful"
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                        >
                          <ThumbsDown size={14} />
                        </motion.button>
                        <motion.button
                          type="button"
                          onClick={() => onExport()}
                          className="flex h-10 w-10 items-center justify-center rounded-md text-text-dim transition-colors hover:bg-card-2 hover:text-text"
                          aria-label="Export as Markdown"
                          title="Export .md"
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                        >
                          <Download size={14} />
                        </motion.button>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Error state */}
            {isError && message.error && (
              <motion.div
                className="flex items-start gap-3 rounded-xl border border-red/30 bg-red/10 p-3"
                role="alert"
                initial={{ opacity: 0.99, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
              >
                <AlertCircle size={18} className="mt-0.5 shrink-0 text-red" />
                <div className="flex-1 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-red">
                      {ERROR_TITLES[message.error.code] ?? 'Query failed'}
                    </p>
                    <RetryButton onClick={onRetry} />
                  </div>
                  <p className="mt-0.5 text-text-muted">{message.error.message}</p>
                  {CONNECTION_ERROR_CODES.has(message.error.code) && (
                    <p className="mt-1 text-xs text-text-dim">
                      Try reconnecting or starting a new conversation.
                    </p>
                  )}
                </div>
              </motion.div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
});

// ─── Retry button — shown on cancelled/error bubbles, same action-cluster style ─

const RetryButton = memo(function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      className="flex h-10 shrink-0 items-center gap-1 rounded-md px-3 text-xs font-medium text-text-dim transition-colors hover:bg-card-2 hover:text-text"
      aria-label="Retry this question"
      title="Retry"
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.9 }}
    >
      <RotateCcw size={13} />
      Retry
    </motion.button>
  );
});

// ─── Typing Indicator (bouncing dots) ─────────────────────────────────────────

const TypingIndicator = memo(function TypingIndicator() {
  return (
    <div className="flex items-center gap-1" aria-label="Thinking" role="status">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-2 w-2 rounded-full bg-primary-soft"
          animate={{
            y: [0, -6, 0],
            opacity: [0.5, 1, 0.5],
          }}
          transition={{
            repeat: Infinity,
            duration: 0.8,
            delay: i * 0.15,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
});

// ─── Citation Hover Card — shows source excerpt on hover ─────────────────────

const CitationHoverCard = memo(function CitationHoverCard({ source, children }: { source: Source; children: ReactNode }) {
  const [show, setShow] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const relevancePct = relevancePercent(source.relevance_score);
  const docName = source.document_name || 'Source';

  const showCard = () => {
    hoverTimer.current = setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setPos({
          top: rect.bottom + 8,
          left: Math.min(rect.left, window.innerWidth - 360),
        });
        setShow(true);
      }
    }, 300); // small delay to avoid flicker
  };

  const hideCard = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setShow(false);
  };

  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={showCard}
        onMouseLeave={hideCard}
        className="relative inline-flex"
      >
        {children}
      </span>
      {show && createPortal(
        <motion.div
          initial={{ opacity: 0.99, y: -4, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0.99, y: -4, scale: 0.97 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          onMouseEnter={showCard}
          onMouseLeave={hideCard}
          className="fixed z-[70] w-80 rounded-2xl border border-glass-border bg-bg-soft/95 backdrop-blur-2xl shadow-2xl shadow-black/60 overflow-hidden"
          style={{ top: pos.top, left: pos.left }}
        >
          {/* Header */}
          <div className="px-4 pt-3 pb-2 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <FileText size={14} className="text-primary-soft shrink-0" />
              <span className="truncate font-mono text-sm font-medium text-primary">{docName}</span>
              <span className="ml-auto font-mono text-[10px] text-text-dim tabular-nums">{relevancePct}%</span>
            </div>
          </div>

          {/* Excerpt */}
          <div className="px-4 py-3 max-h-28 overflow-y-auto">
            <p className="text-xs text-text-muted leading-relaxed line-clamp-4">
              {source.excerpt || 'No excerpt available'}
            </p>
          </div>

          {/* Score bar */}
          <div className="px-4 pb-3">
            <div className="h-1 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-700"
                style={{ width: `${relevancePct}%` }}
              />
            </div>
          </div>

          {/* Click hint */}
          <div className="px-4 pb-3 flex items-center gap-1.5 text-[10px] text-text-dim border-t border-white/[0.06] pt-2">
            <Brain size={10} />
            Click to locate in sidebar
          </div>
        </motion.div>,
        document.body
      )}
    </>
  );
});

// ─── Render message with clickable citation markers ──────────────────────────

function renderMessageWithCitations(
  messageId: string,
  content: string,
  sources: Source[],
  onSourceClick: (source: Source, e: React.MouseEvent, msgId: string, index: number) => void,
): React.ReactNode {
  // Backend cites sources inline as literal `[source:N]` markers (1-indexed —
  // see backend/app/generation/citer.py / generator.py). Split on that exact
  // token so each citation renders as a real, clickable footnote instead of
  // leaking through ReactMarkdown as raw bracketed text.
  const parts = content.split(/(\[source:\d+\])/gi);
  // No citation markers — render full markdown untouched (raw-text fallback).
  if (parts.length <= 1) {
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    );
  }

  // Has citations — render text parts as markdown, citation parts as footnote buttons.
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/\[source:(\d+)\]/i);
        if (match) {
          const idx = parseInt(match[1], 10) - 1;
          const source = sources[idx];
          if (source) {
            const docName = source.document_name || `Source ${idx + 1}`;
            return (
              <CitationHoverCard key={i} source={source}>
                <motion.button
                  id={`cite-${messageId}-${idx}`}
                  type="button"
                  onClick={(e) => onSourceClick(source, e, messageId, idx)}
                  aria-label={`View source ${idx + 1}: ${docName}`}
                  className="inline-flex items-center bg-transparent border-0 p-0 m-0 align-baseline rounded-sm cursor-pointer transition-[filter] duration-150 hover:brightness-125 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <sup className="footnote-ref">{idx + 1}</sup>
                </motion.button>
              </CitationHoverCard>
            );
          }
          // Citation number has no matching retrieved source (e.g. still mid-stream) —
          // keep a marker in place, just dimmed since it isn't clickable yet.
          return (
            <sup key={i} className="footnote-ref !text-text-dim" title="Source unavailable">
              {idx + 1}
            </sup>
          );
        }
        return (
          <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>
            {part}
          </ReactMarkdown>
        );
      })}
    </>
  );
}

// ─── Guardrail badge ─────────────────────────────────────────────────────────

const GuardrailBadge = memo(function GuardrailBadge({ guardrail }: { guardrail: GuardrailResult }) {
  // Memoize the parsed claims to avoid re-parsing on every render
  const claims = useMemo(() => parseGuardrailDetails(guardrail.details), [guardrail.details]);

  return (
    <motion.div
      className={clsx(
        'flex items-start gap-2 rounded-xl border p-3',
        guardrail.passed
          ? 'border-green/30 bg-green/10'
          : 'border-orange/30 bg-orange/10',
      )}
      initial={{ opacity: 0.99, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {guardrail.passed ? (
        <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green" />
      ) : (
        <AlertCircle size={18} className="mt-0.5 shrink-0 text-orange" />
      )}
      <div className="text-sm">
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              'font-medium',
              guardrail.passed ? 'text-green' : 'text-orange',
            )}
          >
            {guardrail.passed ? 'Verified' : 'Unsupported claims'}
          </span>
          <Badge
            color={guardrail.passed ? 'green' : 'orange'}
            className="text-[10px]"
          >
            {(guardrail.score * 100).toFixed(0)}%
          </Badge>
        </div>
        {!guardrail.passed && claims.length > 0 && (
          <motion.ul
            className="mt-1 list-inside list-disc space-y-0.5 text-xs text-text-muted"
            initial={{ opacity: 0.99 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
          >
            {claims.slice(0, 3).map((claim, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0.99, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.05 }}
              >
                {claim}
              </motion.li>
            ))}
            {claims.length > 3 && (
              <li className="text-text-dim">
                +{claims.length - 3} more unsupported claims
              </li>
            )}
          </motion.ul>
        )}
      </div>
    </motion.div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
//  TRUST SCORE RING (Answer Verification Sequence)
// ═══════════════════════════════════════════════════════════════════════════════

const TrustScoreRing = memo(function TrustScoreRing({ score }: { score: number }) {
  const [complete, setComplete] = useState(false);
  const size = 32;
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score);

  const tone = getTrustBadgeColor(score);
  const isHigh = tone === 'green';
  const color = tone === 'green' ? 'var(--color-accent)' : tone === 'orange' ? 'var(--color-orange)' : 'var(--color-red)';

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="shrink-0 -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(122,136,162,0.28)"
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] as const }}
          onAnimationComplete={() => setComplete(true)}
        />
      </svg>
      {complete && (
        <motion.div
          className="absolute inset-0 rounded-full"
          initial={{ boxShadow: `0 0 0 0 ${color}` }}
          animate={{ boxShadow: `0 0 15px 2px ${color}` }}
          transition={
            isHigh
              ? { duration: 0.5 }
              : { duration: 2, repeat: Infinity, repeatType: 'reverse' as const }
          }
          style={{ opacity: 0.5 }}
        />
      )}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[10px] font-mono font-medium" style={{ color }}>
          {(score * 100).toFixed(0)}
        </span>
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
//  TRACE BEAM OVERLAY (Citation Trace Beam)
// ═══════════════════════════════════════════════════════════════════════════════

const TraceBeamOverlay = memo(function TraceBeamOverlay({ 
  startId, 
  targetId, 
  onComplete 
}: { 
  startId: string; 
  targetId: string; 
  onComplete: () => void;
}) {
  const [path, setPath] = useState('');

  useEffect(() => {
    const timeout = setTimeout(() => {
      const startEl = document.getElementById(startId);
      const targetEl = document.getElementById(targetId);
      
      if (!startEl || !targetEl) {
        onComplete();
        return;
      }
      
      const startRect = startEl.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();

      const startX = startRect.right;
      const startY = startRect.top + startRect.height / 2;
      
      const endX = targetRect.left;
      const endY = targetRect.top + targetRect.height / 2;
      
      const cp1x = startX + (endX - startX) / 2;
      const cp1y = startY;
      const cp2x = startX + (endX - startX) / 2;
      const cp2y = endY;

      setPath(`M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`);
    }, 150);
    
    return () => clearTimeout(timeout);
  }, [startId, targetId, onComplete]);

  if (!path) return null;

  return (
    <svg className="fixed inset-0 pointer-events-none z-[100]" style={{ width: '100vw', height: '100vh' }}>
      <motion.path
        d={path}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="2"
        strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 1 }}
        animate={{ pathLength: 1, opacity: 0 }}
        transition={{ 
          pathLength: { duration: 0.5, ease: 'easeOut' as const },
          opacity: { delay: 0.3, duration: 0.3 }
        }}
        onAnimationComplete={onComplete}
        style={{ filter: 'drop-shadow(0 0 6px var(--color-accent))' }}
      />
    </svg>
  );
});
