// Claim Ledger (Lane D1, fix round 1) — the claim-summary tally-chip row and
// the answer action bar (Copy/Export/feedback/Regenerate/model/latency),
// shared by the live chat's AnswerTurn (ChatPage.tsx) and the stored-answer
// ChatDetailPage. BUG-22: a stored answer used to render neither — just the
// legacy "Chat Detail" chrome with no chips and no actions — so both
// surfaces now render off the same two components instead of drifting.
/* eslint-disable react-refresh/only-export-components */
import { clsx } from 'clsx';
import { Copy, ThumbsUp, ThumbsDown, Clock, Brain, RotateCcw, Download } from 'lucide-react';
import type { Claim } from '../../api/types';
import { VERDICT_META, type ClaimTally } from './verdict';
import { flashRowById, flashRows } from './ClaimLedger';
import { conflictRowId, type ConflictPair } from './conflicts';

/** Clipboard/export text must never leak the internal `[source:N]` marker
 * syntax — replace with the reader-facing bracket number (BUG-9). */
export function stripCitationMarkers(text: string): string {
  return text.replace(/\[source:(\d+)\]/gi, '[$1]');
}

export function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

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

export function ClaimTallyChips({
  claims,
  tally,
  conflictPairs,
  onSelectLedgerView,
}: {
  claims: Claim[];
  tally: ClaimTally;
  conflictPairs: ConflictPair[];
  /** Switches the ledger/prose toggle to "ledger" before jumping to a row. */
  onSelectLedgerView: () => void;
}) {
  const jump = (verdict: Claim['verdict']) => {
    onSelectLedgerView();
    flashRows(claims.map((c, i) => (c.verdict === verdict ? `row-C${i + 1}` : null)).filter((v): v is string => Boolean(v)));
  };
  return (
    <div className="flex flex-wrap gap-0.5" role="group" aria-label="Claim summary">
      {tally.supported > 0 && <TallyChip verdict="supported" count={tally.supported} label="verified" onClick={() => jump('supported')} />}
      {tally.partial > 0 && <TallyChip verdict="partial" count={tally.partial} label="partial" onClick={() => jump('partial')} />}
      {tally.unsupported > 0 && <TallyChip verdict="unsupported" count={tally.unsupported} label="unsupported" onClick={() => jump('unsupported')} />}
      {tally.contradicted > 0 && <TallyChip verdict="contradicted" count={tally.contradicted} label="contradicted" onClick={() => jump('contradicted')} />}
      {conflictPairs.length > 0 && (
        <TallyChip
          verdict="conflict"
          count={conflictPairs.length}
          label="conflict"
          onClick={() => {
            onSelectLedgerView();
            flashRowById(conflictRowId(conflictPairs[0], 'a'));
          }}
        />
      )}
    </div>
  );
}

export function ActionIconButton({ icon: Icon, label, onClick, hoverClass }: { icon: typeof Copy; label: string; onClick: () => void; hoverClass?: string }) {
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

export interface AnswerActionBarProps {
  content: string;
  onCopy: (text: string) => void;
  onExport?: () => void;
  onFeedback?: (rating: number) => void;
  onRegenerate?: () => void;
  /** BUG-31: Regenerate belongs on every complete answer with a queryId, not
   *  only cached ones — callers decide eligibility (e.g. `Boolean(queryId)`). */
  canRegenerate?: boolean;
  servedFromCache?: boolean;
  modelUsed?: string | null;
  latencyMs?: number | null;
}

export function AnswerActionBar({ content, onCopy, onExport, onFeedback, onRegenerate, canRegenerate = false, servedFromCache = false, modelUsed, latencyMs }: AnswerActionBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      <ActionIconButton icon={Copy} label="Copy response" onClick={() => onCopy(stripCitationMarkers(content))} />
      {onExport && <ActionIconButton icon={Download} label="Export as Markdown" onClick={onExport} />}
      {onFeedback && (
        <>
          <ActionIconButton icon={ThumbsUp} label="Good answer" onClick={() => onFeedback(5)} hoverClass="hover:text-green" />
          <ActionIconButton icon={ThumbsDown} label="Bad answer" onClick={() => onFeedback(1)} hoverClass="hover:text-red" />
        </>
      )}
      {canRegenerate && onRegenerate && <ActionIconButton icon={RotateCcw} label="Regenerate with fresh retrieval" onClick={onRegenerate} />}
      <span className="ml-auto flex flex-wrap items-center gap-3 text-xs text-text-dim">
        {servedFromCache && (
          <span className="inline-flex items-center gap-1" title="Served from a valid cached result. Regenerate to run retrieval and generation again.">
            <Clock size={11} aria-hidden="true" /> Cached
          </span>
        )}
        {modelUsed && (
          <span className="inline-flex items-center gap-1">
            <Brain size={12} aria-hidden="true" /> {modelUsed}
          </span>
        )}
        {latencyMs != null && <span>{formatLatency(latencyMs)}</span>}
      </span>
    </div>
  );
}
