import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileSearch,
  FileText,
  GitFork,
  MinusCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import type { InvestigationReasoningStep, InvestigationSubQuestion, Source } from '../api/types';
import { Skeleton } from './ui';

export interface ReasoningTimelineProps {
  trace?: readonly InvestigationReasoningStep[] | null;
  subQuestions?: readonly InvestigationSubQuestion[] | null;
  isLoading?: boolean;
  className?: string;
}

interface TimelineEntry {
  index: number;
  step: InvestigationReasoningStep;
  subQuestion?: InvestigationSubQuestion;
  retries: TimelineEntry[];
}

function classes(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function readString(details: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = details?.[key];
  return typeof value === 'string' ? value : undefined;
}

function readNumber(details: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = details?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readStringArray(details: Record<string, unknown> | undefined, key: string): string[] {
  const value = details?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function getOutcome(step: InvestigationReasoningStep): string | undefined {
  const recordedOutcome = readString(step.details, 'outcome');
  if (recordedOutcome) return recordedOutcome;
  return readString(step.details, 'error') ? 'failed' : undefined;
}

function isRetryOutcome(outcome: string | undefined): boolean {
  return outcome === 'retry' || outcome === 'retried';
}

function formatElapsed(milliseconds: number | undefined): string | null {
  if (milliseconds == null || milliseconds < 0) return null;
  return milliseconds < 1_000 ? `${milliseconds}ms` : `${(milliseconds / 1_000).toFixed(1)}s`;
}

function formatTimestamp(timestampMs: number | undefined): string | null {
  if (timestampMs == null || !Number.isFinite(timestampMs) || timestampMs <= 0) return null;
  return new Date(timestampMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDetailKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDetailValue(value: unknown): string {
  if (value == null) return 'Unavailable';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'Unavailable';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length === 0 ? 'None' : `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (typeof value === 'object') return `${Object.keys(value).length} fields`;
  return String(value);
}

function formatScore(score: number | undefined): string | null {
  if (score == null || !Number.isFinite(score)) return null;
  return score >= 0 && score <= 1 ? `${(score * 100).toFixed(0)}%` : score.toFixed(2);
}

function displaySourceName(source: Source): string {
  return source.document_name || `Document ${source.document_id.slice(0, 8)}`;
}

function phaseClassName(phase: string): string {
  switch (phase) {
    case 'decompose': return 'border-primary/30 bg-primary/15 text-primary-soft';
    case 'investigate': return 'border-accent/30 bg-accent/15 text-accent';
    case 'synthesize': return 'border-gold/30 bg-gold/15 text-gold';
    case 'evaluate': return 'border-green/30 bg-green/15 text-green';
    default: return 'border-border bg-card-2 text-text-muted';
  }
}

function PhaseIcon({ phase, size = 16 }: { phase: string; size?: number }) {
  if (phase === 'decompose') return <GitFork size={size} aria-hidden="true" />;
  if (phase === 'investigate') return <Search size={size} aria-hidden="true" />;
  if (phase === 'synthesize') return <FileText size={size} aria-hidden="true" />;
  if (phase === 'evaluate') return <ShieldCheck size={size} aria-hidden="true" />;
  return <Brain size={size} aria-hidden="true" />;
}

function OutcomeLabel({ outcome }: { outcome?: string }) {
  if (!outcome) return null;

  const normalized = outcome.toLowerCase();
  const meta = normalized === 'completed'
    ? { label: 'Completed', icon: <CheckCircle2 size={12} aria-hidden="true" />, className: 'border-green/25 bg-green/10 text-green' }
    : normalized === 'failed' || normalized === 'error'
      ? { label: 'Failed', icon: <XCircle size={12} aria-hidden="true" />, className: 'border-red/25 bg-red/10 text-red' }
      : normalized === 'retry' || normalized === 'retried'
        ? { label: 'Retried', icon: <RefreshCw size={12} aria-hidden="true" />, className: 'border-orange/25 bg-orange/10 text-orange' }
        : normalized === 'no_results'
          ? { label: 'No results', icon: <MinusCircle size={12} aria-hidden="true" />, className: 'border-orange/25 bg-orange/10 text-orange' }
          : { label: formatDetailKey(outcome), icon: <AlertTriangle size={12} aria-hidden="true" />, className: 'border-border bg-card-2 text-text-dim' };

  return <span className={classes('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold', meta.className)}>{meta.icon}{meta.label}</span>;
}

function buildTimelineEntries(
  trace: readonly InvestigationReasoningStep[],
  subQuestions: readonly InvestigationSubQuestion[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  let subQuestionIndex = 0;

  trace.forEach((step, index) => {
    const outcome = getOutcome(step);
    const previousEntry = entries[entries.length - 1];

    if (isRetryOutcome(outcome) && previousEntry && previousEntry.step.phase === step.phase) {
      previousEntry.retries.push({ index, step, subQuestion: previousEntry.subQuestion, retries: [] });
      return;
    }

    const subQuestion = step.phase === 'investigate' ? subQuestions[subQuestionIndex++] : undefined;
    entries.push({ index, step, subQuestion, retries: [] });
  });

  return entries;
}

function TraceSkeleton({ className }: { className?: string }) {
  return (
    <section className={classes('rounded-xl border border-border bg-card p-4 lg:p-6', className)} aria-busy="true" aria-label="Loading reasoning trace">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="space-y-2"><Skeleton width={190} height={16} /><Skeleton width={260} height={12} /></div>
        <Skeleton width={104} height={30} className="rounded-lg" />
      </div>
      <div className="mt-5 space-y-5">
        {[0, 1, 2, 3].map((node) => (
          <div key={node} className="relative flex gap-3">
            <Skeleton width={34} height={34} className="shrink-0 rounded-full" />
            <div className="flex-1 space-y-2 pt-1"><Skeleton width="55%" height={14} /><Skeleton width="82%" height={12} /></div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SubQuestionAuditDetail({ subQuestion }: { subQuestion: InvestigationSubQuestion }) {
  const sources = subQuestion.retrieved_chunks ?? [];
  const citations = subQuestion.citations ?? [];

  return (
    <div className="space-y-3 rounded-xl border border-border bg-bg-soft p-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">Research record</p>
        <p className="mt-1 text-sm font-medium leading-relaxed text-text">{subQuestion.question}</p>
        {subQuestion.purpose && <p className="mt-1 text-xs leading-relaxed text-text-muted">Purpose: {subQuestion.purpose}</p>}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-dim">
        {subQuestion.latency_ms != null && <span>{formatElapsed(subQuestion.latency_ms)}</span>}
        {subQuestion.trust_score != null && <span>Trust {formatScore(subQuestion.trust_score) ?? 'Unavailable'}</span>}
        {subQuestion.guardrail_passed != null && <span>{subQuestion.guardrail_passed ? 'Guardrail passed' : 'Guardrail flagged'}</span>}
        <span>{citations.length} cited passage{citations.length === 1 ? '' : 's'}</span>
      </div>
      {subQuestion.partial_answer && <p className="rounded-lg border border-border/80 bg-card-2 p-3 text-sm leading-relaxed text-text-muted">{subQuestion.partial_answer}</p>}
      {sources.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-dim">Sources consulted ({sources.length})</p>
          <div className="space-y-1.5">
            {sources.map((source, index) => (
              <div key={`${source.chunk_id}-${index}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border/70 bg-card-2 px-2.5 py-2 text-xs">
                <span className="max-w-48 truncate font-medium text-text-muted" title={displaySourceName(source)}>{displaySourceName(source)}</span>
                <span className="font-mono text-text-dim">{source.chunk_id}</span>
                <span className="text-primary-soft">Relevance {formatScore(source.relevance_score) ?? 'Unavailable'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {citations.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-dim">Cited passages</p>
          <div className="space-y-1.5">
            {citations.map((citation, index) => <p key={`${citation.chunk_id}-${index}`} className="border-l-2 border-primary/40 pl-2 text-xs leading-relaxed text-text-muted">{citation.text || `Chunk ${citation.chunk_id}`}</p>)}
          </div>
        </div>
      )}
    </div>
  );
}

function StepAuditDetails({ entry }: { entry: TimelineEntry }) {
  const details = entry.step.details ?? {};
  const proposedQuestions = readStringArray(details, 'sub_questions');
  const detailEntries = Object.entries(details).filter(([key]) => key !== 'sub_questions');

  return (
    <div className="space-y-3 border-t border-border pt-3">
      {entry.subQuestion && <SubQuestionAuditDetail subQuestion={entry.subQuestion} />}
      {proposedQuestions.length > 0 && (
        <div className="rounded-xl border border-border bg-bg-soft p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">Generated sub-questions</p>
          <ol className="mt-2 space-y-1.5 pl-4 text-sm text-text-muted">
            {proposedQuestions.map((question, index) => <li key={`${question}-${index}`} className="list-decimal pl-1">{question}</li>)}
          </ol>
        </div>
      )}
      {detailEntries.length > 0 ? (
        <dl className="grid gap-x-4 gap-y-2 rounded-xl border border-border bg-bg-soft p-3 sm:grid-cols-2">
          {detailEntries.map(([key, value]) => (
            <div key={key} className="min-w-0">
              <dt className="text-[11px] uppercase tracking-wide text-text-dim">{formatDetailKey(key)}</dt>
              <dd className="mt-0.5 break-words text-xs leading-relaxed text-text-muted">{formatDetailValue(value)}</dd>
            </div>
          ))}
        </dl>
      ) : !entry.subQuestion && !proposedQuestions.length ? (
        <p className="rounded-lg border border-border bg-bg-soft p-3 text-xs text-text-muted">No additional audit detail was recorded for this step.</p>
      ) : null}
    </div>
  );
}

function TimelineNode({ entry, expanded, onToggle, nested = false }: { entry: TimelineEntry; expanded: boolean; onToggle: (index: number) => void; nested?: boolean }) {
  const outcome = getOutcome(entry.step);
  const timestamp = formatTimestamp(entry.step.timestamp_ms);
  const elapsed = formatElapsed(readNumber(entry.step.details, 'latency_ms'));

  return (
    <div className={classes('relative', nested ? 'pb-3 pl-10' : 'pb-5 pl-12 last:pb-0')}>
      <div className={classes('absolute left-0 top-0 flex items-center justify-center rounded-xl border', nested ? 'h-7 w-7' : 'h-9 w-9', phaseClassName(entry.step.phase))}>
        <PhaseIcon phase={entry.step.phase} size={nested ? 13 : 16} />
      </div>
      <button
        type="button"
        onClick={() => onToggle(entry.index)}
        aria-expanded={expanded}
        className="group w-full rounded-xl border border-border bg-bg-soft p-3 text-left transition-colors hover:border-primary/30 hover:bg-card-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <div className="flex gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">{entry.step.phase}</span>
              <OutcomeLabel outcome={outcome} />
            </div>
            <p className="mt-1 text-sm font-semibold text-text">{entry.step.title}</p>
            <p className="mt-0.5 line-clamp-1 text-xs leading-relaxed text-text-muted">{entry.step.description || 'No summary recorded.'}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 text-[11px] text-text-dim">
            {timestamp && <span>{timestamp}</span>}
            {elapsed && <span>{elapsed}</span>}
            {expanded ? <ChevronUp size={16} className="mt-1 text-text-muted" aria-hidden="true" /> : <ChevronDown size={16} className="mt-1 text-text-muted" aria-hidden="true" />}
          </div>
        </div>
      </button>
      {expanded && <div className="mt-2 rounded-xl border border-border/80 bg-card p-3"><StepAuditDetails entry={entry} /></div>}
    </div>
  );
}

/** A review-oriented timeline of the persisted multi-agent investigation trace. */
export function ReasoningTimeline({ trace, subQuestions, isLoading = false, className }: ReasoningTimelineProps) {
  const entries = useMemo(() => buildTimelineEntries(trace ?? [], subQuestions ?? []), [subQuestions, trace]);
  const entryIndexes = useMemo(() => entries.flatMap((entry) => [entry.index, ...entry.retries.map((retry) => retry.index)]), [entries]);
  const [expandedIndexes, setExpandedIndexes] = useState<Set<number>>(() => new Set());
  const allExpanded = entryIndexes.length > 0 && entryIndexes.every((index) => expandedIndexes.has(index));

  const toggleEntry = (index: number) => {
    setExpandedIndexes((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const toggleAll = () => {
    setExpandedIndexes(allExpanded ? new Set() : new Set(entryIndexes));
  };

  if (isLoading) return <TraceSkeleton className={className} />;

  if (entries.length === 0) {
    return (
      <section className={classes('rounded-xl border border-border bg-card p-4 lg:p-6', className)}>
        <div className="flex min-h-36 flex-col items-center justify-center text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-bg-soft text-text-dim"><FileSearch size={19} aria-hidden="true" /></div>
          <h2 className="mt-3 text-sm font-semibold text-text">No reasoning trace available for this investigation</h2>
          <p className="mt-1 max-w-lg text-sm text-text-muted">This case has no persisted agent-step audit record. Rerun the investigation to capture a fresh trace.</p>
        </div>
      </section>
    );
  }

  return (
    <section className={classes('rounded-xl border border-border bg-card p-4 lg:p-6', className)} aria-label="Reasoning trace timeline">
      <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary-soft"><Sparkles size={17} aria-hidden="true" /></div>
          <div><h2 className="text-base font-semibold text-text">Reasoning trace</h2><p className="text-xs text-text-dim">Persisted agent-step audit trail ({entryIndexes.length} recorded steps)</p></div>
        </div>
        <button type="button" onClick={toggleAll} className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-border bg-bg-soft px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:border-primary/30 hover:text-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
          {allExpanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          {allExpanded ? 'Collapse all' : 'Expand all'}
        </button>
      </div>
      <div className="relative mt-5">
        {entries.map((entry, position) => (
          <div key={`${entry.step.phase}-${entry.index}`} className="relative">
            {position < entries.length - 1 && <span className="absolute left-[17px] top-9 bottom-0 w-px bg-border" aria-hidden="true" />}
            <TimelineNode entry={entry} expanded={expandedIndexes.has(entry.index)} onToggle={toggleEntry} />
            {entry.retries.length > 0 && (
              <div className="relative ml-4 border-l border-orange/30 pl-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-orange">Retry attempts</p>
                {entry.retries.map((retry) => <TimelineNode key={`${retry.step.phase}-${retry.index}`} entry={retry} nested expanded={expandedIndexes.has(retry.index)} onToggle={toggleEntry} />)}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default ReasoningTimeline;
