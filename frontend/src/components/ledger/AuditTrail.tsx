// Claim Ledger (Lane D1) — "How this answer was verified": a live pipeline
// stepper while the answer is being produced, driven by the WS `progress`
// frames (Searching → Ranking → Writing → Verifying), that collapses to a
// one-line record once the answer completes. Design brief item 2 — this
// replaces the old single "Thinking…" bubble and the evidence panel's
// "⚠ NO EVIDENCE" flash (problem #3): the wait is always shown as purposeful
// progress, never as a failure state.
//
// Exports both the component and its pure step-derivation helper (for a
// fast unit test).
/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { clsx } from 'clsx';
import { ChevronDown, ShieldCheck } from 'lucide-react';
import { useMediaQuery } from '../../utils/useMediaQuery';
import type { ClaimTally } from './verdict';

export type AuditPhase = 'retrieval' | 'ranking' | 'generation' | 'guardrail';
const PHASE_ORDER: AuditPhase[] = ['retrieval', 'ranking', 'generation', 'guardrail'];

type StepId = 'search' | 'rank' | 'write' | 'verify';
type StepStatus = 'pending' | 'active' | 'done' | 'stopped';
const STEP_LABEL: Record<StepId, string> = {
  search: 'Searched passages',
  rank: 'Ranked passages',
  write: 'Wrote answer',
  verify: 'Verified claims',
};
const STEP_LIVE_LABEL: Record<StepId, string> = {
  search: 'Searching passages',
  rank: 'Ranking passages',
  write: 'Writing answer',
  verify: 'Verifying claims',
};

export interface AuditTrailProps {
  /** Is the query still in flight (pending/streaming)? Drives live ticking + aria-live. */
  running: boolean;
  /** Query stopped (user cancel) or failed before verification finished. */
  stopped: boolean;
  /** Last progress phase reported over the socket. */
  phase: AuditPhase | null;
  foundCount: number | null;
  keptCount: number | null;
  /** Authoritative word count from the backend's guardrail-phase progress frame. */
  wordsCount: number | null;
  /** Client-side running word count while streaming, before `wordsCount` arrives. */
  liveWordCount: number;
  documentsSearched: number | null;
  claimsTally: ClaimTally | null;
  modelUsed: string | null;
  /** ms when the query was sent — drives the live "elapsed" clock. */
  startedAt: number | null;
  /** Final latency once the query completes. */
  latencyMs: number | null;
}

/** Exported for unit tests — see AuditTrail.test.ts. */
export function stepStatus(step: StepId, phase: AuditPhase | null, verified: boolean, stopped: boolean): StepStatus {
  if (step === 'verify' && verified) return 'done';
  const phaseForStep: AuditPhase = step === 'search' ? 'retrieval' : step === 'rank' ? 'ranking' : step === 'write' ? 'generation' : 'guardrail';
  const currentIdx = phase ? PHASE_ORDER.indexOf(phase) : -1;
  const stepIdx = PHASE_ORDER.indexOf(phaseForStep);
  if (currentIdx > stepIdx) return 'done';
  if (currentIdx === stepIdx) return stopped ? 'stopped' : 'active';
  return 'pending';
}

function stepDetail(step: StepId, status: StepStatus, p: AuditTrailProps): string {
  const { foundCount, keptCount, wordsCount, liveWordCount, documentsSearched, claimsTally, modelUsed } = p;
  if (status === 'pending' || status === 'stopped') return '';
  if (step === 'search') {
    if (status === 'active') return foundCount != null ? `${foundCount} found` : '';
    if (foundCount == null) return '';
    return documentsSearched ? `${foundCount} found across ${documentsSearched} document${documentsSearched === 1 ? '' : 's'}` : `${foundCount} found`;
  }
  if (step === 'rank') {
    if (status === 'active') return foundCount != null ? `Scoring ${foundCount} passages` : '';
    if (keptCount == null) return '';
    return foundCount != null ? `Kept the top ${keptCount} of ${foundCount}` : `Kept ${keptCount}`;
  }
  if (step === 'write') {
    if (status === 'active') return liveWordCount > 0 ? `${liveWordCount} words` : '';
    if (wordsCount == null) return '';
    return modelUsed ? `${wordsCount} words from ${modelUsed}` : `${wordsCount} words`;
  }
  // verify
  if (status === 'active') return '';
  if (!claimsTally) return '';
  const bits: string[] = [];
  if (claimsTally.supported) bits.push(`${claimsTally.supported} verified`);
  if (claimsTally.partial) bits.push(`${claimsTally.partial} partial`);
  if (claimsTally.unsupported) bits.push(`${claimsTally.unsupported} unsupported`);
  if (claimsTally.contradicted) bits.push(`${claimsTally.contradicted} contradicted`);
  return `Checked ${claimsTally.total} claim${claimsTally.total === 1 ? '' : 's'}${bits.length ? ': ' + bits.join(', ') : ''}`;
}

function formatElapsed(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Ticks every 100ms while `running`, otherwise reports the frozen final value. */
function useElapsed(startedAt: number | null, running: boolean, frozenMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running || startedAt == null) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [running, startedAt]);
  if (frozenMs != null) return frozenMs;
  if (startedAt == null) return 0;
  return Math.max(0, now - startedAt);
}

export function AuditTrail(props: AuditTrailProps) {
  const { running, stopped, phase, claimsTally, latencyMs, startedAt } = props;
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [open, setOpen] = useState(running);
  // Auto-open while live, auto-collapse the instant it settles — but leave the
  // user's own toggle alone afterwards (matches the prototype: expand while
  // answering, then collapse to the one-line record). Adjusted during render
  // (React's documented pattern for state derived from a changed prop) rather
  // than in an effect, so a transition doesn't cost an extra render pass.
  const [prevRunning, setPrevRunning] = useState(running);
  if (running !== prevRunning) {
    setPrevRunning(running);
    setOpen(running);
  }

  const verified = claimsTally != null;
  const steps: StepId[] = ['search', 'rank', 'write', 'verify'];
  const statuses = steps.map((s) => stepStatus(s, phase, verified, stopped));
  const elapsedMs = useElapsed(startedAt, running, latencyMs);

  const title = stopped ? 'Stopped before verification' : running ? 'Answering' : 'How this answer was verified';
  const doneCount = statuses.filter((s) => s === 'done').length;
  const summary = running
    ? `${formatElapsed(elapsedMs)} elapsed`
    : stopped
      ? `Stopped after ${doneCount} of 4 steps`
      : `${doneCount} steps, ${formatElapsed(elapsedMs)}`;

  const liveAnnouncement = running
    ? STEP_LIVE_LABEL[steps[statuses.findIndex((s) => s === 'active')] ?? 'search']
    : stopped
      ? 'Stopped'
      : claimsTally
        ? `Answer verified: ${stepDetail('verify', 'done', props)}`
        : '';

  return (
    <section className="rounded-card border border-border bg-solid" aria-label="Verification record">
      <p className="sr-only" role="status" aria-live="polite">{liveAnnouncement}</p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="audit-trail-body"
        className="flex min-h-11 w-full items-center gap-2.5 rounded-card px-3.5 py-2 text-sm hover:bg-card-2"
      >
        <ShieldCheck size={16} className={clsx(running ? 'text-primary-soft' : 'text-green')} aria-hidden="true" />
        <span className="font-medium text-text">{title}</span>
        <span className="text-xs text-text-dim tabular-nums">{summary}</span>
        <ChevronDown
          size={15}
          className={clsx('ml-auto text-text-dim transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id="audit-trail-body"
            initial={reduceMotion ? undefined : { height: 0, opacity: 0.99 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduceMotion ? undefined : { height: 0, opacity: 0.99 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <ol className="space-y-0 px-3.5 pb-2 pt-0.5">
              {steps.map((step, i) => {
                const status = statuses[i];
                const label = status === 'active' ? STEP_LIVE_LABEL[step] : STEP_LABEL[step];
                const detail = stepDetail(step, status, props);
                return (
                  <li key={step} className="flex items-start gap-2.5 py-1.5">
                    <span
                      className={clsx(
                        'mt-1 h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px]',
                        status === 'done' && 'border-text-muted bg-text-muted',
                        status === 'active' && 'border-primary shadow-[inset_0_0_0_2px_var(--color-solid),inset_0_0_0_4px_var(--color-primary)]',
                        status === 'stopped' && 'border-dashed border-text-dim',
                        status === 'pending' && 'border-border border-border-light',
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 text-[13px] leading-6">
                      <span className={clsx('font-medium', status === 'pending' && 'font-normal text-text-dim')}>{label}</span>
                      {detail && <span className="ml-2 text-text-muted">{detail}</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="border-t border-border-light px-3.5 py-2 text-xs text-text-dim">
              Ran on this machine{props.modelUsed ? ` with ${props.modelUsed}` : ''}. No text left the device.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
