/**
 * EvidenceSidebar — Premium AI Evidence Intelligence Center
 *
 * Replaces the old SourcesTab / WhyThisAnswerTab / ConversationHistoryTab trio
 * with a unified, premium sidebar experience inspired by:
 *   ChatGPT Deep Research · Perplexity · Glean · Linear · Notion AI
 *
 * Design tokens: Case File warm archival glass, manila evidence tags, backdrop blur, Framer Motion.
 */

import { useEffect, useRef, memo, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import {
  FileText,
  Search,
  Brain,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  Target,
  Upload,
  RefreshCw,
  Quote,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Sparkles,
  Layers,
  Shield,
  Zap,
  Loader2,
} from 'lucide-react';
import {
  Badge,
  Button,
  Skeleton,
} from './ui';
import { useToast } from './toast-context';
import { staggerContainer, staggerItem } from './motion';
import { ReportBuilderWizard } from './ReportBuilderWizard';
import type { Source } from '../api/types';
import { getRelevanceMeta, relevancePercent } from '../utils/relevance';

// ─── Types ───────────────────────────────────────────────────────────────────

interface GuardrailResult {
  passed: boolean;
  score: number;
  details: string;
}

interface EvidenceSidebarProps {
  sources: Source[];
  guardrail: GuardrailResult | null;
  trustScore: number | null;
  trustComponents: Record<string, number>;
  isLoading: boolean;
  isStreaming?: boolean;
  /** The message this evidence belongs to failed — render an error state, never "verified". */
  hasError?: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  pipelinePhase?: string | null;
  isMobile?: boolean;
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  expandedSourceId?: string | null;
  onToggleSource?: (id: string | null) => void;
  highlightedSourceId?: string | null;
  /** Empty-state quick actions. */
  onUploadDocuments?: () => void;
  onRephrase?: () => void;
  onExpandScope?: () => void;
}

function getRelevanceLevel(score: number) {
  const relevance = getRelevanceMeta(score);

  return {
    level: relevance.tier,
    label: relevance.label,
    color: {
      bar: relevance.colors.bar,
      glow: relevance.colors.glow,
      text: relevance.colors.text,
    },
  };
}

function getEvidenceBadge(score: number): { label: string; icon: React.ReactNode; color: 'green' | 'orange' | 'red' } {
  const relevance = getRelevanceMeta(score);

  if (relevance.tier === 'high') {
    return { label: relevance.evidenceLabel, icon: <CheckCircle2 size={12} />, color: relevance.badgeColor };
  }

  if (relevance.tier === 'medium') {
    return { label: relevance.evidenceLabel, icon: <AlertTriangle size={12} />, color: relevance.badgeColor };
  }

  return { label: relevance.evidenceLabel, icon: <XCircle size={12} />, color: relevance.badgeColor };
}

function trustScoreColor(score: number | undefined): 'green' | 'orange' | 'red' | 'gray' {
  if (score === undefined) return 'gray';
  if (score >= 0.75) return 'green';
  if (score >= 0.5) return 'orange';
  return 'red';
}

// Trust verdict → wax-seal stamp thresholds. Mirrors ChatPage's per-message
// stamp (0.7 / 0.4) so the verdict reads identically in the bubble and here.
function trustStampMeta(score: number): { label: string; colorClass: string } {
  if (score >= 0.7) return { label: 'Verified', colorClass: 'text-accent' };
  if (score >= 0.4) return { label: 'Review', colorClass: 'text-primary' };
  return { label: 'Flagged', colorClass: 'text-accent-2' };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Sub-components ──────────────────────────────────────────────────────────

/** Highlight matched terms in excerpt with the manila evidence-mark treatment */
function HighlightedExcerpt({ text, query }: { text: string; query?: string }) {
  if (!query || !text) return <>{text}</>;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return <>{text}</>;

  const regex = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) =>
        words.includes(part.toLowerCase()) ? (
          <mark key={i} className="evidence-mark font-medium">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}

/** File type icon mapping */
function fileTypeIcon(mime?: string) {
  if (!mime) return <FileText size={16} />;
  if (mime.includes('pdf')) return <FileText size={16} />;
  if (mime.includes('doc') || mime.includes('docx')) return <FileText size={16} />;
  if (mime.includes('txt') || mime.includes('text')) return <MessageSquare size={16} />;
  if (mime.includes('csv') || mime.includes('xls')) return <Layers size={16} />;
  return <FileText size={16} />;
}

/** Overall status badge at top — a wax-seal stamp once a real trust score exists. */
function StatusBadge({ trustScore, isLoading, hasError }: { trustScore: number | null; isLoading: boolean; hasError?: boolean }) {
  if (hasError) return <Badge color="red"><XCircle size={10} className="mr-1" /> GENERATION FAILED</Badge>;
  if (isLoading) return <Badge color="gray"><Loader2 size={10} className="animate-spin mr-1" /> ANALYZING</Badge>;
  if (trustScore === null) return <Badge color="orange"><AlertTriangle size={10} className="mr-1" /> NO EVIDENCE</Badge>;

  const stamp = trustStampMeta(trustScore);

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={clsx('wax-seal text-[9px]', stamp.colorClass)}>{stamp.label}</span>
      <span className="font-mono text-[10px] tabular-nums text-text-dim">{Math.round(trustScore * 100)}%</span>
    </span>
  );
}

// ─── Loading Skeleton ────────────────────────────────────────────────────────

function SourceCardSkeleton() {
  return (
    <div className="rounded-2xl bg-card/60 border border-border/40 p-4 space-y-3 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-white/5" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3.5 w-3/4 rounded bg-white/5" />
          <div className="h-3 w-1/4 rounded bg-white/5" />
        </div>
      </div>
      <div className="h-2 w-full rounded-full bg-white/5" />
      <div className="flex gap-2">
        <div className="h-5 w-20 rounded-full bg-white/5" />
        <div className="h-5 w-16 rounded-full bg-white/5" />
        <div className="h-5 w-24 rounded-full bg-white/5" />
      </div>
      <div className="space-y-1.5">
        <div className="h-3 w-full rounded bg-white/5" />
        <div className="h-3 w-5/6 rounded bg-white/5" />
      </div>
    </div>
  );
}

function ShimmerBar({ width = '100%', delay = 0 }: { width?: string; delay?: number }) {
  return (
    <div
      className="h-2 rounded-full bg-gradient-to-r from-transparent via-white/10 to-transparent shimmer"
      style={{ width, animationDelay: `${delay}s` }}
    />
  );
}

// ─── Source Card ─────────────────────────────────────────────────────────────

const SourceCard = memo(function SourceCard({
  source,
  index,
  isExpanded,
  onToggle,
  isHighlighted,
  streaming,
}: {
  source: Source;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
  isHighlighted: boolean;
  streaming: boolean;
}) {
  const { addToast } = useToast();
  
  // Memoize computed values to avoid recalculation on every render
  const relevance = useMemo(() => getRelevanceLevel(source.relevance_score || 0), [source.relevance_score]);
  const evidence = useMemo(() => getEvidenceBadge(source.relevance_score || 0), [source.relevance_score]);
  const confidencePct = useMemo(() => relevancePercent(source.confidence ?? source.relevance_score), [source.confidence, source.relevance_score]);
  const relevancePct = useMemo(() => relevancePercent(source.relevance_score), [source.relevance_score]);
  const chunkConfidencePct = useMemo(() => relevancePercent(source.confidence), [source.confidence]);
  const docName = useMemo(() => source.document_name || source.document_id.slice(0, 8) + '...' || `Source ${index + 1}`, [source.document_name, source.document_id, index]);
  const fileExt = useMemo(() => docName.includes('.') ? docName.split('.').pop()?.toUpperCase() : 'DOC', [docName]);

  const handleCopyCitation = async () => {
    try {
      await navigator.clipboard.writeText(`[${index + 1}] ${docName}${source.page_number ? `, p. ${source.page_number}` : ''}: ${source.excerpt.slice(0, 200)}...`);
      addToast('Citation copied', 'info');
    } catch {
      addToast('Could not copy the citation. Check browser permissions.', 'error');
    }
  };

  const handleCopyExcerpt = async () => {
    try {
      await navigator.clipboard.writeText(source.excerpt || '');
      addToast('Evidence excerpt copied', 'info');
    } catch {
      addToast('Could not copy the evidence excerpt.', 'error');
    }
  };

  return (
    <motion.div
      layout
      variants={staggerItem}
      className={clsx(
        'group relative rounded-2xl border transition-all duration-300 cursor-pointer overflow-hidden',
        isHighlighted
          ? 'border-primary/60 shadow-[0_0_24px_rgba(99,102,241,0.2)] bg-primary/5'
          : 'border-border/40 bg-card/60 hover:border-primary/30 hover:bg-card-hover',
      )}
      whileHover={{ y: -2, scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      onClick={onToggle}
    >
      {/* Highlight glow sweep */}
      {isHighlighted && (
        <motion.div
          className="absolute inset-0 pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/10 to-transparent animate-glow-sweep" />
        </motion.div>
      )}

      <div className="p-4 space-y-3">
        {/* Row 1: Icon + Exhibit tag + Name + Type */}
        <div className="flex items-start gap-3">
          <div className={clsx(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
            'bg-gradient-to-br from-primary/20 to-primary-dark/20 border border-primary/20',
          )}>
            {fileTypeIcon(source.file_type)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-1.5">
              <span className="inline-flex items-center rounded-[3px] bg-primary px-1.5 py-[1px] font-mono text-[8px] font-bold uppercase tracking-widest text-bg">
                Exhibit {String(index + 1).padStart(2, '0')}
              </span>
              <Badge color="gray" className="shrink-0 text-[10px]">{fileExt}</Badge>
            </div>
            <p className="truncate font-mono text-sm font-medium text-primary">
              {docName}
              {source.page_number ? <span className="font-sans font-normal text-text-dim"> · p.{source.page_number}</span> : null}
            </p>
            {source.updated_at && (
              <p className="mt-0.5 text-xs text-text-dim">Updated {formatDate(source.updated_at)}</p>
            )}
          </div>
          <motion.div
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="shrink-0 text-text-dim"
          >
            <ChevronDown size={16} />
          </motion.div>
        </div>

        {/* Row 2: Relevance bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-dim">Relevance</span>
            <span className={clsx('font-mono font-medium tabular-nums', relevance.color.text)}>
              {relevancePct}%
            </span>
          </div>
          <div className="relative h-2 rounded-full bg-white/5 overflow-hidden">
            <motion.div
              className={clsx('absolute inset-y-0 left-0 rounded-full', relevance.color.bar)}
              initial={{ width: 0 }}
              animate={{ width: `${relevancePct}%` }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
            />
            {streaming && (
              <div className={clsx('absolute right-0 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full blur-md', relevance.color.glow)} />
            )}
          </div>
        </div>

        {/* Row 3: Metadata chips */}
        <div className="flex flex-wrap gap-1.5 font-mono tabular-nums">
          <div className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-[11px] text-text-dim">
            <Shield size={10} /> {confidencePct}%
          </div>
          {source.matched_chunks && (
            <div className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-[11px] text-text-dim">
              <Layers size={10} /> {source.matched_chunks} chunk{source.matched_chunks !== 1 ? 's' : ''}
            </div>
          )}
          {source.page_number && (
            <div className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-[11px] text-text-dim">
              <FileText size={10} /> p. {source.page_number}
            </div>
          )}
        </div>

        {/* Row 4: Evidence Badge + Score */}
        <div className="flex items-center gap-2">
          <Badge color={evidence.color}>
            <span className="flex items-center gap-1">
              {evidence.icon} {evidence.label}
            </span>
          </Badge>
          {source.rerank_score !== undefined && (
            <span className="font-mono text-[11px] text-text-dim tabular-nums">
              Score: {(source.rerank_score * 100).toFixed(0)}%
            </span>
          )}
        </div>

        {/* Row 5: Excerpt (always visible, truncated) */}
        <div
          className={clsx(
            'rounded-xl bg-black/20 p-3 text-xs leading-relaxed text-text-muted',
            isExpanded ? '' : 'line-clamp-2',
          )}
        >
          <HighlightedExcerpt text={source.excerpt || ''} query="" />
        </div>

        {/* Row 6: AI Explanation (collapsible) */}
        {source.explanation && isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-xl bg-primary/5 border border-primary/10 p-3"
          >
            <div className="flex items-start gap-2">
              <Brain size={14} className="shrink-0 mt-0.5 text-primary-soft" />
              <div>
                <p className="text-[11px] font-semibold text-primary-soft mb-1">Why this source?</p>
                <p className="text-xs text-text-muted leading-relaxed">{source.explanation}</p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Row 7: Expanded Content (all chunks, metadata) */}
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-2 pt-1"
          >
            {/* Full excerpt */}
            <div className="rounded-xl bg-black/20 p-3">
              <p className="text-[11px] font-medium text-text-dim mb-1.5">Matched Content</p>
              <p className="text-xs text-text-muted leading-relaxed">{source.excerpt}</p>
            </div>

            {/* Similarity scores */}
            <div className="grid grid-cols-2 gap-2">
              {source.relevance_score !== undefined && (
                <div className="rounded-lg bg-white/5 px-3 py-2">
                  <p className="text-[10px] text-text-dim">Vector Similarity</p>
                  <p className="font-mono text-sm font-semibold text-text tabular-nums">
                    {relevancePercent(source.relevance_score)}%
                  </p>
                </div>
              )}
              {source.rerank_score !== undefined && (
                <div className="rounded-lg bg-white/5 px-3 py-2">
                  <p className="text-[10px] text-text-dim">Rerank Score</p>
                  <p className="font-mono text-sm font-semibold text-text tabular-nums">
                    {(source.rerank_score * 100).toFixed(1)}%
                  </p>
                </div>
              )}
            </div>

            {/* Chunk confidence */}
            {source.confidence !== undefined && (
              <div className="rounded-lg bg-white/5 px-3 py-2">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-text-dim">Chunk Confidence</span>
                  <span className="font-mono font-medium text-text tabular-nums">
                    {chunkConfidencePct}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-primary-soft to-primary"
                    initial={{ width: 0 }}
                    animate={{ width: `${chunkConfidencePct}%` }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  />
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* Row 8: Actions */}
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-wrap gap-1.5 pt-1"
          >
            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); void handleCopyExcerpt(); }}>
              <Eye size={12} /> Copy excerpt
            </Button>
            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onToggle(); }}>
              <Target size={12} /> Focus evidence
            </Button>
            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); void handleCopyCitation(); }}>
              <Quote size={12} /> Cite
            </Button>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
});

// ─── AI Reasoning Tab ────────────────────────────────────────────────────────

function AIReasoningTab({
  guardrail,
  trustScore,
  trustComponents,
  isLoading,
  isStreaming,
  pipelinePhase,
  hasError,
}: {
  guardrail: GuardrailResult | null;
  trustScore: number | null;
  trustComponents: Record<string, number>;
  isLoading: boolean;
  isStreaming?: boolean;
  pipelinePhase: string | null;
  hasError?: boolean;
}) {
  // Pipeline done once we hit guardrail phase (last phase)
  // Doesn't wait for stream complete — guardrail phase fires before final tokens
  const pipelineDone = pipelinePhase === 'guardrail' || (!isStreaming && !!guardrail && !!trustScore);
  // Map backend phases → pipeline steps
  const phaseOrder = ['retrieval', 'generation', 'guardrail'];
  const currentIdx = pipelineDone ? 99 : pipelinePhase ? phaseOrder.indexOf(pipelinePhase) : -1;

  const steps = [
    { id: 'query', label: 'Query Analysis',       icon: Search,        done: pipelineDone || currentIdx >= 0 },
    { id: 'search', label: 'Document Search',      icon: FileText,      done: pipelineDone || currentIdx >= 0 },
    { id: 'rank',   label: 'Chunk Ranking',         icon: Layers,        done: pipelineDone || currentIdx >= 0 },
    { id: 'gen',    label: 'Answer Generation',     icon: Zap,           done: pipelineDone || currentIdx >= 1 },
    { id: 'verify', label: 'Claim Verification',    icon: Shield,        done: pipelineDone || currentIdx >= 2 || !!guardrail },
  ];

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton height={32} width={32} />
            <div className="flex-1">
              <Skeleton height={14} width="60%" />
              <Skeleton height={10} width="40%" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // The generation errored — there is no real verification/trust data to show.
  // Never fall through to the success pipeline (green checks, "Passed", trust
  // breakdown) for a failed answer, even if partial guardrail/trust data was
  // captured before the failure.
  if (hasError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red/10 border border-red/20">
          <XCircle size={26} className="text-red" />
        </div>
        <h3 className="text-sm font-semibold text-text mb-1">Verification unavailable</h3>
        <p className="text-xs text-text-dim max-w-xs">
          This answer failed to generate, so no claims were verified and no trust score was computed.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6">
      {/* Pipeline Timeline */}
      <div>
        <h4 className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Layers size={12} /> Retrieval Pipeline
        </h4>
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[15px] top-2 bottom-2 w-px bg-gradient-to-b from-primary/40 via-accent/40 to-green-400/40" />

          <div className="space-y-0">
            {steps.map((step, i) => {
              return (
                <motion.div
                  key={step.id}
                  initial={{ opacity: 0.99, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                  className="relative flex items-start gap-4 pb-6 last:pb-0"
                >
                  {/* Circle */}
                  <div className={clsx(
                    'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-500',
                    step.done
                      ? 'border-green-500/60 bg-green-500/20'
                      : 'border-white/10 bg-white/5',
                  )}>
                    {step.done ? (
                      <CheckCircle2 size={14} className="text-green" />
                    ) : (
                      <Loader2 size={12} className="text-text-dim animate-spin" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1 pt-1">
                    <div className="flex items-center gap-2">
                      <p className={clsx(
                        'text-sm font-medium',
                        step.done ? 'text-text' : 'text-text-dim',
                      )}>
                        {step.label}
                      </p>
                      {step.done && (
                        <span className="text-[10px] text-green font-medium">✓</span>
                      )}
                    </div>
                    {step.id === 'verify' && guardrail && (
                      <div className="mt-1 flex items-center gap-2">
                        <Badge color={guardrail.passed ? 'green' : 'red'}>
                          {guardrail.passed ? 'Passed' : 'Failed'} — {(guardrail.score * 100).toFixed(0)}%
                        </Badge>
                      </div>
                    )}
                    {step.id === 'gen' && trustScore !== null && (
                      <p className="text-xs text-text-dim mt-0.5">
                        Trust Score: <span className="text-text font-medium">{(trustScore * 100).toFixed(1)}%</span>
                      </p>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Trust Score Breakdown */}
      {Object.keys(trustComponents).length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Shield size={12} /> Trust Score Breakdown
          </h4>
          <div className="space-y-2.5">
            {Object.entries(trustComponents).map(([key, val], i) => (
              <motion.div
                key={key}
                initial={{ opacity: 0.99, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.06 }}
              >
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-text-dim capitalize">
                    {key.replace(/_/g, ' ')}
                  </span>
                  <span className={clsx('font-medium tabular-nums', trustScoreColor(val) === 'green' ? 'text-green' : trustScoreColor(val) === 'orange' ? 'text-orange' : 'text-red')}>
                    {(val * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <motion.div
                    className={clsx(
                      'h-full rounded-full',
                      val >= 0.75 ? 'bg-gradient-to-r from-green-400 to-emerald-500' :
                      val >= 0.5 ? 'bg-gradient-to-r from-orange-400 to-amber-500' :
                      'bg-gradient-to-r from-red-400 to-rose-500',
                    )}
                    initial={{ width: 0 }}
                    animate={{ width: `${(val * 100).toFixed(0)}%` }}
                    transition={{ duration: 0.8, delay: 0.3 + i * 0.06, ease: [0.16, 1, 0.3, 1] }}
                  />
                </div>
              </motion.div>
            ))}

            {/* Overall Trust Score Ring */}
            {trustScore !== null && (
              <motion.div
                initial={{ opacity: 0.99, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.5 }}
                className="mt-4 flex items-center justify-center"
              >
                <div className="relative flex h-20 w-20 items-center justify-center">
                  <svg className="absolute inset-0" viewBox="0 0 80 80">
                    <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="4" />
                    <motion.circle
                      cx="40" cy="40" r="34" fill="none"
                      stroke="url(#trustGradient)"
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeDasharray={`${trustScore * 213.6} 213.6`}
                      transform="rotate(-90 40 40)"
                      initial={{ strokeDasharray: '0 213.6' }}
                      animate={{ strokeDasharray: `${trustScore * 213.6} 213.6` }}
                      transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
                    />
                    <defs>
                      <linearGradient id="trustGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="var(--color-primary)" />
                        <stop offset="100%" stopColor="var(--color-accent)" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="text-center">
                    <p className="text-lg font-bold text-text tabular-nums">{(trustScore * 100).toFixed(0)}</p>
                    <p className="text-[9px] text-text-dim">TRUST</p>
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Empty State ─────────────────────────────────────────────────────────────

/**
 * Animated document "constellation" — nodes represent document chunks drifting
 * around a central query core, waiting to be connected by a question. Canvas is
 * used (not hand-authored SVG) for the ambient motion. Honors reduced-motion.
 */
function ConstellationCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const dpr = window.devicePixelRatio || 1;
    let W = 0;
    let H = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      W = rect.width;
      H = rect.height;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const N = 9;
    let seed = 7;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const nodes = Array.from({ length: N }, (_, i) => {
      const a = (i / N) * Math.PI * 2 + rnd() * 0.6;
      const rad = 42 + rnd() * 42;
      return {
        x: W / 2 + Math.cos(a) * rad,
        y: H / 2 + Math.sin(a) * rad,
        vx: (rnd() - 0.5) * 0.12,
        vy: (rnd() - 0.5) * 0.12,
        r: 1.8 + rnd() * 2.2,
      };
    });

    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2;
      const cy = H / 2;
      for (let i = 0; i < N; i++) {
        const n = nodes[i];
        const d = Math.hypot(n.x - cx, n.y - cy);
        ctx.strokeStyle = `rgba( 99, 102, 241,${Math.max(0, 0.28 - d / 900)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(n.x, n.y);
        ctx.stroke();
        for (let j = i + 1; j < N; j++) {
          const m = nodes[j];
          const dd = Math.hypot(n.x - m.x, n.y - m.y);
          if (dd < 58) {
            ctx.strokeStyle = `rgba( 52, 211, 153,${0.16 * (1 - dd / 58)})`;
            ctx.beginPath();
            ctx.moveTo(n.x, n.y);
            ctx.lineTo(m.x, m.y);
            ctx.stroke();
          }
        }
      }
      for (let k = 0; k < N; k++) {
        const p = nodes[k];
        ctx.beginPath();
        ctx.fillStyle = k % 3 === 0 ? 'rgba(52,211,153,0.9)' : 'rgba(99,102,241,0.85)';
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        if (!reduce) {
          p.x += p.vx;
          p.y += p.vy;
          const dc = Math.hypot(p.x - cx, p.y - cy);
          if (dc > 82 || dc < 34) {
            p.vx *= -1;
            p.vy *= -1;
          }
        }
      }
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      window.removeEventListener('resize', resize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={canvasRef} className="block h-40 w-full" aria-hidden="true" />;
}

function EvidenceEmptyState({
  onUploadDocuments,
  onRephrase,
  onExpandScope,
}: {
  onUploadDocuments?: () => void;
  onRephrase?: () => void;
  onExpandScope?: () => void;
}) {
  const actions = [
    { icon: <Upload size={14} />, text: 'Upload more documents', onClick: onUploadDocuments },
    { icon: <RefreshCw size={14} />, text: 'Rephrase your question', onClick: onRephrase },
    { icon: <Target size={14} />, text: 'Expand search scope', onClick: onExpandScope },
  ];

  return (
    <motion.div
      variants={staggerItem}
      className="flex flex-col items-center px-1 py-6 text-center"
    >
      {/* Knowledge constellation */}
      <motion.div
        initial={{ scale: 0.94, opacity: 0.99 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative mb-4 w-full"
      >
        <ConstellationCanvas />
        <div className="pointer-events-none absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-gradient-to-br from-accent to-primary shadow-[0_0_28px_rgba(52,211,153,0.4)]">
          <Sparkles size={18} className="text-bg" />
        </div>
      </motion.div>

      <h3 className="mb-1 text-sm font-semibold text-text">Ready to connect the dots</h3>
      <p className="mb-5 max-w-[15rem] text-xs text-text-dim">
        Ask a question to link relevant passages across your documents.
      </p>

      <div className="w-full space-y-2">
        {actions.map((a, i) => (
          <motion.button
            key={a.text}
            type="button"
            onClick={a.onClick}
            initial={{ opacity: 0.99, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 + i * 0.08 }}
            whileTap={{ scale: 0.98 }}
            className="group flex w-full items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5 text-left text-xs font-medium text-text-muted transition-all hover:-translate-y-px hover:border-primary/40 hover:bg-primary/[0.07] hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <span className="text-primary-soft">{a.icon}</span>
            {a.text}
            <ChevronRight
              size={13}
              className="ml-auto text-text-dim transition-colors group-hover:text-primary-soft"
            />
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}

// ─── Sources Panel ───────────────────────────────────────────────────────────

function SourcesPanel({
  sources,
  isLoading,
  isStreaming,
  expandedSourceId,
  onToggleSource,
  highlightedSourceId,
  onUploadDocuments,
  onRephrase,
  onExpandScope,
  onBuildReport,
}: {
  sources: Source[];
  isLoading: boolean;
  isStreaming: boolean;
  expandedSourceId: string | null;
  onToggleSource: (id: string | null) => void;
  highlightedSourceId: string | null;
  onUploadDocuments?: () => void;
  onRephrase?: () => void;
  onExpandScope?: () => void;
  onBuildReport: () => void;
}) {
  // Skeletons while retrieving with nothing to show yet.
  if (isLoading && sources.length === 0) {
    return (
      <div className="space-y-3 p-1">
        {[0, 1, 2].map((i) => (
          <SourceCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  // Empty state once idle and no evidence was found.
  if (sources.length === 0) {
    return (
      <EvidenceEmptyState
        onUploadDocuments={onUploadDocuments}
        onRephrase={onRephrase}
        onExpandScope={onExpandScope}
      />
    );
  }

  return (
    <motion.div
      className="space-y-3 p-1"
      variants={staggerContainer}
      initial="initial"
      animate="animate"
    >
      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5">
        <div><p className="text-xs font-semibold text-text">Evidence package</p><p className="mt-0.5 text-[11px] text-text-dim">Select and export cited passages.</p></div>
        <Button size="sm" variant="ghost" onClick={onBuildReport}><Download size={12} /> Build report</Button>
      </div>
      {/* Streaming shimmer — more evidence may still arrive */}
      {isStreaming && (
        <div className="space-y-1.5 px-1 pb-1">
          <ShimmerBar width="70%" />
          <ShimmerBar width="45%" delay={0.2} />
        </div>
      )}
      {sources.map((source, index) => (
        <SourceCard
          key={source.chunk_id || index}
          source={source}
          index={index}
          isExpanded={expandedSourceId === source.chunk_id}
          onToggle={() =>
            onToggleSource(expandedSourceId === source.chunk_id ? null : source.chunk_id)
          }
          isHighlighted={highlightedSourceId === source.chunk_id}
          streaming={isStreaming}
        />
      ))}
    </motion.div>
  );
}

// ─── Evidence Sidebar (Main) ─────────────────────────────────────────────────

const SIDEBAR_TABS = [
  { id: 'sources', label: 'Sources', icon: <FileText size={15} /> },
  { id: 'reasoning', label: 'AI Reasoning', icon: <Brain size={15} /> },
];

export default function EvidenceSidebar({
  sources,
  guardrail,
  trustScore,
  trustComponents,
  isLoading,
  isStreaming,
  hasError,
  sidebarOpen,
  onToggleSidebar,
  pipelinePhase,
  activeTab,
  onTabChange,
  expandedSourceId,
  onToggleSource,
  highlightedSourceId,
  onUploadDocuments,
  onRephrase,
  onExpandScope,
}: EvidenceSidebarProps) {
  const currentTab = activeTab ?? 'sources';
  const sourceCount = sources.length;
  const [reportBuilderOpen, setReportBuilderOpen] = useState(false);

  return (
    <>
      <AnimatePresence>
      {sidebarOpen && (
        <motion.aside
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300, mass: 0.8 }}
          className={clsx(
            'fixed inset-y-0 right-0 z-30 flex flex-col',
            'w-full sm:w-[22rem] lg:w-80',
          )}
        >
          {/* Docked glass panel — slides in from the right */}
          <div className="flex h-full flex-col overflow-hidden border-l border-white/[0.08] bg-bg/92 backdrop-blur-2xl shadow-2xl shadow-primary/10">
            {/* ─── Drag Handle / Header ──────────────────────────────────── */}
            <div className="shrink-0 px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <motion.div
                    animate={{ rotate: [0, 3, -3, 0] }}
                    transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
                  >
                    <Sparkles size={14} className="text-primary-soft shrink-0" />
                  </motion.div>
                  <h3 className="text-xs font-semibold text-text">
                    Evidence
                  </h3>
                  <StatusBadge trustScore={trustScore} isLoading={isLoading} hasError={hasError} />
                </div>
                <motion.button
                  type="button"
                  onClick={onToggleSidebar}
                  className="flex h-6 w-6 items-center justify-center rounded-lg text-text-dim hover:bg-card-2 hover:text-text transition-colors"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M11 3L3 11M3 3l8 8" />
                  </svg>
                </motion.button>
              </div>

              {/* ─── Tab bar ─────────────────────────────────────────────── */}
              <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl border border-white/[0.05] bg-white/[0.03] p-1" role="tablist">
                {SIDEBAR_TABS.map((tab) => {
                  const isActive = tab.id === currentTab;
                  return (
                    <motion.button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => onTabChange?.(tab.id)}
                      className={clsx(
                        'relative flex w-full min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                        isActive ? 'text-primary-soft' : 'text-text-dim hover:bg-white/[0.03] hover:text-text',
                      )}
                      whileTap={{ scale: 0.97 }}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="sidebarActiveTab"
                          className="absolute inset-0 rounded-lg border border-primary/25 bg-primary/10 shadow-[0_1px_10px_rgba(99,102,241,0.18)]"
                          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                        />
                      )}
                      <span className="relative z-10 flex items-center gap-1.5">
                        {tab.icon}
                        {tab.label}
                        {tab.id === 'sources' && sourceCount > 0 && (
                          <Badge color="purple" className="ml-0.5 !px-1.5 !py-0 text-[9px]">
                            {sourceCount}
                          </Badge>
                        )}
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {/* ─── Tab content ───────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 pb-4">
              {currentTab === 'sources' ? (
                <SourcesPanel
                  sources={sources}
                  isLoading={isLoading}
                  isStreaming={isStreaming ?? isLoading}
                  expandedSourceId={expandedSourceId ?? null}
                  onToggleSource={onToggleSource ?? (() => {})}
                  highlightedSourceId={highlightedSourceId ?? null}
                  onUploadDocuments={onUploadDocuments}
                  onRephrase={onRephrase}
                  onExpandScope={onExpandScope}
                  onBuildReport={() => setReportBuilderOpen(true)}
                />
              ) : (
                <AIReasoningTab
                  guardrail={guardrail}
                  trustScore={trustScore}
                  trustComponents={trustComponents}
                  isLoading={isLoading && !pipelinePhase}
                  isStreaming={isStreaming ?? isLoading}
                  pipelinePhase={pipelinePhase ?? null}
                  hasError={hasError}
                />
              )}
            </div>
          </div>
        </motion.aside>
      )}
      </AnimatePresence>
      <ReportBuilderWizard open={reportBuilderOpen} onClose={() => setReportBuilderOpen(false)} sources={sources} />
    </>
  );
}
