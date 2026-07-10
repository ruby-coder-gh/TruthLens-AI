/**
 * EvidenceSidebar — Premium AI Evidence Intelligence Center
 *
 * Replaces the old SourcesTab / WhyThisAnswerTab / ConversationHistoryTab trio
 * with a unified, premium sidebar experience inspired by:
 *   ChatGPT Deep Research · Perplexity · Glean · Linear · Notion AI
 *
 * Design tokens: glassmorphism, purple-blue glow, backdrop blur, Framer Motion.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import {
  FileText,
  Search,
  Brain,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  Target,
  Quote,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Sparkles,
  Layers,
  Shield,
  Zap,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import {
  Badge,
  Card,
  Button,
  Skeleton,
  EmptyState,
  ProgressBar,
  useToast,
  fadeIn,
  fadeInUp,
  staggerContainer,
  staggerItem,
} from './ui';
import type { Source } from '../api/types';
import { getRelevanceMeta, relevancePercent } from '../utils/relevance';

// ─── Types ───────────────────────────────────────────────────────────────────

interface GuardrailResult {
  passed: boolean;
  score: number;
  details: string;
}

interface StoredQueryDetail {
  queryId: string;
  queryText: string;
  responseText: string;
  timestamp: string;
}

interface EvidenceSidebarProps {
  guardrail: GuardrailResult | null;
  trustScore: number | null;
  trustComponents: Record<string, number>;
  isLoading: boolean;
  isStreaming?: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  pipelinePhase?: string | null;
  isMobile?: boolean;
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Sub-components ──────────────────────────────────────────────────────────

/** Highlight matched terms in excerpt with purple glow */
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
          <mark key={i} className="bg-purple-500/20 text-purple-200 rounded px-0.5 font-medium">
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

/** Overall status badge at top */
function StatusBadge({ trustScore, isLoading }: { trustScore: number | null; isLoading: boolean }) {
  if (isLoading) return <Badge color="gray"><Loader2 size={10} className="animate-spin mr-1" /> ANALYZING</Badge>;
  if (trustScore === null) return <Badge color="orange"><AlertTriangle size={10} className="mr-1" /> NO EVIDENCE</Badge>;

  const trust = trustScore;

  if (trust >= 0.7) {
    return (
      <Badge color="green">
        <span className="relative flex h-2 w-2 mr-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
        </span>
        VERIFIED
      </Badge>
    );
  }
  if (trust >= 0.4) {
    return (
      <Badge color="orange">
        <span className="relative flex h-2 w-2 mr-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500" />
        </span>
        PARTIAL EVIDENCE
      </Badge>
    );
  }
  return (
    <Badge color="red">
      <span className="relative flex h-2 w-2 mr-1.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
      </span>
      LOW CONFIDENCE
    </Badge>
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

function SourceCard({
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
  const relevance = getRelevanceLevel(source.relevance_score || 0);
  const evidence = getEvidenceBadge(source.relevance_score || 0);
  const confidencePct = relevancePercent(source.confidence ?? source.relevance_score);
  const relevancePct = relevancePercent(source.relevance_score);
  const chunkConfidencePct = relevancePercent(source.confidence);
  const docName = source.document_name || source.document_id.slice(0, 8) + '...' || `Source ${index + 1}`;
  const fileExt = docName.includes('.') ? docName.split('.').pop()?.toUpperCase() : 'DOC';

  const handleCopyCitation = () => {
    navigator.clipboard.writeText(`[${index + 1}] ${docName}: ${source.excerpt.slice(0, 200)}...`);
    addToast('Citation copied', 'info');
  };

  return (
    <motion.div
      layout
      variants={staggerItem}
      className={clsx(
        'group relative rounded-2xl border transition-all duration-300 cursor-pointer overflow-hidden',
        isHighlighted
          ? 'border-primary/60 shadow-[0_0_24px_rgba(124,92,255,0.2)] bg-primary/5'
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
        {/* Row 1: Icon + Name + Type */}
        <div className="flex items-start gap-3">
          <div className={clsx(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
            'bg-gradient-to-br from-primary/20 to-purple-500/20 border border-primary/20',
          )}>
            {fileTypeIcon(source.file_type)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-text truncate">{docName}</p>
              <Badge color="gray" className="shrink-0 text-[10px]">{fileExt}</Badge>
            </div>
            <p className="text-xs text-text-dim mt-0.5">
              {source.page_number ? `p. ${source.page_number}` : ''}
              {source.updated_at ? ` · Updated ${formatDate(source.updated_at)}` : ''}
            </p>
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
            <span className={clsx('font-medium tabular-nums', relevance.color.text)}>
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
        <div className="flex flex-wrap gap-1.5">
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
            <span className="text-[11px] text-text-dim tabular-nums">
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
                  <p className="text-sm font-semibold text-text tabular-nums">
                    {relevancePercent(source.relevance_score)}%
                  </p>
                </div>
              )}
              {source.rerank_score !== undefined && (
                <div className="rounded-lg bg-white/5 px-3 py-2">
                  <p className="text-[10px] text-text-dim">Rerank Score</p>
                  <p className="text-sm font-semibold text-text tabular-nums">
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
                  <span className="text-text font-medium">
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
            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); }}>
              <Eye size={12} /> View
            </Button>
            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); }}>
              <Target size={12} /> Jump to Match
            </Button>
            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); handleCopyCitation(); }}>
              <Quote size={12} /> Cite
            </Button>
            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); }}>
              <Download size={12} /> Export
            </Button>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

// ─── AI Reasoning Tab ────────────────────────────────────────────────────────

function AIReasoningTab({
  guardrail,
  trustScore,
  trustComponents,
  isLoading,
  isStreaming,
  pipelinePhase,
}: {
  guardrail: GuardrailResult | null;
  trustScore: number | null;
  trustComponents: Record<string, number>;
  isLoading: boolean;
  isStreaming?: boolean;
  pipelinePhase: string | null;
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
              const Icon = step.icon;
              const isLast = i === steps.length - 1;
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
                        <stop offset="0%" stopColor="#a78bfa" />
                        <stop offset="100%" stopColor="#2dd4bf" />
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

// ─── Conversation Tab ────────────────────────────────────────────────────────

function ConversationTab({
  queries,
  loading,
  error,
  onRetry,
  onSelect,
  historyOpen,
  onDelete,
  isDeleting,
  conversationId,
}: {
  queries: StoredQueryDetail[];
  loading: boolean;
  error: boolean;
  onRetry?: () => void;
  onSelect?: (queryId: string) => void;
  historyOpen?: string | null;
  onDelete?: (queryId: string) => void;
  isDeleting?: boolean;
  conversationId?: string | null;
}) {
  if (loading) {
    return (
      <div className="p-4 space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton height={14} width="80%" />
            <Skeleton height={10} width="40%" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <EmptyState
          icon={<MessageSquare size={20} />}
          title="Failed to load history"
          description="There was an error loading your conversation history."
          action={
            onRetry ? <Button size="sm" onClick={onRetry}>Retry</Button> : undefined
          }
        />
      </div>
    );
  }

  if (queries.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          icon={<MessageSquare size={20} />}
          title="No conversation history"
          description="Ask a question to start a conversation."
        />
      </div>
    );
  }

  const displayQueries = conversationId
    ? queries.filter((q) => q.queryId !== conversationId)
    : queries;

  return (
    <div className="p-4 space-y-1">
      {conversationId && (
        <div className="mb-3 rounded-xl bg-primary/5 border border-primary/10 px-3 py-2">
          <p className="text-[11px] text-primary-soft font-medium">Current conversation</p>
          <p className="text-xs text-text-dim mt-0.5">Showing related history</p>
        </div>
      )}

      {displayQueries.length === 0 ? (
        <p className="text-xs text-text-dim text-center py-6">No related queries found</p>
      ) : (
        displayQueries.map((q, i) => {
          const isOpen = historyOpen === q.queryId;
          return (
            <motion.div
              key={q.queryId}
              variants={staggerItem}
              initial="initial"
              animate="animate"
            >
              <div
                className={clsx(
                  'rounded-xl border transition-all cursor-pointer group',
                  isOpen
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-border/30 bg-card/40 hover:border-border/60 hover:bg-card/60',
                )}
                onClick={() => onSelect?.(q.queryId)}
              >
                <div className="p-3">
                  <div className="flex items-start gap-2.5">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/5 mt-0.5">
                      <MessageSquare size={11} className="text-text-dim" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-text line-clamp-1 leading-relaxed">
                        {q.queryText}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="flex items-center gap-1 text-[10px] text-text-dim">
                          <Clock size={9} />
                          {formatDate(q.timestamp)}
                        </span>
                        {q.responseText && (
                          <span className="text-[10px] text-green/70">✓ answered</span>
                        )}
                      </div>

                      {/* Expanded response */}
                      {isOpen && q.responseText && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          className="mt-2 pt-2 border-t border-border/30"
                        >
                          <p className="text-xs text-text-muted leading-relaxed line-clamp-3">
                            {q.responseText}
                          </p>

                          <div className="flex items-center gap-1.5 mt-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => { e.stopPropagation(); }}
                            >
                              <ArrowRight size={11} />
                              Open
                            </Button>
                            {onDelete && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDelete(q.queryId);
                                }}
                                disabled={isDeleting}
                              >
                                <AlertTriangle size={11} />
                                Delete
                              </Button>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </div>

                    <motion.div
                      animate={{ rotate: isOpen ? 90 : 0 }}
                      transition={{ duration: 0.2 }}
                      className="shrink-0 text-text-dim mt-0.5"
                    >
                      <ChevronRight size={13} />
                    </motion.div>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })
      )}
    </div>
  );
}

// ─── Empty State ─────────────────────────────────────────────────────────────

function EvidenceEmptyState() {
  return (
    <motion.div
      variants={staggerItem}
      className="flex flex-col items-center justify-center py-16 px-6 text-center"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0.99 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative mb-6"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/20 border border-primary/20">
          <Search size={28} className="text-primary-soft" />
        </div>
        <motion.div
          className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-accent/30"
          animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ repeat: Infinity, duration: 2.5, ease: 'easeInOut' }}
        />
      </motion.div>

      <h3 className="text-sm font-semibold text-text mb-1">No supporting evidence found</h3>
      <p className="text-xs text-text-dim max-w-xs mb-5">
        Ask a question to search your documents. Evidence will appear here with relevance scores and source details.
      </p>

      <div className="space-y-1.5 w-full max-w-xs">
        {[
          { icon: <FileText size={12} />, text: 'Upload more documents' },
          { icon: <Search size={12} />, text: 'Rephrase your question' },
          { icon: <Target size={12} />, text: 'Expand search scope' },
        ].map((tip, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0.99, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 + i * 0.08 }}
            className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-text-dim"
          >
            <span className="text-primary-soft">{tip.icon}</span>
            {tip.text}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

// ─── Evidence Sidebar (Main) ─────────────────────────────────────────────────

const SIDEBAR_TABS = [
  { id: 'reasoning', label: 'AI Reasoning', icon: <Brain size={15} /> },
];

export default function EvidenceSidebar({
  guardrail,
  trustScore,
  trustComponents,
  isLoading,
  isStreaming,
  sidebarOpen,
  onToggleSidebar,
  pipelinePhase,
  isMobile,
}: EvidenceSidebarProps) {
  const effectiveTrust = trustScore ?? 0;


  return (
    <AnimatePresence>
      {sidebarOpen && (
        <motion.aside
          initial={isMobile ? { x: '100%' } : { opacity: 0.99, y: -8 }}
          animate={isMobile ? { x: 0 } : { opacity: 1, y: 0 }}
          exit={isMobile ? { x: '100%' } : { opacity: 0, y: -6 }}
          transition={{ duration: 0.12, ease: 'easeOut' }}
          className={clsx(
            'flex flex-col',
            'lg:w-72',
            'fixed z-30',
            isMobile
              ? 'inset-y-0 right-0 w-full'
              : 'max-h-[60vh]',
            isMobile && !sidebarOpen ? 'translate-x-full' : 'translate-x-0',
          )}
          style={isMobile ? {} : { right: 16, bottom: 96 }}
          drag={isMobile ? false : true}
          dragMomentum={false}
          dragElastic={0.1}
          dragConstraints={{ left: -300, right: 100, top: -80, bottom: 200 }}
          whileDrag={{ scale: 1.03, boxShadow: '0 0 50px rgba(124,92,255,0.2)' }}
        >
          {/* Floating glass card */}
          <div className="flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[rgba(8,11,18,0.7)] backdrop-blur-2xl shadow-2xl shadow-primary/5">
            {/* ─── Drag Handle / Header ──────────────────────────────────── */}
            <div className="shrink-0 px-4 py-3 cursor-grab active:cursor-grabbing">
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
                  <StatusBadge trustScore={effectiveTrust} isLoading={isLoading} />
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
            </div>

            {/* ─── AI Reasoning Content ──────────────────────────────────── */}
            <div className="overflow-y-auto overflow-x-hidden px-4 pb-4 max-h-[60vh]">
              <AIReasoningTab
                guardrail={guardrail}
                trustScore={trustScore}
                trustComponents={trustComponents}
                isLoading={isLoading && !pipelinePhase}
                isStreaming={isStreaming ?? isLoading}
                pipelinePhase={pipelinePhase ?? null}
              />
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
