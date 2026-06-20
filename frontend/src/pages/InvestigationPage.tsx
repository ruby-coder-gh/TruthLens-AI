import { useState, useCallback, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { clsx } from 'clsx';
import {
  Search,
  Brain,
  Network,
  FileSearch,
  ChevronDown,
  ChevronRight,
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

function trustScoreBorder(score: number): string {
  if (score >= 0.75) return 'border-green/40 bg-green/10 text-green';
  if (score >= 0.5) return 'border-orange/40 bg-orange/10 text-orange';
  return 'border-red/40 bg-red/10 text-red';
}

function trustScoreBarColor(score: number): string {
  if (score >= 0.75) return 'bg-green';
  if (score >= 0.5) return 'bg-orange';
  return 'bg-red';
}

// ─── Preserve whitespace / line breaks in report text ────────────────────────

function renderReportText(text: string): React.ReactNode {
  // Split on markdown headings (## or ###) and format them
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
  const navigate = useNavigate();
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
    <div className="mx-auto max-w-4xl space-y-6 animate-fadeIn">
      {/* ─── Header ────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 shadow-lg shadow-primary/5">
            <Network size={22} className="text-primary-soft" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text">Investigation</h1>
            <p className="text-sm text-text-muted">
              Multi-step research that decomposes complex questions, gathers evidence, and synthesises findings.
            </p>
          </div>
        </div>
      </div>

      {/* ─── Input Section ─────────────────────────────────────────────── */}
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
          <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
            <span className="flex items-center gap-1 text-xs text-text-dim">
              <Sparkles size={12} />
              Try:
            </span>
            {EXAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => handleExampleClick(q)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card-2 px-3 py-1 text-xs text-text-muted transition-all hover:border-primary/30 hover:text-primary-soft"
              >
                <FileSearch size={12} />
                {q}
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* ─── Loading State ────────────────────────────────────────────── */}
      {isLoading && (
        <div className="space-y-6 animate-fadeIn">
          {/* Progress indicator */}
          <Card className="p-6 text-center">
            <div className="flex items-center justify-center gap-3">
              <div className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 animate-pulse-dot rounded-full bg-primary-soft" style={{ animationDelay: '0ms' }} />
                <span className="h-2.5 w-2.5 animate-pulse-dot rounded-full bg-primary-soft" style={{ animationDelay: '200ms' }} />
                <span className="h-2.5 w-2.5 animate-pulse-dot rounded-full bg-primary-soft" style={{ animationDelay: '400ms' }} />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-text">Investigating...</p>
                <p className="text-xs text-text-muted">
                  Decomposing question, searching sources, synthesising findings
                </p>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-card-2">
              <div className="h-full w-full animate-pulse rounded-full bg-gradient-to-r from-primary via-accent to-primary"
                style={{ animation: 'shimmer 2s ease-in-out infinite', backgroundSize: '200% 100%' }} />
            </div>
          </Card>

          {/* Skeleton previews */}
          <div className="space-y-4">
            <Skeleton height={200} width="100%" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton height={120} width="100%" />
              <Skeleton height={120} width="100%" />
            </div>
          </div>
        </div>
      )}

      {/* ─── Results Section ──────────────────────────────────────────── */}
      {(isComplete || isError) && result && (
        <div className="space-y-6 animate-fadeIn">
          {/* Final Report */}
          {!result.error && result.final_report && (
            <FinalReportCard report={result.final_report} />
          )}

          {/* Error Card */}
          {result.error && (
            <ErrorCard
              message={result.error}
              onRetry={() => investigationMutation.mutate()}
              isRetrying={isLoading}
            />
          )}

          {/* Sub-questions */}
          {result.sub_questions && result.sub_questions.length > 0 && (
            <SubQuestionsSection questions={result.sub_questions} />
          )}

          {/* Reasoning trace */}
          {result.reasoning_trace && result.reasoning_trace.length > 0 && (
            <ReasoningTraceSection
              trace={result.reasoning_trace}
              expanded={reasoningExpanded}
              onToggle={() => setReasoningExpanded((prev) => !prev)}
            />
          )}

          {/* Trust score */}
          {result.trust_score !== undefined && result.trust_score !== null && (
            <TrustScoreSection
              score={result.trust_score}
              components={result.trust_components ?? {}}
            />
          )}

          {/* Metadata footer */}
          <MetadataFooter
            latencyMs={result.latency_ms}
            error={result.error}
          />
        </div>
      )}

      {/* ─── Empty Welcome (no query, no loading, no result) ──────────── */}
      {!query && !isLoading && !result && (
        <WelcomeEmptyState onExampleClick={handleExampleClick} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WELCOME EMPTY STATE
// ═══════════════════════════════════════════════════════════════════════════════

function WelcomeEmptyState({ onExampleClick }: { onExampleClick: (q: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center animate-fadeIn">
      <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 shadow-lg shadow-primary/5">
        <Network size={36} className="text-primary-soft" />
      </div>
      <h2 className="text-xl font-bold text-text">Deep research engine</h2>
      <p className="mt-2 max-w-lg text-sm text-text-muted">
        Ask a complex question and the investigation agent will decompose it into sub-questions,
        search across your documents, and synthesise a final report with confidence scoring.
      </p>

      {/* Feature highlights */}
      <div className="mt-8 grid grid-cols-3 gap-6 text-center">
        <div className="space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-card-2 text-accent">
            <Brain size={22} />
          </div>
          <p className="text-xs font-medium text-text">Decomposition</p>
          <p className="text-[11px] text-text-dim">Breaks down complex queries</p>
        </div>
        <div className="space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-card-2 text-primary-soft">
            <FileSearch size={22} />
          </div>
          <p className="text-xs font-medium text-text">Deep search</p>
          <p className="text-[11px] text-text-dim">Multi-source evidence</p>
        </div>
        <div className="space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-card-2 text-gold">
            <CheckCircle2 size={22} />
          </div>
          <p className="text-xs font-medium text-text">Synthesis</p>
          <p className="text-[11px] text-text-dim">Coherent final report</p>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap justify-center gap-2">
        {EXAMPLE_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onExampleClick(q)}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm text-text-muted transition-all duration-200 hover:border-primary/30 hover:bg-card-2 hover:text-text"
          >
            <Sparkles size={14} className="text-primary-soft" />
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FINAL REPORT CARD
// ═══════════════════════════════════════════════════════════════════════════════

function FinalReportCard({ report }: { report: string }) {
  return (
    <Card className="space-y-3 p-4 lg:p-6">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary-soft">
          <Sparkles size={18} />
        </div>
        <h2 className="text-base font-semibold text-text">Final Report</h2>
      </div>
      <div className="prose-custom space-y-1">
        {renderReportText(report)}
      </div>
    </Card>
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
    <Card className="border-red/30 bg-red/5 p-6 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red/15 text-red">
        <AlertCircle size={28} />
      </div>
      <h3 className="text-lg font-semibold text-text">Investigation failed</h3>
      <p className="mt-2 text-sm text-text-muted">{message}</p>
      <Button
        variant="secondary"
        className="mt-6"
        onClick={onRetry}
        loading={isRetrying}
      >
        <Search size={16} />
        Retry investigation
      </Button>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SUB-QUESTIONS SECTION
// ═══════════════════════════════════════════════════════════════════════════════

function SubQuestionsSection({ questions }: { questions: string[] }) {
  return (
    <Card className="space-y-3 p-4 lg:p-6">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Brain size={18} />
        </div>
        <h2 className="text-base font-semibold text-text">
          Sub-questions ({questions.length})
        </h2>
      </div>

      <div className="space-y-2">
        {questions.map((question, i) => (
          <div
            key={i}
            className="flex items-start gap-3 rounded-lg border border-border bg-card-2 p-3 transition-colors hover:border-primary/20"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-medium text-primary-soft">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-text">{question}</p>
            </div>
            <Badge color="green" className="shrink-0">
              Researched
            </Badge>
          </div>
        ))}
      </div>
    </Card>
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
    <Card className="space-y-3 p-4 lg:p-6">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold/15 text-gold">
            <Network size={18} />
          </div>
          <h2 className="text-base font-semibold text-text">
            Reasoning trace ({trace.length} steps)
          </h2>
        </div>
        {expanded ? (
          <ChevronDown size={18} className="text-text-muted" />
        ) : (
          <ChevronRight size={18} className="text-text-muted" />
        )}
      </button>

      {expanded && (
        <div className="space-y-3 animate-fadeIn">
          {trace.map((step, i) => (
            <ReasoningStep key={i} index={i} step={step} />
          ))}
        </div>
      )}
    </Card>
  );
}

function ReasoningStep({ index, step }: { index: number; step: string }) {
  // Try to split into node name, input, output
  const [stepExpanded, setStepExpanded] = useState(false);

  // Parse step text — look for common patterns
  const lines = step.split('\n').filter((l) => l.trim());
  const firstLine = lines[0] ?? '';
  const isStructured = firstLine.match(/^(Node|Step|Agent|Tool):/i);

  return (
    <div className="rounded-lg border border-border bg-bg-soft overflow-hidden">
      {/* Step header */}
      <button
        type="button"
        onClick={() => setStepExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-card-2"
        aria-expanded={stepExpanded}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-medium text-primary-soft">
            {index + 1}
          </span>
          <span className="truncate text-xs font-medium text-text">
            {isStructured ? firstLine : `Step ${index + 1}`}
          </span>
        </div>
        {stepExpanded ? (
          <ChevronDown size={14} className="shrink-0 text-text-dim" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-text-dim" />
        )}
      </button>

      {/* Step body */}
      {stepExpanded && (
        <div className="border-t border-border px-3 py-3">
          <pre className="overflow-x-auto rounded-lg bg-black/30 p-3 text-xs leading-relaxed text-text-muted">
            <code>{step}</code>
          </pre>
        </div>
      )}
    </div>
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
    <Card className="space-y-4 p-4 lg:p-6">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green/15 text-green">
          <CheckCircle2 size={18} />
        </div>
        <h2 className="text-base font-semibold text-text">Trust score</h2>
      </div>

      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        {/* Overall score */}
        <div className="flex shrink-0 flex-col items-center text-center">
          <div
            className={clsx(
              'flex h-20 w-20 items-center justify-center rounded-full border-4 text-2xl font-bold',
              trustScoreBorder(score),
            )}
          >
            {(score * 100).toFixed(0)}
          </div>
          <p className="mt-2 text-sm font-medium text-text">
            {trustScoreLabel(score)}
          </p>
          <p className="text-xs text-text-muted">Overall</p>
        </div>

        {/* Component bars */}
        {componentEntries.length > 0 && (
          <div className="flex-1 space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Score breakdown
            </h4>
            {componentEntries.map(([key, value]) => (
              <div key={key} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">
                    {COMPONENT_LABELS[key] ?? key.replace(/_/g, ' ')}
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
                  <div
                    className={clsx(
                      'h-full rounded-full transition-all duration-500',
                      trustScoreBarColor(value),
                    )}
                    style={{ width: `${Math.min(100, value * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
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
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card-2 px-4 py-3 text-xs text-text-dim">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <Clock size={14} />
          {formatLatency(latencyMs)}
        </span>
      </div>
      {error && (
        <span className="flex items-center gap-1 text-red">
          <AlertCircle size={14} />
          {error}
        </span>
      )}
    </div>
  );
}
