import { useState, useCallback, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Brain,
  Network,
  FileSearch,
  ChevronDown,
  ChevronUp,
  Clock,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  Loader2,
} from 'lucide-react';
import {
  Button,
  TextArea,
  Card,
  Badge,
  Skeleton,
  useToast,
  fadeIn,
  fadeInUp,
  fadeInScale,
  staggerContainer,
  staggerItem,
  pageTransition,
} from '../components/ui';
import { investigationApi } from '../api/client';
import type { InvestigationResponse } from '../api/types';

// ─── Constants ───────────────────────────────────────────────────────────────

const EXAMPLE_QUESTIONS = [
  'Compare and contrast the main topics in my documents',
  'What are the key findings and their implications?',
  'Analyze the trends and patterns across my data',
];

const DEFAULT_TOP_K = 10;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function trustScoreLabel(score: number): string {
  if (score >= 0.75) return 'High confidence';
  if (score >= 0.5) return 'Medium confidence';
  return 'Low confidence';
}

function trustScoreBarColor(score: number): string {
  if (score >= 0.75) return 'bg-green';
  if (score >= 0.5) return 'bg-orange';
  return 'bg-red';
}

// ─── Circular gauge SVG ──────────────────────────────────────────────────────

function CircularGauge({ score, size = 80 }: { score: number; size?: number }) {
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score);
  const color =
    score >= 0.75 ? '#34d399' : score >= 0.5 ? '#fb923c' : '#f87171';

  return (
    <svg width={size} height={size} className="shrink-0" role="img" aria-label={`Trust score ${(score * 100).toFixed(0)}%`}>
      {/* Background ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgba(60,75,110,0.3)"
        strokeWidth={strokeWidth}
      />
      {/* Animated foreground ring */}
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
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] as const }}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      {/* Score text */}
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fill={color}
        fontSize={size * 0.3}
        fontWeight={700}
        fontFamily="'Inter', sans-serif"
      >
        {(score * 100).toFixed(0)}
      </text>
    </svg>
  );
}

// ─── Preserve whitespace / line breaks in report text ────────────────────────

function renderReportText(text: string): React.ReactNode {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    const trimmed = line.trim();

    // Markdown heading ## or ###
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      const headingSizes: Record<number, string> = {
        1: 'text-lg font-bold text-text mt-6 mb-2',
        2: 'text-base font-semibold text-text mt-5 mb-2',
        3: 'text-sm font-semibold text-text mt-4 mb-1',
      };
      return (
        <h3
          key={i}
          className={headingSizes[level] ?? 'text-base font-semibold text-text mt-4 mb-2'}
        >
          {content}
        </h3>
      );
    }

    // Bullet list
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      return (
        <li key={i} className="ml-4 list-disc text-sm leading-relaxed text-text-muted">
          {trimmed.slice(2)}
        </li>
      );
    }

    // Numbered list
    const numberedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (numberedMatch) {
      return (
        <li key={i} className="ml-4 list-decimal text-sm leading-relaxed text-text-muted">
          {numberedMatch[1]}
        </li>
      );
    }

    // Empty line → spacing
    if (!trimmed) {
      return <div key={i} className="h-2" />;
    }

    // Regular paragraph
    return (
      <p key={i} className="text-sm leading-relaxed text-text-muted">
        {trimmed}
      </p>
    );
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN PAGE COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function InvestigationPage() {
  const { id: workspaceId } = useParams<{ id: string }>();
  const { addToast } = useToast();

  // ─── State ────────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(DEFAULT_TOP_K);
  const [result, setResult] = useState<InvestigationResponse | null>(null);
  const [reasoningExpanded, setReasoningExpanded] = useState(false);

  // ─── Mutation ─────────────────────────────────────────────────────────────
  const investigationMutation = useMutation({
    mutationFn: () =>
      investigationApi.run(workspaceId!, {
        query: query.trim(),
        top_k: topK,
      }),
    onSuccess: (data) => {
      setResult(data);
    },
    onError: (err: Error) => {
      addToast(err.message || 'Investigation failed', 'error');
      setResult({
        final_report: '',
        latency_ms: 0,
        error: err.message || 'An unexpected error occurred',
      });
    },
  });

  // ─── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      if (!query.trim() || !workspaceId) return;
      setResult(null);
      setReasoningExpanded(false);
      investigationMutation.mutate();
    },
    [query, workspaceId, investigationMutation],
  );

  // ─── Click example ─────────────────────────────────────────────────────────
  const handleExampleClick = useCallback(
    (question: string) => {
      setQuery(question);
      setResult(null);
    },
    [],
  );

  // ─── Status helpers ────────────────────────────────────────────────────────
  const isLoading = investigationMutation.isPending;
  const isError = investigationMutation.isError && !!result?.error;
  const isComplete = result && !isLoading && !isError && !result.error;

  return (
    <motion.div
      className="mx-auto max-w-4xl space-y-6 relative"
      variants={pageTransition}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {/* Ambient blobs */}
      <div className="ambient-blob ambient-blob-1" aria-hidden="true" />
      <div className="ambient-blob ambient-blob-2" aria-hidden="true" />

      {/* ─── Header ────────────────────────────────────────────────────── */}
      <motion.div className="space-y-2" variants={fadeInUp}>
        <div className="flex items-center gap-3">
          <motion.div
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 shadow-lg shadow-primary/5"
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', damping: 15, stiffness: 200, delay: 0.05 }}
          >
            <Network size={22} className="text-primary-soft" />
          </motion.div>
          <div>
            <h1 className="text-xl font-bold gradient-text">Investigation</h1>
            <p className="text-sm text-text-muted">
              Multi-step research that decomposes complex questions, gathers evidence, and synthesises findings.
            </p>
          </div>
        </div>
      </motion.div>

      {/* ─── Input Section ─────────────────────────────────────────────── */}
      <motion.div variants={fadeInScale}>
        <Card className="space-y-4 p-4 lg:p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <TextArea
              placeholder="Ask a complex research question..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rows={4}
              disabled={isLoading}
              className="min-h-[120px] text-base"
            />

            {/* Top-k + submit row */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-text-muted">
                  <span>Top sources:</span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={topK}
                    onChange={(e) => setTopK(Math.max(1, Math.min(50, Number(e.target.value) || DEFAULT_TOP_K)))}
                    disabled={isLoading}
                    className="w-16 rounded-md border border-border bg-bg-soft px-2 py-1.5 text-sm text-text transition-colors focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                    aria-label="Number of top sources"
                  />
                </label>
              </div>

              <Button
                type="submit"
                size="lg"
                disabled={!query.trim() || isLoading}
                loading={isLoading}
                className="w-full sm:w-auto"
              >
                {isLoading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Investigating...
                  </>
                ) : (
                  <>
                    <Search size={18} />
                    Investigate
                  </>
                )}
              </Button>
            </div>
          </form>

          {/* Example chips */}
          {!result && !isLoading && (
            <motion.div
              className="flex flex-wrap gap-2 pt-2 border-t border-border"
              variants={fadeIn}
            >
              <span className="flex items-center gap-1 text-xs text-text-dim">
                <Sparkles size={12} />
                Try:
              </span>
              {EXAMPLE_QUESTIONS.map((q) => (
                <motion.button
                  key={q}
                  type="button"
                  onClick={() => handleExampleClick(q)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card-2 px-3 py-1 text-xs text-text-muted transition-colors hover:border-primary/30 hover:text-primary-soft"
                  whileHover={{ scale: 1.04, y: -1 }}
                  whileTap={{ scale: 0.96 }}
                >
                  <FileSearch size={12} />
                  {q}
                </motion.button>
              ))}
            </motion.div>
          )}
        </Card>
      </motion.div>

      {/* ─── Loading State ────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {isLoading && (
          <motion.div
            key="loading"
            className="space-y-6"
            variants={fadeIn}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {/* Progress indicator */}
            <Card className="p-6 text-center">
              <motion.div
                className="flex items-center justify-center gap-3"
                initial={{ opacity: 0.99, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
              >
                <div className="flex items-center gap-1">
                  <motion.span
                    className="h-2.5 w-2.5 rounded-full bg-primary-soft"
                    animate={{ opacity: [0.4, 1, 0.4], scale: [0.8, 1, 0.8] }}
                    transition={{ duration: 1.4, repeat: Infinity, delay: 0 }}
                  />
                  <motion.span
                    className="h-2.5 w-2.5 rounded-full bg-primary-soft"
                    animate={{ opacity: [0.4, 1, 0.4], scale: [0.8, 1, 0.8] }}
                    transition={{ duration: 1.4, repeat: Infinity, delay: 0.2 }}
                  />
                  <motion.span
                    className="h-2.5 w-2.5 rounded-full bg-primary-soft"
                    animate={{ opacity: [0.4, 1, 0.4], scale: [0.8, 1, 0.8] }}
                    transition={{ duration: 1.4, repeat: Infinity, delay: 0.4 }}
                  />
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-text">Investigating...</p>
                  <p className="text-xs text-text-muted">
                    Decomposing question, searching sources, synthesising findings
                  </p>
                </div>
              </motion.div>

              {/* Progress bar */}
              <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-card-2">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-primary via-accent to-primary"
                  initial={{ x: '-100%' }}
                  animate={{ x: '100%' }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                  style={{ width: '60%' }}
                />
              </div>
            </Card>

            {/* Skeleton previews */}
            <motion.div
              className="space-y-4"
              variants={staggerContainer}
              initial="initial"
              animate="animate"
            >
              <motion.div variants={staggerItem}>
                <Skeleton height={200} width="100%" />
              </motion.div>
              <div className="grid gap-4 sm:grid-cols-2">
                <motion.div variants={staggerItem}>
                  <Skeleton height={120} width="100%" />
                </motion.div>
                <motion.div variants={staggerItem}>
                  <Skeleton height={120} width="100%" />
                </motion.div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Results Section ──────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {(isComplete || isError) && result && (
          <motion.div
            key="results"
            className="space-y-6"
            variants={staggerContainer}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {/* Final Report */}
            {!result.error && result.final_report && (
              <motion.div variants={staggerItem}>
                <FinalReportCard report={result.final_report} />
              </motion.div>
            )}

            {/* Error Card */}
            {result.error && (
              <motion.div variants={staggerItem}>
                <ErrorCard
                  message={result.error}
                  onRetry={() => investigationMutation.mutate()}
                  isRetrying={isLoading}
                />
              </motion.div>
            )}

            {/* Sub-questions */}
            {result.sub_questions && result.sub_questions.length > 0 && (
              <motion.div variants={staggerItem}>
                <SubQuestionsSection questions={result.sub_questions} />
              </motion.div>
            )}

            {/* Reasoning trace */}
            {result.reasoning_trace && result.reasoning_trace.length > 0 && (
              <motion.div variants={staggerItem}>
                <ReasoningTraceSection
                  trace={result.reasoning_trace}
                  expanded={reasoningExpanded}
                  onToggle={() => setReasoningExpanded((prev) => !prev)}
                />
              </motion.div>
            )}

            {/* Trust score */}
            {result.trust_score !== undefined && result.trust_score !== null && (
              <motion.div variants={staggerItem}>
                <TrustScoreSection
                  score={result.trust_score}
                  components={result.trust_components ?? {}}
                />
              </motion.div>
            )}

            {/* Metadata footer */}
            <motion.div variants={staggerItem}>
              <MetadataFooter
                latencyMs={result.latency_ms}
                error={result.error}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Empty Welcome (no query, no loading, no result) ──────────── */}
      <AnimatePresence mode="wait">
        {!query && !isLoading && !result && (
          <motion.div
            key="welcome"
            variants={fadeInUp}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <WelcomeEmptyState onExampleClick={handleExampleClick} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WELCOME EMPTY STATE
// ═══════════════════════════════════════════════════════════════════════════════

function WelcomeEmptyState({ onExampleClick }: { onExampleClick: (q: string) => void }) {
  return (
    <motion.div
      className="flex flex-col items-center justify-center py-12 text-center"
      variants={staggerContainer}
      initial="initial"
      animate="animate"
    >
      <motion.div
        className="mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 shadow-lg shadow-primary/5"
        variants={staggerItem}
      >
        <Network size={36} className="text-primary-soft" />
      </motion.div>
      <motion.h2
        className="text-xl font-bold gradient-text"
        variants={staggerItem}
      >
        Deep research engine
      </motion.h2>
      <motion.p
        className="mt-2 max-w-lg text-sm text-text-muted"
        variants={staggerItem}
      >
        Ask a complex question and the investigation agent will decompose it into sub-questions,
        search across your documents, and synthesise a final report with confidence scoring.
      </motion.p>

      {/* Feature highlights */}
      <motion.div
        className="mt-8 grid grid-cols-3 gap-6 text-center"
        variants={staggerItem}
      >
        <motion.div
          className="space-y-2"
          whileHover={{ y: -4 }}
          transition={{ duration: 0.3 }}
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-card-2 text-accent">
            <Brain size={22} />
          </div>
          <p className="text-xs font-medium text-text">Decomposition</p>
          <p className="text-[11px] text-text-dim">Breaks down complex queries</p>
        </motion.div>
        <motion.div
          className="space-y-2"
          whileHover={{ y: -4 }}
          transition={{ duration: 0.3 }}
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-card-2 text-primary-soft">
            <FileSearch size={22} />
          </div>
          <p className="text-xs font-medium text-text">Deep search</p>
          <p className="text-[11px] text-text-dim">Multi-source evidence</p>
        </motion.div>
        <motion.div
          className="space-y-2"
          whileHover={{ y: -4 }}
          transition={{ duration: 0.3 }}
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-card-2 text-gold">
            <CheckCircle2 size={22} />
          </div>
          <p className="text-xs font-medium text-text">Synthesis</p>
          <p className="text-[11px] text-text-dim">Coherent final report</p>
        </motion.div>
      </motion.div>

      <motion.div
        className="mt-8 flex flex-wrap justify-center gap-2"
        variants={staggerItem}
      >
        {EXAMPLE_QUESTIONS.map((q) => (
          <motion.button
            key={q}
            type="button"
            onClick={() => onExampleClick(q)}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm text-text-muted transition-colors duration-200 hover:border-primary/30 hover:bg-card-2 hover:text-text"
            whileHover={{ scale: 1.04, y: -2 }}
            whileTap={{ scale: 0.96 }}
          >
            <Sparkles size={14} className="text-primary-soft" />
            {q}
          </motion.button>
        ))}
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FINAL REPORT CARD
// ═══════════════════════════════════════════════════════════════════════════════

function FinalReportCard({ report }: { report: string }) {
  return (
    <motion.div variants={fadeInScale}>
      <Card className="space-y-3 p-4 lg:p-6 overflow-hidden">
        <motion.div
          className="flex items-center gap-2 border-b border-border pb-3"
          variants={fadeIn}
        >
          <motion.div
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary-soft"
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Sparkles size={18} />
          </motion.div>
          <h2 className="text-base font-semibold text-text">Final Report</h2>
        </motion.div>
        <motion.div
          className="prose-custom space-y-1"
          variants={staggerContainer}
          initial="initial"
          animate="animate"
        >
          {renderReportText(report)}
        </motion.div>
      </Card>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ERROR CARD
// ═══════════════════════════════════════════════════════════════════════════════

function ErrorCard({
  message,
  onRetry,
  isRetrying,
}: {
  message: string;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  return (
    <motion.div variants={fadeInScale}>
      <Card className="border-red/30 bg-red/5 p-6 text-center">
        <motion.div
          className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red/15 text-red"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', damping: 12, stiffness: 180 }}
        >
          <AlertCircle size={28} />
        </motion.div>
        <motion.h3
          className="text-lg font-semibold text-text"
          variants={fadeIn}
        >
          Investigation failed
        </motion.h3>
        <motion.p
          className="mt-2 text-sm text-text-muted"
          variants={fadeIn}
        >
          {message}
        </motion.p>
        <motion.div variants={fadeIn} className="mt-6">
          <Button
            variant="secondary"
            onClick={onRetry}
            loading={isRetrying}
          >
            <Search size={16} />
            Retry investigation
          </Button>
        </motion.div>
      </Card>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SUB-QUESTIONS SECTION
// ═══════════════════════════════════════════════════════════════════════════════

function SubQuestionsSection({ questions }: { questions: string[] }) {
  return (
    <motion.div variants={fadeInScale}>
      <Card className="space-y-3 p-4 lg:p-6">
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <Brain size={18} />
          </div>
          <h2 className="text-base font-semibold text-text">
            Sub-questions ({questions.length})
          </h2>
        </div>

        <motion.div
          className="space-y-2"
          variants={staggerContainer}
          initial="initial"
          animate="animate"
        >
          {questions.map((question, i) => (
            <motion.div
              key={i}
              className="flex items-start gap-3 rounded-lg border border-border bg-card-2 p-3 transition-colors hover:border-primary/20"
              variants={staggerItem}
              whileHover={{ x: 4 }}
              transition={{ duration: 0.2 }}
            >
              <motion.span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-medium text-primary-soft"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: i * 0.05, type: 'spring', damping: 12 }}
              >
                {i + 1}
              </motion.span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text">{question}</p>
              </div>
              <Badge color="green" className="shrink-0">
                Researched
              </Badge>
            </motion.div>
          ))}
        </motion.div>
      </Card>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  REASONING TRACE SECTION
// ═══════════════════════════════════════════════════════════════════════════════

function ReasoningTraceSection({
  trace,
  expanded,
  onToggle,
}: {
  trace: string[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <motion.div variants={fadeInScale}>
      <Card className="space-y-3 p-4 lg:p-6">
        <motion.button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-2"
          aria-expanded={expanded}
          whileHover={{ opacity: 0.8 }}
          transition={{ duration: 0.2 }}
        >
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold/15 text-gold">
              <Network size={18} />
            </div>
            <h2 className="text-base font-semibold text-text">
              Reasoning trace ({trace.length} steps)
            </h2>
          </div>
          <motion.div
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] as const }}
          >
            {expanded ? (
              <ChevronUp size={18} className="text-text-muted" />
            ) : (
              <ChevronDown size={18} className="text-text-muted" />
            )}
          </motion.div>
        </motion.button>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="trace-content"
              className="space-y-3 overflow-hidden"
              initial={{ height: 0, opacity: 0.99 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0.99 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] as const }}
            >
              <motion.div
                className="space-y-3 pt-1"
                variants={staggerContainer}
                initial="initial"
                animate="animate"
              >
                {trace.map((step, i) => (
                  <motion.div 
                    key={i} 
                    initial={{ opacity: 0.99, y: 12 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-10px" }}
                    transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] as const }}
                  >
                    <ReasoningStep index={i} step={step} />
                  </motion.div>
                ))}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
}

function ReasoningStep({ index, step }: { index: number; step: string }) {
  const [stepExpanded, setStepExpanded] = useState(false);

  const lines = step.split('\n').filter((l) => l.trim());
  const firstLine = lines[0] ?? '';
  const isStructured = firstLine.match(/^(Node|Step|Agent|Tool):/i);

  return (
    <motion.div
      className="rounded-lg border border-border bg-bg-soft overflow-hidden"
      whileHover={{ borderColor: 'rgba(124,92,255,0.3)' }}
      transition={{ duration: 0.2 }}
    >
      <motion.button
        type="button"
        onClick={() => setStepExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-card-2"
        aria-expanded={stepExpanded}
        whileHover={{ backgroundColor: 'rgba(26,35,55,0.8)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <motion.span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-medium text-primary-soft"
            animate={stepExpanded ? { scale: [1, 1.2, 1] } : {}}
            transition={{ duration: 0.3 }}
          >
            {index + 1}
          </motion.span>
          <span className="truncate text-xs font-medium text-text">
            {isStructured ? firstLine : `Step ${index + 1}`}
          </span>
        </div>
        <motion.div
          animate={{ rotate: stepExpanded ? 180 : 0 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] as const }}
        >
          {stepExpanded ? (
            <ChevronUp size={14} className="shrink-0 text-text-dim" />
          ) : (
            <ChevronDown size={14} className="shrink-0 text-text-dim" />
          )}
        </motion.div>
      </motion.button>

      <AnimatePresence initial={false}>
        {stepExpanded && (
          <motion.div
            key={`step-body-${index}`}
            className="border-t border-border overflow-hidden"
            initial={{ height: 0, opacity: 0.99 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0.99 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] as const }}
          >
            <div className="px-3 py-3">
              <pre className="overflow-x-auto rounded-lg bg-black/30 p-3 text-xs leading-relaxed text-text-muted">
                <code>{step}</code>
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TRUST SCORE SECTION
// ═══════════════════════════════════════════════════════════════════════════════

const COMPONENT_LABELS: Record<string, string> = {
  retrieval_quality: 'Retrieval quality',
  faithfulness: 'Faithfulness',
  relevance: 'Relevance',
  source_authority: 'Source authority',
  overall: 'Overall',
};

function TrustScoreSection({
  score,
  components,
}: {
  score: number;
  components: Record<string, number>;
}) {
  const componentEntries = Object.entries(components).filter(
    ([key]) => key !== 'overall',
  );

  return (
    <motion.div variants={fadeInScale}>
      <Card className="space-y-4 p-4 lg:p-6">
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <motion.div
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-green/15 text-green"
            animate={{ scale: [1, 1.08, 1] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          >
            <CheckCircle2 size={18} />
          </motion.div>
          <h2 className="text-base font-semibold text-text">Trust score</h2>
        </div>

        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          {/* Overall score - circular gauge */}
          <motion.div
            className="flex shrink-0 flex-col items-center text-center"
            initial={{ opacity: 0.99, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] as const, delay: 0.1 }}
          >
            <CircularGauge score={score} size={88} />
            <motion.p
              className="mt-2 text-sm font-medium text-text"
              variants={fadeIn}
            >
              {trustScoreLabel(score)}
            </motion.p>
            <p className="text-xs text-text-muted">Overall</p>
          </motion.div>

          {/* Component bars */}
          {componentEntries.length > 0 && (
            <motion.div
              className="flex-1 space-y-3"
              variants={staggerContainer}
              initial="initial"
              animate="animate"
            >
              <motion.h4
                className="text-xs font-semibold uppercase tracking-wider text-text-muted"
                variants={staggerItem}
              >
                Score breakdown
              </motion.h4>
              {componentEntries.map(([key, value]) => (
                <motion.div
                  key={key}
                  className="space-y-1"
                  variants={staggerItem}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text-muted">
                      {COMPONENT_LABELS[key] ?? key.replace(/_/g, ' ')}
                    </span>
                    <motion.span
                      className={clsx(
                        'font-medium',
                        value >= 0.75
                          ? 'text-green'
                          : value >= 0.5
                            ? 'text-orange'
                            : 'text-red',
                      )}
                      initial={{ opacity: 0.99 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.2 }}
                    >
                      {(value * 100).toFixed(0)}%
                    </motion.span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-card-2">
                    <motion.div
                      className={clsx(
                        'h-full rounded-full',
                        trustScoreBarColor(value),
                      )}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, value * 100)}%` }}
                      transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] as const, delay: 0.15 }}
                    />
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  METADATA FOOTER
// ═══════════════════════════════════════════════════════════════════════════════

function MetadataFooter({
  latencyMs,
  error,
}: {
  latencyMs: number;
  error?: string;
}) {
  return (
    <motion.div
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card-2 px-4 py-3 text-xs text-text-dim"
      variants={fadeIn}
    >
      <div className="flex items-center gap-3">
        <motion.span
          className="flex items-center gap-1"
          initial={{ opacity: 0.99, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Clock size={14} />
          {formatLatency(latencyMs)}
        </motion.span>
      </div>
      {error && (
        <motion.span
          className="flex items-center gap-1 text-red"
          initial={{ opacity: 0.99 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <AlertCircle size={14} />
          {error}
        </motion.span>
      )}
    </motion.div>
  );
}
