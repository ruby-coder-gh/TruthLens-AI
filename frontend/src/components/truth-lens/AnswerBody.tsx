// Truth Lens (L2) — shared answer renderer for ChatPage + ChatDetailPage.
//
// Owns two concerns that used to live only in ChatPage:
//   1. Markdown + clickable `[source:N]` citation chips (moved here verbatim
//      so ChatDetailPage stops showing the raw `[source:N]` marker text).
//   2. The Truth Lens overlay: per-claim verdict-coloured spans, a summary
//      chip, and a collapsible claim ledger, driven by `Claim[]` from the
//      guardrail frame (WS) or `QueryDetail.claims` (REST).
//
// Also exports a test-only reset helper alongside the component (like
// SourceViewerContext's provider+hook split) — disabling react-refresh's
// single-component-export rule here is deliberate.
/* eslint-disable react-refresh/only-export-components */
import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  useSyncExternalStore,
  memo,
  type ReactNode,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ChevronDown,
  ScanEye,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Ban,
  FileText,
  ExternalLink,
} from 'lucide-react';
import { Badge, type BadgeColor } from '../ui';
import { useSourceViewer } from '../../context/SourceViewerContext';
import { relevancePercent } from '../../utils/relevance';
import type { Claim, ClaimVerdict, Source } from '../../api/types';

type OnSourceClick = (source: Source, e: MouseEvent, msgId: string, index: number) => void;

// ─── Truth Lens toggle — one shared, localStorage-persisted flag ───────────
// Every AnswerBody instance on the page (one per answer bubble) subscribes to
// the same store, so flipping the toggle on one answer flips it everywhere,
// and it survives a reload. No context/provider needed: a module-level
// pub-sub is the whole ask ("global", not "shared via props").
const LENS_STORAGE_KEY = 'truthlens:lens-on';
const lensListeners = new Set<() => void>();
/** Session-only fallback for when localStorage throws (private mode). */
let lensMemoryFallback = false;

function readLensState(): boolean {
  try {
    return window.localStorage.getItem(LENS_STORAGE_KEY) === '1';
  } catch {
    return lensMemoryFallback;
  }
}

function setLensState(next: boolean): void {
  lensMemoryFallback = next;
  try {
    window.localStorage.setItem(LENS_STORAGE_KEY, next ? '1' : '0');
  } catch {
    // Storage unavailable — the in-memory fallback still drives this session.
  }
  lensListeners.forEach((notify) => notify());
}

function subscribeLens(listener: () => void): () => void {
  lensListeners.add(listener);
  return () => lensListeners.delete(listener);
}

function useTruthLensOn(): [boolean, (next: boolean) => void] {
  const on = useSyncExternalStore(subscribeLens, readLensState);
  return [on, setLensState];
}

/**
 * Test-only escape hatch: this jsdom setup has no `window.localStorage`
 * (confirmed — accessing it is `undefined`, not a throw), so the toggle's
 * only persistence is the in-memory fallback above, which is otherwise a
 * static module singleton that would leak the ON state across `it()` blocks.
 */
export function __resetTruthLensForTests(): void {
  lensMemoryFallback = false;
}

// ─── Verdict metadata ───────────────────────────────────────────────────────

const VERDICT_META: Record<
  ClaimVerdict,
  { label: string; icon: typeof CheckCircle2; textClass: string; badgeColor: BadgeColor; markClass: string }
> = {
  supported: {
    label: 'Supported',
    icon: CheckCircle2,
    textClass: 'text-green',
    badgeColor: 'green',
    markClass: 'bg-green/10 underline decoration-green decoration-2 underline-offset-2',
  },
  partial: {
    label: 'Partially supported',
    icon: AlertTriangle,
    textClass: 'text-orange',
    badgeColor: 'orange',
    markClass: 'bg-orange/10 underline decoration-orange decoration-2 decoration-dashed underline-offset-2',
  },
  unsupported: {
    label: 'Unsupported',
    icon: AlertCircle,
    textClass: 'text-red',
    badgeColor: 'red',
    markClass: 'bg-red/10 underline decoration-red decoration-2 decoration-wavy underline-offset-2',
  },
  contradicted: {
    label: 'Contradicted',
    icon: Ban,
    textClass: 'text-red',
    badgeColor: 'red',
    markClass: 'bg-red/15 underline decoration-red decoration-2 decoration-wavy underline-offset-2',
  },
};

function claimSpanId(messageId: string, index: number): string {
  return `claim-${messageId}-${index}`;
}

interface ClaimSummary {
  total: number;
  supported: number;
  partial: number;
  unsupported: number;
  contradicted: number;
}

function summarizeClaims(claims: Claim[]): ClaimSummary {
  const summary: ClaimSummary = { total: claims.length, supported: 0, partial: 0, unsupported: 0, contradicted: 0 };
  for (const claim of claims) {
    if (claim.verdict === 'supported') summary.supported += 1;
    else if (claim.verdict === 'partial') summary.partial += 1;
    else if (claim.verdict === 'unsupported') summary.unsupported += 1;
    else if (claim.verdict === 'contradicted') summary.contradicted += 1;
  }
  return summary;
}

function summaryText(s: ClaimSummary): string {
  const bits = [`${s.total} claim${s.total !== 1 ? 's' : ''}`];
  if (s.supported > 0) bits.push(`${s.supported} verified`);
  if (s.partial > 0) bits.push(`${s.partial} partial`);
  if (s.unsupported > 0) bits.push(`${s.unsupported} unsupported`);
  if (s.contradicted > 0) bits.push(`${s.contradicted} contradicted`);
  return bits.join(' · ');
}

/** The source a claim cites, resolved the same way `[source:N]` markers are. */
function claimSource(claim: Claim, sources: Source[]): Source | undefined {
  if (claim.source_index != null) {
    const bySourceIndex = sources[claim.source_index - 1];
    if (bySourceIndex) return bySourceIndex;
  }
  if (claim.chunk_id) {
    return sources.find((s) => s.chunk_id === claim.chunk_id);
  }
  return undefined;
}

// ─── Citation hover card — shows source excerpt on hover/focus ──────────────
// Moved verbatim from ChatPage so both pages share one implementation.

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
    }, 300);
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
      <span ref={triggerRef} onMouseEnter={showCard} onMouseLeave={hideCard} className="relative inline-flex">
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
          className="fixed z-[70] w-80 overflow-hidden rounded-card border border-border bg-solid shadow-e3"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="px-4 pt-3 pb-2 border-b border-border-light">
            <div className="flex items-center gap-2">
              <FileText size={14} className="text-primary-soft shrink-0" />
              <span className="truncate font-mono text-sm font-medium text-primary-soft">{docName}</span>
              <span className="ml-auto font-mono text-[10px] text-text-dim tabular-nums">{relevancePct}%</span>
            </div>
          </div>
          <div className="px-4 py-3 max-h-28 overflow-y-auto">
            <p className="font-quote line-clamp-4 text-[13px] leading-relaxed text-text">
              {source.excerpt || 'No excerpt available'}
            </p>
          </div>
          <div className="px-4 pb-3">
            <div className="h-1 rounded-full bg-card-2 overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${relevancePct}%` }} />
            </div>
          </div>
          <div className="px-4 pb-3 flex items-center gap-1.5 text-[10px] text-text-dim border-t border-border-light pt-2">
            Click to locate in sidebar
          </div>
        </motion.div>,
        document.body,
      )}
    </>
  );
});

// ─── Render message with clickable citation markers (lens OFF / no claims) ──
// Moved verbatim from ChatPage.tsx.

function renderMessageWithCitations(
  messageId: string,
  content: string,
  sources: Source[],
  onSourceClick: OnSourceClick,
): ReactNode {
  const parts = content.split(/(\[source:\d+\])/gi);
  if (parts.length <= 1) {
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    );
  }

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

// ─── Inline citation renderer for lens-on segments ──────────────────────────
// ponytail: plain text, not markdown — a claim/plain segment sits inside an
// inline <span>, and re-running ReactMarkdown per segment would nest its
// block-level <p> illegally. Bold/italic inside an answer are lost while the
// lens is on; upgrade to an offset-aware markdown-AST walker if that turns
// out to matter for the demo corpus.
function renderInlineWithCitations(
  messageId: string,
  keySeed: string,
  text: string,
  sources: Source[],
  onSourceClick: OnSourceClick,
): ReactNode {
  const normalized = text.replace(/[ \t]*\n[ \t]*/g, ' ');
  const parts = normalized.split(/(\[source:\d+\])/gi);
  if (parts.length <= 1) return parts[0] || null;

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
              <CitationHoverCard key={`${keySeed}-c${i}`} source={source}>
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
          return (
            <sup key={`${keySeed}-c${i}`} className="footnote-ref !text-text-dim" title="Source unavailable">
              {idx + 1}
            </sup>
          );
        }
        return <span key={`${keySeed}-t${i}`}>{part}</span>;
      })}
    </>
  );
}

// ─── Claim hover/focus card — verdict, entailment, evidence, "View in document" ─

interface ClaimSpanProps {
  messageId: string;
  index: number;
  claim: Claim;
  workspaceId?: string;
  hasConflict: boolean;
  flashed: boolean;
  children: ReactNode;
}

function ClaimSpan({ messageId, index, claim, workspaceId, hasConflict, flashed, children }: ClaimSpanProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { open: openViewer } = useSourceViewer();
  const meta = VERDICT_META[claim.verdict];
  const Icon = meta.icon;
  const spanId = claimSpanId(messageId, index);
  const cardId = `${spanId}-card`;

  const clearTimers = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
  };

  const show = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 8, left: Math.min(rect.left, window.innerWidth - 340) });
    }
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setOpen(true);
  }, []);

  const scheduleShow = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(show, 250);
  }, [show]);

  const hideNow = useCallback(() => {
    clearTimers();
    setOpen(false);
  }, []);

  // Blur/mouse-leave hide on a short delay rather than instantly — a click on
  // the "View in document" button inside the portal fires blur on this span
  // first (it's a separate DOM subtree, not a descendant), and an immediate
  // hide would unmount the button before its own click event ever arrives.
  const scheduleHide = useCallback(() => {
    clearTimers();
    hideTimer.current = setTimeout(() => setOpen(false), 200);
  }, []);

  useEffect(() => () => clearTimers(), []);

  const handleKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      show();
    } else if (e.key === 'Escape') {
      hideNow();
    }
  };

  const canView = Boolean(workspaceId && claim.document_id && claim.chunk_id);
  const handleViewInDocument = () => {
    if (!canView || !workspaceId || !claim.document_id || !claim.chunk_id) return;
    openViewer({
      workspaceId,
      documentId: claim.document_id,
      chunkId: claim.chunk_id,
      documentName: claim.document_name ?? undefined,
      pageNumber: claim.page_number ?? undefined,
    });
  };

  return (
    <>
      <span
        id={spanId}
        ref={triggerRef}
        tabIndex={0}
        role="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-describedby={open ? cardId : undefined}
        aria-label={`${meta.label} claim, ${Math.round(claim.entailment * 100)}% entailment`}
        onMouseEnter={scheduleShow}
        onMouseLeave={scheduleHide}
        onFocus={show}
        onBlur={scheduleHide}
        onKeyDown={handleKeyDown}
        className={clsx(
          'rounded-sm cursor-pointer transition-shadow duration-500',
          meta.markClass,
          flashed && 'ring-2 ring-primary/60 ring-offset-1',
        )}
      >
        {claim.verdict === 'contradicted' && (
          <Ban size={12} className="mr-0.5 mb-[1px] inline text-red" aria-hidden="true" />
        )}
        {children}
      </span>
      {open && createPortal(
        <motion.div
          id={cardId}
          initial={{ opacity: 0.99, y: -4, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0.99, y: -4, scale: 0.97 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          onMouseEnter={show}
          onMouseLeave={scheduleHide}
          onFocus={show}
          onBlur={scheduleHide}
          className="fixed z-[70] w-80 overflow-hidden rounded-card border border-border bg-solid shadow-e3"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="flex items-center gap-2 border-b border-border-light px-4 pt-3 pb-2">
            <Icon size={14} className={meta.textClass} aria-hidden="true" />
            <span className={clsx('text-sm font-semibold', meta.textClass)}>{meta.label}</span>
            <span className="ml-auto font-mono text-[10px] text-text-dim tabular-nums">
              {Math.round(claim.entailment * 100)}% entailment
            </span>
          </div>
          <div className="px-4 py-3 space-y-2">
            {claim.evidence && (
              <p className="font-quote line-clamp-4 text-[13px] leading-relaxed text-text">“{claim.evidence}”</p>
            )}
            {(claim.document_name || claim.page_number) && (
              <p className="flex items-center gap-1 text-[11px] text-text-dim">
                <FileText size={11} aria-hidden="true" />
                {claim.document_name ?? 'Source document'}
                {claim.page_number ? ` · p.${claim.page_number}` : ''}
              </p>
            )}
            {hasConflict && (
              <p className="flex items-center gap-1 text-[11px] text-orange">
                <AlertTriangle size={11} aria-hidden="true" />
                Another document disagrees
              </p>
            )}
          </div>
          {canView && (
            <button
              type="button"
              onClick={handleViewInDocument}
              className="flex w-full items-center gap-1.5 border-t border-border-light px-4 py-2 text-xs font-medium text-primary-soft hover:bg-primary/10"
            >
              <ExternalLink size={12} aria-hidden="true" />
              View in document
            </button>
          )}
        </motion.div>,
        document.body,
      )}
    </>
  );
}

// ─── Paragraph splitting + claim-span segmentation (lens ON) ────────────────

interface Paragraph {
  text: string;
  start: number;
}

function splitParagraphs(content: string): Paragraph[] {
  const result: Paragraph[] = [];
  const re = /\n\s*\n+/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    result.push({ text: content.slice(lastIndex, match.index), start: lastIndex });
    lastIndex = re.lastIndex;
  }
  result.push({ text: content.slice(lastIndex), start: lastIndex });
  return result.filter((p) => p.text.trim().length > 0);
}

function renderLensAnswer(
  messageId: string,
  content: string,
  claims: Claim[],
  sources: Source[],
  onSourceClick: OnSourceClick,
  workspaceId: string | undefined,
  flashedClaimKey: string | null,
): ReactNode {
  // Only claims with a valid, in-range offset can be drawn inline — claims
  // the backend couldn't locate (`start === -1`) still appear in the ledger.
  const placed = claims
    .map((claim, index) => ({ claim, index }))
    .filter(({ claim }) => claim.start >= 0 && claim.end > claim.start && claim.end <= content.length)
    .sort((a, b) => a.claim.start - b.claim.start);

  // Defensive: drop any claim whose range overlaps one already placed, so an
  // imperfect offset list never crashes the lens view.
  const nonOverlapping: typeof placed = [];
  let boundary = 0;
  for (const item of placed) {
    if (item.claim.start >= boundary) {
      nonOverlapping.push(item);
      boundary = item.claim.end;
    }
  }

  const paragraphs = splitParagraphs(content);

  return (
    <>
      {paragraphs.map((para, pIdx) => {
        const paraEnd = para.start + para.text.length;
        const relevant = nonOverlapping.filter(({ claim }) => claim.start >= para.start && claim.end <= paraEnd);

        let body: ReactNode;
        if (relevant.length === 0) {
          body = renderInlineWithCitations(messageId, `p${pIdx}`, para.text, sources, onSourceClick);
        } else {
          const nodes: ReactNode[] = [];
          let cursor = para.start;
          relevant.forEach(({ claim, index }, i) => {
            if (claim.start > cursor) {
              const plain = para.text.slice(cursor - para.start, claim.start - para.start);
              nodes.push(
                <span key={`p${pIdx}-plain${i}`}>
                  {renderInlineWithCitations(messageId, `p${pIdx}-plain${i}`, plain, sources, onSourceClick)}
                </span>,
              );
            }
            const claimText = para.text.slice(claim.start - para.start, claim.end - para.start);
            const spanId = claimSpanId(messageId, index);
            const source = claimSource(claim, sources);
            nodes.push(
              <ClaimSpan
                key={spanId}
                messageId={messageId}
                index={index}
                claim={claim}
                workspaceId={workspaceId}
                hasConflict={(source?.conflicts ?? 0) > 0}
                flashed={flashedClaimKey === spanId}
              >
                {renderInlineWithCitations(messageId, `${spanId}-t`, claimText, sources, onSourceClick)}
              </ClaimSpan>,
            );
            cursor = claim.end;
          });
          if (cursor < paraEnd) {
            const tail = para.text.slice(cursor - para.start);
            nodes.push(
              <span key={`p${pIdx}-tail`}>
                {renderInlineWithCitations(messageId, `p${pIdx}-tail`, tail, sources, onSourceClick)}
              </span>,
            );
          }
          body = nodes;
        }

        return (
          <p key={pIdx} className={pIdx > 0 ? 'mt-3' : undefined}>
            {body}
          </p>
        );
      })}
    </>
  );
}

// ─── Claim ledger ────────────────────────────────────────────────────────────

function LedgerRow({
  claim,
  onJump,
}: {
  claim: Claim;
  onJump: (() => void) | null;
}) {
  const meta = VERDICT_META[claim.verdict];
  const Icon = meta.icon;
  const content = (
    <>
      <Icon size={13} className={clsx('mt-0.5 shrink-0', meta.textClass)} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{claim.text}</span>
      <Badge color={meta.badgeColor} className="shrink-0 text-[10px]">{meta.label}</Badge>
    </>
  );

  if (!onJump) {
    return (
      <div className="flex w-full items-start gap-2 rounded-control border border-border bg-card-2 px-2.5 py-1.5 text-xs text-text-muted opacity-80">
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onJump}
      className="flex w-full items-start gap-2 rounded-control border border-border bg-card-2 px-2.5 py-1.5 text-left text-xs text-text-muted transition-colors hover:border-primary/30 hover:text-text"
    >
      {content}
    </button>
  );
}

// ─── Public component ────────────────────────────────────────────────────────

export interface AnswerBodyProps {
  messageId: string;
  content: string;
  sources: Source[];
  /** Truth Lens (L1) per-claim verdicts. Absent/empty ⇒ no lens UI at all. */
  claims?: Claim[] | null;
  /** Needed for "View in document"; omit where there's no workspace context. */
  workspaceId?: string;
  onSourceClick: OnSourceClick;
}

export const AnswerBody = memo(function AnswerBody({
  messageId,
  content,
  sources,
  claims,
  workspaceId,
  onSourceClick,
}: AnswerBodyProps) {
  const [lensOn, setLensOn] = useTruthLensOn();
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [flashedClaimKey, setFlashedClaimKey] = useState<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
  }, []);

  const claimList = useMemo(() => claims ?? [], [claims]);
  const hasClaims = claimList.length > 0;
  const summary = useMemo(() => summarizeClaims(claimList), [claimList]);
  const ledgerId = `claim-ledger-${messageId}`;

  const jumpToClaim = useCallback(
    (index: number, start: number) => {
      if (start < 0) return;
      const key = claimSpanId(messageId, index);
      const scrollAndFlash = () => {
        document.getElementById(key)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        setFlashedClaimKey(key);
        flashTimerRef.current = setTimeout(() => setFlashedClaimKey(null), 1400);
      };
      if (!lensOn) {
        setLensOn(true);
        // Let the lens render mount the target span before scrolling to it.
        setTimeout(scrollAndFlash, 30);
      } else {
        scrollAndFlash();
      }
    },
    [lensOn, messageId, setLensOn],
  );

  return (
    <div className="space-y-3">
      <div className="text-sm text-text leading-relaxed">
        {lensOn && hasClaims
          ? renderLensAnswer(messageId, content, claimList, sources, onSourceClick, workspaceId, flashedClaimKey)
          : renderMessageWithCitations(messageId, content, sources, onSourceClick)}
      </div>

      {hasClaims && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border-light pt-3">
          <span className="rounded-full border border-border bg-card-2 px-2.5 py-1 text-[11px] font-medium text-text-muted">
            {summaryText(summary)}
          </span>
          <button
            type="button"
            onClick={() => setLensOn(!lensOn)}
            aria-pressed={lensOn}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
              lensOn
                ? 'border-primary/50 bg-primary/15 text-primary-soft'
                : 'border-border bg-card-2 text-text-muted hover:text-text',
            )}
          >
            <ScanEye size={13} aria-hidden="true" />
            Truth Lens
          </button>
        </div>
      )}

      {hasClaims && (
        <div className="border-t border-border-light pt-2">
          <button
            type="button"
            onClick={() => setLedgerOpen((v) => !v)}
            aria-expanded={ledgerOpen}
            aria-controls={ledgerId}
            className="flex items-center gap-1.5 text-xs font-medium text-text-muted hover:text-text"
          >
            <ChevronDown size={13} className={clsx('transition-transform', !ledgerOpen && '-rotate-90')} aria-hidden="true" />
            Claim ledger ({summary.total})
          </button>
          <AnimatePresence>
            {ledgerOpen && (
              <motion.ul
                id={ledgerId}
                initial={{ opacity: 0.99, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0.99, height: 0 }}
                transition={{ duration: 0.2 }}
                className="mt-2 space-y-1.5 overflow-hidden"
              >
                {claimList.map((claim, i) => (
                  <li key={claimSpanId(messageId, i)}>
                    <LedgerRow
                      claim={claim}
                      onJump={claim.start >= 0 ? () => jumpToClaim(i, claim.start) : null}
                    />
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
});
