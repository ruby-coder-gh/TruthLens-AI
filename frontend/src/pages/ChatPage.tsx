import { useState, useRef, useEffect, useCallback, createPortal, type FormEvent, type KeyboardEvent } from 'react';
import type { ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
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
  X,
  Copy,
  ThumbsUp,
  ThumbsDown,
  Clock,
  AlertCircle,
  CheckCircle2,
  PanelRightOpen,
  PanelRightClose,
  Loader2,
  MessageSquare,
  Trash2,
  ExternalLink,
  Pin,
  Search,
  Flag,
  ChevronDown,
  Eye,
  Quote,
  Zap,
  Layers,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Button,
  Card,
  Badge,
  EmptyState,
  Skeleton,
  ProgressBar,
  useToast,
  fadeIn,
  fadeInUp,
  staggerContainer,
  staggerItem,
  pageTransition,
} from '../components/ui';
import {
  queryApi,
  feedbackApi,
} from '../api/client';
import EvidenceSidebar from '../components/EvidenceSidebar';
import { QueryWebSocket } from '../api/websocket';
import type { Source, QuerySummary } from '../api/types';

// ─── Constants ───────────────────────────────────────────────────────────────

const EXAMPLE_QUESTIONS = [
  'What are the key findings in my documents?',
  'Summarise the main topics',
  'Show me the important data points',
];

const MAX_TEXTAREA_ROWS = 6;
const INITIAL_SOURCES_SHOWN = 3;

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
  queryId: string | null;
  error: { code: string; message: string } | null;
  status: 'pending' | 'streaming' | 'complete' | 'error';
}

interface StoredQueryDetail {
  queryId: string;
  queryText: string;
  responseText: string;
  timestamp: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function trustScoreColor(score: number): 'green' | 'orange' | 'red' {
  if (score >= 0.75) return 'green';
  if (score >= 0.5) return 'orange';
  return 'red';
}

function trustScoreLabel(score: number): string {
  if (score >= 0.75) return 'High confidence';
  if (score >= 0.5) return 'Medium confidence';
  return 'Low confidence';
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
  const [_streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState('sources');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const [tracingBeam, setTracingBeam] = useState<{ startId: string; targetId: string } | null>(null);
  const [highlightedSourceId, setHighlightedSourceId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState<string | null>(null);
  const [sourcesModalOpen, setSourcesModalOpen] = useState(false);
  const [pipelinePhase, setPipelinePhase] = useState<string | null>(null);
  // Track queries stored in API for history tab
  const [storedQueries, setStoredQueries] = useState<StoredQueryDetail[]>([]);

  // Refs
  const wsRef = useRef<QueryWebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputKey = useRef(0); // force re-mount textarea after send

  // ─── Fetch conversation history from API ─────────────────────────────────
  const {
    data: historyData,
    isLoading: historyLoading,
    isError: historyError,
    refetch: refetchHistory,
  } = useQuery({
    queryKey: ['queries', workspaceId, conversationId],
    queryFn: () =>
      queryApi.list(workspaceId!, {
        conversation_id: conversationId,
        page_size: 50,
      }),
    enabled: !!workspaceId && !!conversationId,
  });

  // Sync conversation history into storedQueries when data loads
  useEffect(() => {
    if (!historyData?.data) return;
    const mapped: StoredQueryDetail[] = historyData.data
      .filter((q: QuerySummary) => q.query_text)
      .map((q: QuerySummary) => ({
        queryId: q.id,
        queryText: q.query_text,
        responseText: '',
        timestamp: q.created_at,
      }));
    setStoredQueries((prev) => {
      const existingIds = new Set(prev.map((s) => s.queryId));
      const newOnes = mapped.filter((m) => !existingIds.has(m.queryId));
      return [...newOnes, ...prev].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
    });
  }, [historyData]);

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
    (queryText: string) => {
      if (!workspaceId || !queryText.trim()) return;

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
        queryId: null,
        error: null,
        status: 'complete',
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
        queryId: null,
        error: null,
        status: 'pending',
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setStreamingMessageId(assistantMsgId);
      setIsStreaming(true);

      // Update textarea key to clear
      inputKey.current += 1;

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

        onComplete: (result: { query_id: string; latency_ms: number; model_used: string; token_count: number }) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    status: 'complete' as const,
                    queryId: result.query_id,
                    latencyMs: result.latency_ms,
                    modelUsed: result.model_used,
                    tokenCount: result.token_count,
                  }
                : m,
            ),
          );
          setIsStreaming(false);
          setStreamingMessageId(null);
          setPipelinePhase(null);

          // Refetch conversation history to pick up new query
          setTimeout(() => {
            refetchHistory();
          }, 500);
        },

        onError: (code: string, message: string) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    status: 'error' as const,
                    error: { code, message },
                  }
                : m,
            ),
          );
          setIsStreaming(false);
          setStreamingMessageId(null);
          setPipelinePhase(null);
        },

        onProgress: (phase: string, _progress: number) => {
          setPipelinePhase(phase);
        },
      }, convId);

      wsRef.current = ws;
      ws.connect();
    },
    [workspaceId, conversationId, genId, refetchHistory],
  );

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
    setIsStreaming(false);
    setPipelinePhase(null);
    setStoredQueries([]);
    setHistoryOpen(null);
    setExpandedSource(null);
    setTracingBeam(null);
    setHighlightedSourceId(null);
    inputKey.current += 1;
    textareaRef.current?.focus();
  }, [isStreaming]);

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

  // ─── Delete query mutation ────────────────────────────────────────────────
  const deleteQueryMutation = useMutation({
    mutationFn: (queryId: string) =>
      queryApi.delete(workspaceId!, queryId),
    onSuccess: () => {
      addToast('Query deleted', 'success');
      refetchHistory();
    },
    onError: () => {
      addToast('Failed to delete query', 'error');
    },
  });

  // ─── Load query detail for history ────────────────────────────────────────
  const loadQueryDetail = useCallback(
    async (queryId: string) => {
      if (!workspaceId) return;
      try {
        const detail = await queryApi.get(workspaceId, queryId);
        setStoredQueries((prev) =>
          prev.map((sq) =>
            sq.queryId === queryId
              ? {
                  ...sq,
                  responseText: detail.response_text ?? '',
                }
              : sq,
          ),
        );
      } catch {
        // silently fail — detail isn't critical
      }
    },
    [workspaceId],
  );

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
  const lastAssistantMessage = [...messages]
    .reverse()
    .find((m) => m.role === 'assistant' && (m.status === 'complete' || m.status === 'error'));

  const latestSources = lastAssistantMessage?.sources ?? [];
  const latestGuardrail = lastAssistantMessage?.guardrail ?? null;
  const latestTrustScore = lastAssistantMessage?.trustScore ?? null;
  const latestTrustComponents = lastAssistantMessage?.trustComponents ?? {};

  // ─── Responsive sidebar toggle ────────────────────────────────────────────
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024;
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

      <motion.div
        className="flex h-full -m-4 lg:-m-6 relative z-10"
        {...pageTransition}
      >
        {/* ─── Chat Panel ─────────────────────────────────────────────────── */}
        <motion.div
          layout
          className="flex flex-col flex-1"
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
                      onFeedback={(rating) => {
                        if (msg.queryId) {
                          feedbackMutation.mutate({ queryId: msg.queryId, rating });
                        }
                      }}
                      onSourceClick={(source, e, msgId, index) => {
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
                  key={inputKey.current}
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
                {/* Breathing glow border */}
                <motion.div
                  className="absolute inset-0 rounded-xl pointer-events-none -z-10"
                  animate={{
                    boxShadow: [
                      '0 0 10px 2px rgba(124,92,255,0.12), inset 0 0 10px 2px rgba(124,92,255,0.03)',
                      '0 0 18px 6px rgba(124,92,255,0.22), inset 0 0 14px 4px rgba(124,92,255,0.06)',
                      '0 0 10px 2px rgba(124,92,255,0.12), inset 0 0 10px 2px rgba(124,92,255,0.03)',
                    ],
                  }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                />
              </div>
              <motion.button
                type="submit"
                disabled={!inputValue.trim() || isStreaming}
                className="shrink-0 flex items-center justify-center rounded-xl border border-primary/30 bg-primary px-4 text-white transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40 disabled:border-transparent disabled:bg-white/5"
                style={{ height: '44px', minWidth: '44px' }}
                animate={
                  inputValue.trim() && !isStreaming
                    ? {
                        boxShadow: [
                          '0 0 10px 3px rgba(124,92,255,0.3)',
                          '0 0 22px 8px rgba(124,92,255,0.45)',
                          '0 0 10px 3px rgba(124,92,255,0.3)',
                        ],
                        borderColor: 'rgba(124,92,255,0.6)',
                      }
                    : {
                        boxShadow: 'none',
                        borderColor: 'rgba(255,255,255,0.08)',
                      }
                }
                transition={{ duration: 2, repeat: inputValue.trim() && !isStreaming ? Infinity : 0, ease: 'easeInOut' }}
                whileHover={inputValue.trim() && !isStreaming ? { scale: 1.04, boxShadow: '0 0 28px 10px rgba(124,92,255,0.5)' } : {}}
                whileTap={{ scale: 0.95 }}
              >
                {isStreaming ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Send size={18} />
                )}
              </motion.button>
            </motion.form>
          </div>
        </motion.div>

        {/* ─── Evidence Sidebar ──────────────────────────────────────────── */}
        <EvidenceSidebar
          guardrail={latestGuardrail}
          trustScore={latestTrustScore}
          trustComponents={latestTrustComponents}
          isLoading={isStreaming && !pipelinePhase}
          isStreaming={isStreaming}
          sidebarOpen={effectiveSidebarOpen}
          onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
          pipelinePhase={pipelinePhase}
          isMobile={isMobile}
        />
      </motion.div>

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
              className="fixed inset-x-4 top-[10%] z-50 mx-auto max-w-2xl max-h-[70vh] overflow-y-auto rounded-2xl border border-border/40 bg-[rgba(8,11,18,0.97)] backdrop-blur-2xl shadow-2xl"
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
                    const relevancePct = Math.round((source.relevance_score || 0) * 100);
                    const confidencePct = Math.round((source.confidence ?? source.relevance_score ?? 0) * 100);
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
                          {/* Row 1: Icon + Name + Type */}
                          <div className="flex items-start gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-purple-500/20 border border-primary/20">
                              <FileText size={16} className="text-primary-soft" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium text-text truncate">{docName}</p>
                                <Badge color="gray" className="shrink-0 text-[10px]">{fileExt}</Badge>
                              </div>
                              <p className="text-xs text-text-dim mt-0.5">
                                {source.page_number ? `p. ${source.page_number}` : ''}
                                {source.updated_at ? ` · Updated ${new Date(source.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                              </p>
                            </div>
                          </div>

                          {/* Row 2: Relevance bar */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-text-dim">Relevance</span>
                              <span className={`font-medium tabular-nums ${relevancePct >= 70 ? 'text-green' : relevancePct >= 40 ? 'text-orange' : 'text-red'}`}>
                                {relevancePct}%
                              </span>
                            </div>
                            <div className="relative h-2 rounded-full bg-white/5 overflow-hidden">
                              <motion.div
                                className={`absolute inset-y-0 left-0 rounded-full ${relevancePct >= 70 ? 'bg-gradient-to-r from-green-400 to-emerald-500' : relevancePct >= 40 ? 'bg-gradient-to-r from-orange-400 to-amber-500' : 'bg-gradient-to-r from-red-400 to-rose-500'}`}
                                initial={{ width: 0 }}
                                animate={{ width: `${relevancePct}%` }}
                                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
                              />
                            </div>
                          </div>

                          {/* Row 3: Excerpt */}
                          <p className="text-xs text-text-muted leading-relaxed line-clamp-2">
                            {source.excerpt || source.text || 'No content'}
                          </p>

                          {/* Row 4: Confidence + Meta */}
                          <div className="flex items-center gap-3 text-[11px] text-text-dim">
                            <span className="flex items-center gap-1">
                              <Shield size={10} /> {confidencePct}%
                            </span>
                            {source.matched_chunks !== undefined && (
                              <span className="flex items-center gap-1">
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

function EmptyChatState({ onExampleClick }: { onExampleClick: (q: string) => void }) {
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
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CHAT MESSAGE BUBBLE
// ═══════════════════════════════════════════════════════════════════════════════

function ChatMessageBubble({
  message,
  onCopy,
  onFeedback,
  onSourceClick,
}: {
  message: ChatMessage;
  onCopy: (text: string) => void;
  onFeedback: (rating: number) => void;
  onSourceClick: (source: Source, e: React.MouseEvent, msgId: string, index: number) => void;
}) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isComplete = message.status === 'complete';
  const isError = message.status === 'error';

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
          <div className="glass rounded-2xl bg-card/60 border border-white/10 p-5 flex flex-col gap-4 shadow-xl">
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

            {/* Complete content — full card */}
            {isComplete && message.content && (
              <>
                {/* TOP: Metadata row (guardrail + trust score) */}
                <div className="flex items-center gap-3 border-b border-white/5 pb-3">
                  {message.guardrail && (
                    <GuardrailBadge guardrail={message.guardrail} />
                  )}
                  {message.trustScore !== null && (
                    <div className="flex items-center gap-2">
                      <TrustScoreRing score={message.trustScore} />
                      <span
                        className="text-xs font-medium"
                        style={{ color: message.trustScore >= 0.75 ? 'var(--color-accent)' : 'var(--color-orange)' }}
                      >
                        {trustScoreLabel(message.trustScore)}
                      </span>
                    </div>
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
                  <div className="flex items-center gap-1">
                    <motion.button
                      type="button"
                      onClick={() => onCopy(message.content)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim transition-colors hover:bg-card-2 hover:text-text"
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
                          onClick={() => onFeedback(1)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim transition-colors hover:bg-card-2 hover:text-green"
                          aria-label="Thumbs up"
                          title="Helpful"
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                        >
                          <ThumbsUp size={14} />
                        </motion.button>
                        <motion.button
                          type="button"
                          onClick={() => onFeedback(-1)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim transition-colors hover:bg-card-2 hover:text-red"
                          aria-label="Thumbs down"
                          title="Not helpful"
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                        >
                          <ThumbsDown size={14} />
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
                <div className="text-sm">
                  <p className="font-medium text-red">
                    {message.error.code === 'connection_error'
                      ? 'Connection lost'
                      : message.error.code === 'auth_error'
                        ? 'Authentication error'
                        : 'Query failed'}
                  </p>
                  <p className="mt-0.5 text-text-muted">{message.error.message}</p>
                  {message.error.code === 'connection_error' && (
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
}

// ─── Typing Indicator (bouncing dots) ─────────────────────────────────────────

function TypingIndicator() {
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
}

// ─── Citation Hover Card — shows source excerpt on hover ─────────────────────

function CitationHoverCard({ source, children }: { source: Source; children: ReactNode }) {
  const [show, setShow] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>();

  const relevancePct = Math.round((source.relevance_score || 0) * 100);
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
    clearTimeout(hoverTimer.current);
    setShow(false);
  };

  useEffect(() => () => clearTimeout(hoverTimer.current), []);

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
          className="fixed z-[70] w-80 rounded-2xl border border-glass-border bg-[#0e121d]/95 backdrop-blur-2xl shadow-2xl shadow-black/60 overflow-hidden"
          style={{ top: pos.top, left: pos.left }}
        >
          {/* Header */}
          <div className="px-4 pt-3 pb-2 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <FileText size={14} className="text-primary-soft shrink-0" />
              <span className="text-sm font-medium text-text truncate">{docName}</span>
              <span className="ml-auto text-[10px] text-text-dim tabular-nums">{relevancePct}%</span>
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
}

// ─── Render message with clickable citation markers ──────────────────────────

function renderMessageWithCitations(
  messageId: string,
  content: string,
  sources: Source[],
  onSourceClick: (source: Source, e: React.MouseEvent, msgId: string, index: number) => void,
): React.ReactNode {
  // Split on citation patterns like [1], [2], etc.
  const parts = content.split(/(\[\d+\])/g);
  // No citations — render full markdown
  if (parts.length <= 1) {
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    );
  }

  // Has citations — render text parts as markdown, citation parts as buttons
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/\[(\d+)\]/);
        if (match) {
          const idx = parseInt(match[1], 10) - 1;
          const source = sources[idx];
          if (source) {
            return (
              <CitationHoverCard key={i} source={source}>
                <motion.button
                  id={`cite-${messageId}-${idx}`}
                  type="button"
                  onClick={(e) => onSourceClick(source, e, messageId, idx)}
                  className="inline-flex items-center justify-center rounded bg-primary/20 px-1 text-xs font-medium text-primary-soft transition-colors hover:bg-primary/30 relative"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                >
                  {match[0]}
                </motion.button>
              </CitationHoverCard>
            );
          }
          return <sup key={i} className="text-primary-soft font-medium">{match[0]}</sup>;
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

function GuardrailBadge({ guardrail }: { guardrail: GuardrailResult }) {
  const claims = parseGuardrailDetails(guardrail.details);

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
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SOURCES TAB — Premium Evidence Context Panel
// ═══════════════════════════════════════════════════════════════════════════════

function getFileIcon(fileType?: string) {
  switch ((fileType ?? '').toLowerCase()) {
    case 'pdf': return <FileText size={16} className="text-red-400" />;
    case 'docx':
    case 'doc': return <FileText size={16} className="text-blue-400" />;
    case 'txt': return <FileText size={16} className="text-text-muted" />;
    default: return <FileText size={16} className="text-purple-400" />;
  }
}

function getFileTypeLabel(name?: string): string {
  if (!name) return 'DOC';
  const ext = name.split('.').pop()?.toUpperCase() ?? 'DOC';
  return ext;
}

function getQualityBadge(score: number): { label: string; color: string; icon: React.ReactNode } {
  if (score >= 0.7) return { label: 'Highly Relevant', color: 'text-green border-green/30 bg-green/10', icon: <Zap size={12} /> };
  if (score >= 0.4) return { label: 'Partial Match', color: 'text-orange border-orange/30 bg-orange/10', icon: <Flag size={12} /> };
  return { label: 'Weak Evidence', color: 'text-red border-red/30 bg-red/10', icon: <AlertCircle size={12} /> };
}

function formatConfidence(score?: number): number {
  if (score === undefined || score === null) return 0;
  return Math.round(Math.min(100, Math.max(0, score * 100)));
}

function highlightMatches(text: string, query?: string): React.ReactNode {
  if (!query || query.length < 2) return <>{text}</>;
  const words = query.split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return <>{text}</>;
  
  let result: React.ReactNode = text;
  for (const word of words) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = String(result).split(new RegExp(`(${escaped})`, 'gi'));
    if (parts.length > 1) {
      result = parts.map((part: string, i: number) =>
        part.toLowerCase() === word.toLowerCase()
          ? <mark key={i} className="rounded bg-purple-500/20 px-0.5 text-purple-200">{part}</mark>
          : part
      );
    }
  }
  return result;
}

function SourcesTab({
  sources,
  expandedSource,
  onToggleExpand,
  isLoading,
  highlightedSourceId,
}: {
  sources: Source[];
  expandedSource: string | null;
  onToggleExpand: (id: string | null) => void;
  isLoading: boolean;
  highlightedSourceId?: string | null;
}) {
  // ─── Loading State ───────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
          >
            <div className="overflow-hidden rounded-xl border border-border/40 glass">
              <div className="animate-pulse space-y-3 p-4">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-card-2" />
                  <div className="h-3 flex-1 rounded bg-card-2" />
                </div>
                <div className="h-2 w-full rounded-full bg-card-2" />
                <div className="h-2 w-3/4 rounded bg-card-2" />
                <div className="h-2 w-1/2 rounded bg-card-2" />
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    );
  }

  // ─── Empty State ─────────────────────────────────────────────────────────
  if (sources.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <motion.div
          initial={{ scale: 0, rotate: -10 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', damping: 12, stiffness: 150 }}
          className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl glass shadow-lg shadow-primary/10"
        >
          <Search size={28} className="text-primary-soft/60" />
        </motion.div>
        <motion.h4
          className="text-sm font-semibold text-text"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          No supporting evidence found
        </motion.h4>
        <motion.p
          className="mt-1 max-w-[220px] text-xs text-text-dim"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          Sources will appear after you ask a question.
        </motion.p>
        <motion.div
          className="mt-4 space-y-1.5 text-left"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
        >
          {[
            'Rephrase your question',
            'Upload more documents',
            'Search with broader terms',
          ].map((tip) => (
            <div key={tip} className="flex items-center gap-2 text-[11px] text-text-dim">
              <div className="h-1 w-1 rounded-full bg-primary-soft/40" />
              {tip}
            </div>
          ))}
        </motion.div>
      </div>
    );
  }

  const visibleSources = sources.slice(0, expandedSource ? sources.length : INITIAL_SOURCES_SHOWN);
  const hasMore = sources.length > INITIAL_SOURCES_SHOWN && !expandedSource;

  return (
    <motion.div
      className="space-y-2 p-3"
      variants={staggerContainer}
      initial="initial"
      animate="animate"
    >
      {/* Header count */}
      <motion.div
        className="flex items-center justify-between px-1 pb-1"
        variants={staggerItem}
      >
        <span className="text-xs font-medium text-text-muted">
          {sources.length} source{sources.length !== 1 ? 's' : ''} retrieved
        </span>
        <span className="text-[10px] text-text-dim">
          Sorted by relevance
        </span>
      </motion.div>

      <div className="space-y-2.5">
        {visibleSources.map((source, idx) => {
          const isExpanded = expandedSource === source.chunk_id;
          const pct = Math.round((source.relevance_score ?? 0) * 100);
          const conf = formatConfidence(source.confidence ?? source.relevance_score);
          const quality = getQualityBadge(source.relevance_score ?? 0);
          const docName = source.document_name || `Document ${source.document_id.slice(0, 8)}`;
          const fileType = source.file_type || getFileTypeLabel(source.document_name);

          return (
            <motion.div
              key={source.chunk_id}
              variants={staggerItem}
              layout
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] as const }}
            >
              <motion.div
                id={`source-${source.chunk_id}`}
                className={clsx(
                  'group relative overflow-hidden rounded-xl border transition-all duration-300',
                  isExpanded
                    ? 'border-purple-500/40 shadow-[0_0_20px_rgba(168,85,247,0.12)]'
                    : highlightedSourceId === source.chunk_id
                      ? 'border-accent shadow-[0_0_15px_rgba(45,212,191,0.2)]'
                      : 'border-border/40 hover:border-purple-500/25',
                  'glass backdrop-blur-xl',
                )}
                whileHover={{ y: -2, transition: { duration: 0.2 } }}
              >
                {/* Glow sweep on highlight */}
                {highlightedSourceId === source.chunk_id && (
                  <div className="pointer-events-none absolute inset-0 animate-glow-sweep mix-blend-screen" />
                )}

                {/* Gradient border overlay on hover */}
                <div className="pointer-events-none absolute inset-0 rounded-xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  style={{
                    background: 'linear-gradient(135deg, rgba(168,85,247,0.08) 0%, transparent 50%)',
                  }}
                />

                <div className="relative z-10 space-y-3 p-3.5">
                  {/* ─── Row 1: Icon + Name + Badge ──────────────────────── */}
                  <div className="flex items-start gap-2.5">
                    {/* File type icon with glass bg */}
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-card-2/80 ring-1 ring-border/30">
                      {getFileIcon(fileType)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="truncate text-sm font-medium text-text">
                          {docName}
                        </h4>
                        <span className="shrink-0 rounded-md bg-card-2/60 px-1.5 py-0.5 text-[10px] font-mono font-medium text-text-dim ring-1 ring-border/20">
                          {fileType}
                        </span>
                      </div>

                      {/* Confidence + matched chunks row */}
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-text-dim">
                        <span className="flex items-center gap-1">
                          <Shield size={11} className="text-primary-soft/70" />
                          Confidence: <span className={clsx('font-semibold', conf >= 70 ? 'text-green' : conf >= 40 ? 'text-orange' : 'text-red')}>{conf}%</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <Pin size={11} className="text-accent/70" />
                          Chunks: {source.matched_chunks ?? 1}
                        </span>
                        {source.updated_at && (
                          <span className="flex items-center gap-1">
                            <Clock size={11} className="text-text-dim/70" />
                            {new Date(source.updated_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* ─── Row 2: Animated Relevance Bar ───────────────────── */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-text-dim">Relevance</span>
                      <span className={clsx(
                        'font-semibold font-mono',
                        pct >= 70 ? 'text-accent' : pct >= 40 ? 'text-orange' : 'text-red'
                      )}>
                        {pct}%
                      </span>
                    </div>
                    <div className="relative h-2 overflow-hidden rounded-full bg-card-2">
                      <motion.div
                        className="h-full rounded-full"
                        style={{
                          background: pct >= 70
                            ? 'linear-gradient(90deg, #a855f7, #3b82f6)'
                            : pct >= 40
                              ? 'linear-gradient(90deg, #f59e0b, #f97316)'
                              : 'linear-gradient(90deg, #ef4444, #f97316)',
                        }}
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] as const }}
                      />
                      {/* Pulse glow */}
                      <motion.div
                        className="absolute inset-y-0 right-0 w-4 rounded-full"
                        style={{
                          background: 'linear-gradient(90deg, transparent, rgba(168,85,247,0.4))',
                          filter: 'blur(4px)',
                          right: `${100 - pct}%`,
                        }}
                        animate={{ opacity: [0, 0.8, 0] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                      />
                    </div>
                  </div>

                  {/* ─── Row 3: Quality Badge ────────────────────────────── */}
                  <div className={clsx(
                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium',
                    quality.color
                  )}>
                    {quality.icon}
                    {quality.label}
                  </div>

                  {/* ─── Row 4: Excerpt with highlighting ────────────────── */}
                  <div className="relative">
                    <div className={clsx(
                      'overflow-hidden rounded-lg border border-border/20 bg-bg-soft/40',
                      isExpanded ? 'max-h-96' : 'max-h-[72px]'
                    )}>
                      <p className="px-2.5 py-2 text-xs leading-relaxed text-text-muted font-[family-name:var(--font-mono,monospace)]">
                        {isExpanded
                          ? highlightMatches(source.excerpt, '')
                          : highlightMatches(source.excerpt.slice(0, 200), '')}
                        {!isExpanded && source.excerpt.length > 200 && '…'}
                      </p>
                    </div>

                    {/* Expand / collapse */}
                    {source.excerpt.length > 200 && (
                      <motion.button
                        type="button"
                        onClick={() => onToggleExpand(isExpanded ? null : source.chunk_id)}
                        className="mt-1 flex items-center gap-1 text-[10px] font-medium text-primary-soft/70 transition-colors hover:text-primary-soft"
                        whileHover={{ x: 2 }}
                      >
                        {isExpanded ? 'Show less' : 'Show more'}
                        <ChevronDown
                          size={12}
                          className={clsx('transition-transform', isExpanded && 'rotate-180')}
                        />
                      </motion.button>
                    )}
                  </div>

                  {/* ─── Row 5: AI Explanation ───────────────────────────── */}
                  {source.explanation && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="rounded-lg border border-purple-500/15 bg-purple-500/5 px-2.5 py-2"
                    >
                      <div className="flex items-start gap-2">
                        <Brain size={12} className="mt-0.5 shrink-0 text-purple-400" />
                        <div>
                          <p className="text-[10px] font-medium text-purple-300">Why this source was used</p>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-text-dim">
                            {source.explanation}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* ─── Row 6: Action Buttons ───────────────────────────── */}
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <motion.button
                      type="button"
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-text-dim transition-colors hover:bg-card-2 hover:text-text"
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      title="View document"
                    >
                      <Eye size={12} />
                      View
                    </motion.button>
                    <motion.button
                      type="button"
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-text-dim transition-colors hover:bg-card-2 hover:text-text"
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      title="View match location"
                    >
                      <ExternalLink size={12} />
                      Match
                    </motion.button>
                    <motion.button
                      type="button"
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-text-dim transition-colors hover:bg-card-2 hover:text-primary-soft"
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      title="Copy citation"
                      onClick={() => {
                        const citation = `[${docName}] (Confidence: ${conf}%) — "${source.excerpt.slice(0, 100)}..."`;
                        navigator.clipboard.writeText(citation).catch(() => {});
                      }}
                    >
                      <Quote size={12} />
                      Cite
                    </motion.button>

                    {/* Page number */}
                    {source.page_number != null && (
                      <span className="ml-auto text-[10px] text-text-dim">
                        p.{source.page_number}
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          );
        })}
      </div>

      {/* Show all button */}
      {hasMore && (
        <motion.button
          type="button"
          onClick={() => onToggleExpand('__all__')}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl glass px-3 py-2.5 text-xs text-text-muted transition-all hover:border-primary/20 hover:bg-card-hover hover:text-text hover:shadow-lg hover:shadow-primary/5"
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          variants={staggerItem}
        >
          Show all {sources.length} sources
          <ChevronDown size={14} />
        </motion.button>
      )}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WHY THIS ANSWER TAB
// ═══════════════════════════════════════════════════════════════════════════════

function WhyThisAnswerTab({
  guardrail,
  trustScore,
  trustComponents,
  isLoading,
}: {
  guardrail: GuardrailResult | null;
  trustScore: number | null;
  trustComponents: Record<string, number>;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton height={80} width="100%" />
        <Skeleton height={120} width="100%" />
      </div>
    );
  }

  if (trustScore === null && !guardrail) {
    return (
      <div className="p-4">
        <EmptyState
          icon={<Brain size={24} />}
          title="No analysis yet"
          description="Trust score and guardrail analysis will appear here after you ask a question."
        />
      </div>
    );
  }

  const componentLabels: Record<string, string> = {
    retrieval_quality: 'Retrieval quality',
    faithfulness: 'Faithfulness',
    relevance: 'Relevance',
    source_authority: 'Source authority',
  };

  const componentEntries = Object.entries(trustComponents).filter(
    ([key]) => key in componentLabels || key !== 'overall',
  );

  return (
    <motion.div
      className="space-y-6 p-4"
      variants={staggerContainer}
      initial="initial"
      animate="animate"
    >
      {/* Overall trust score ring */}
      {trustScore !== null && (
        <motion.div className="text-center" variants={staggerItem}>
          <div className="relative mx-auto flex h-24 w-24 items-center justify-center">
            {/* Animated SVG ring */}
            <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 100 100">
              {/* Background circle */}
              <circle
                cx="50" cy="50" r="42"
                fill="none"
                stroke="rgba(60,75,110,0.3)"
                strokeWidth="6"
                strokeLinecap="round"
              />
              {/* Foreground animated arc */}
              <motion.circle
                cx="50" cy="50" r="42"
                fill="none"
                stroke={trustScore >= 0.75 ? '#34d399' : trustScore >= 0.5 ? '#fb923c' : '#f87171'}
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 42}`}
                initial={{ strokeDashoffset: 2 * Math.PI * 42 }}
                animate={{ strokeDashoffset: 2 * Math.PI * 42 * (1 - trustScore) }}
                transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] as const }}
              />
            </svg>
            {/* Score text */}
            <motion.span
              className={clsx(
                'text-2xl font-bold',
                trustScore >= 0.75
                  ? 'text-green'
                  : trustScore >= 0.5
                    ? 'text-orange'
                    : 'text-red',
              )}
              initial={{ opacity: 0.99, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3, type: 'spring', damping: 10 }}
            >
              {(trustScore * 100).toFixed(0)}
            </motion.span>
          </div>
          <motion.p
            className="mt-2 text-sm font-medium text-text"
            initial={{ opacity: 0.99 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            {trustScoreLabel(trustScore)}
          </motion.p>
          <motion.p
            className="text-xs text-text-muted"
            initial={{ opacity: 0.99 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45 }}
          >
            Overall trust score
          </motion.p>
        </motion.div>
      )}

      {/* Component breakdown */}
      {componentEntries.length > 0 && (
        <motion.div className="space-y-3" variants={staggerItem}>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Score breakdown
          </h4>
          {componentEntries.map(([key, value]) => (
            <motion.div
              key={key}
              className="space-y-1"
              initial={{ opacity: 0.99, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">
                  {componentLabels[key] ?? key.replace(/_/g, ' ')}
                </span>
                <span
                  className={clsx(
                    'font-medium',
                    value >= 0.75
                      ? 'text-green'
                      : value >= 0.5
                        ? 'text-orange'
                        : 'text-red',
                  )}
                >
                  {(value * 100).toFixed(0)}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-card-2">
                <motion.div
                  className={clsx(
                    'h-full rounded-full',
                    value >= 0.75
                      ? 'bg-green'
                      : value >= 0.5
                        ? 'bg-orange'
                        : 'bg-red',
                  )}
                  initial={{ width: 0 }}
                  animate={{ width: `${value * 100}%` }}
                  transition={{ duration: 0.8, delay: 0.3, ease: [0.16, 1, 0.3, 1] as const }}
                />
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Guardrail result */}
      {guardrail && (
        <motion.div className="space-y-3" variants={staggerItem}>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Guardrail check
          </h4>
          <GuardrailBadge guardrail={guardrail} />
        </motion.div>
      )}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CONVERSATION HISTORY TAB
// ═══════════════════════════════════════════════════════════════════════════════

function ConversationHistoryTab({
  queries,
  historyLoading,
  historyError,
  onRetry,
  onSelect,
  historyOpen,
  onDelete,
  isDeleting,
  conversationId,
}: {
  queries: StoredQueryDetail[];
  historyLoading: boolean;
  historyError: boolean;
  onRetry: () => void;
  onSelect: (queryId: string) => void;
  historyOpen: string | null;
  onDelete: (queryId: string) => void;
  isDeleting: boolean;
  conversationId: string | null;
}) {
  if (historyLoading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0.99, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
          >
            <Skeleton height={60} width="100%" />
          </motion.div>
        ))}
      </div>
    );
  }

  if (historyError) {
    return (
      <div className="p-4">
        <motion.div
          className="flex flex-col items-center justify-center py-8 text-center"
          initial={{ opacity: 0.99 }}
          animate={{ opacity: 1 }}
        >
          <AlertCircle size={20} className="mb-2 text-red" />
          <p className="text-sm text-text-muted">Failed to load history</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
            Try again
          </Button>
        </motion.div>
      </div>
    );
  }

  if (!conversationId) {
    return (
      <div className="p-4">
        <EmptyState
          icon={<MessageSquare size={24} />}
          title="No conversation yet"
          description="Start a conversation to see your history here."
        />
      </div>
    );
  }

  if (queries.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          icon={<MessageSquare size={24} />}
          title="No queries yet"
          description="Ask a question to begin."
        />
      </div>
    );
  }

  return (
    <motion.div
      className="space-y-1 p-4"
      variants={staggerContainer}
      initial="initial"
      animate="animate"
    >
      <motion.p className="mb-2 text-xs font-medium text-text-muted" variants={staggerItem}>
        {queries.length} quer{queries.length === 1 ? 'y' : 'ies'}
      </motion.p>
      <AnimatePresence>
        {queries.map((q) => {
          const isOpen = historyOpen === q.queryId;
          return (
            <motion.div
              key={q.queryId}
              variants={staggerItem}
              layout
              transition={{ duration: 0.3 }}
            >
              <motion.button
                type="button"
                onClick={() => onSelect(q.queryId)}
                className={clsx(
                  'flex w-full items-start gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition-colors',
                  isOpen
                    ? 'bg-primary/10 text-text border border-primary/20'
                    : 'text-text-muted hover:bg-card-2 hover:text-text border border-transparent',
                )}
                whileHover={{ x: 2 }}
                whileTap={{ scale: 0.99 }}
              >
                <MessageSquare size={14} className="mt-0.5 shrink-0" />
                <span className="line-clamp-2 flex-1">{q.queryText}</span>
                <span className="shrink-0 text-[10px] text-text-dim">
                  {formatTimestamp(q.timestamp)}
                </span>
              </motion.button>

              {/* Expanded detail */}
              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    initial={{ opacity: 0.99, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] as const }}
                    className="overflow-hidden"
                  >
                    <div className="ml-7 space-y-2 border-l-2 border-border/60 pl-4 pb-2 pt-1">
                      {q.responseText ? (
                        <motion.p
                          className="text-xs leading-relaxed text-text-muted line-clamp-3"
                          initial={{ opacity: 0.99 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 0.1 }}
                        >
                          {q.responseText}
                        </motion.p>
                      ) : (
                        <motion.p
                          className="text-xs text-text-dim italic"
                          initial={{ opacity: 0.99 }}
                          animate={{ opacity: 1 }}
                        >
                          Loading response…
                        </motion.p>
                      )}
                      <div className="flex items-center gap-2">
                        <motion.button
                          type="button"
                          onClick={() => onDelete(q.queryId)}
                          disabled={isDeleting}
                          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-red transition-colors hover:bg-red/15"
                          aria-label={`Delete query: ${q.queryText}`}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                        >
                          <Trash2 size={12} />
                          Delete
                        </motion.button>
                        {q.responseText && (
                          <motion.button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(q.responseText).catch(() => {});
                            }}
                            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-text-muted transition-colors hover:bg-card-2"
                            aria-label="Copy response"
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                          >
                            <Copy size={12} />
                            Copy
                          </motion.button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TRUST SCORE RING (Answer Verification Sequence)
// ═══════════════════════════════════════════════════════════════════════════════

function TrustScoreRing({ score }: { score: number }) {
  const [complete, setComplete] = useState(false);
  const size = 32;
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score);
  
  const isHigh = score >= 0.75;
  const color = isHigh ? 'var(--color-accent)' : 'var(--color-orange)';

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="shrink-0 -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(60,75,110,0.3)"
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
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TRACE BEAM OVERLAY (Citation Trace Beam)
// ═══════════════════════════════════════════════════════════════════════════════

function TraceBeamOverlay({ 
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
}
