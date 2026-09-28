import { useMemo } from 'react';
import { diffWordsWithSpace, type Change } from 'diff';
import { FileText, Eye, X, Check } from 'lucide-react';
import { clsx } from 'clsx';
import { Button, Card, Badge, type BadgeColor } from '../ui';
import type { Contradiction, ContradictionSide, ContradictionStatus } from '../../api/types';

// ─── Status → badge color (fixed meanings, see ui.tsx Badge comment) ───────
const statusBadge: Record<ContradictionStatus, { color: BadgeColor; label: string }> = {
  open: { color: 'red', label: 'Open' },
  dismissed: { color: 'gray', label: 'Dismissed' },
  resolved: { color: 'green', label: 'Resolved' },
};

function confidenceColor(score: number): BadgeColor {
  if (score >= 0.9) return 'red';
  if (score >= 0.8) return 'orange';
  return 'gray';
}

/** Word-level diff, rendered as two filtered views of the same change list so
 * each side only shows what differs *on that side* — additions on B,
 * removals on A — instead of a unified diff neither sentence reads cleanly. */
function DiffSentence({ parts, side }: { parts: Change[]; side: 'a' | 'b' }) {
  return (
    <p className="text-[13px] leading-relaxed text-text">
      {parts
        .filter((part) => (side === 'a' ? !part.added : !part.removed))
        .map((part, i) => {
          const isDiff = side === 'a' ? part.removed : part.added;
          if (!isDiff) return <span key={i}>{part.value}</span>;
          return (
            <mark key={i} className="rounded bg-red/15 px-0.5 font-semibold text-red">
              {part.value}
            </mark>
          );
        })}
    </p>
  );
}

function SideView({
  side,
  parts,
  mode,
  onView,
}: {
  side: ContradictionSide;
  parts: Change[];
  mode: 'a' | 'b';
  onView: () => void;
}) {
  return (
    <div className="min-w-0 space-y-2 rounded-lg border border-border bg-card-2 p-3.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-text-dim">
        <FileText size={12} className="shrink-0" />
        <span className="truncate">{side.document_name}</span>
        {side.page_number != null && <span className="shrink-0">· p.{side.page_number}</span>}
      </div>
      <DiffSentence parts={parts} side={mode} />
      <Button size="sm" variant="ghost" onClick={onView} aria-label={`View this passage in ${side.document_name}`}>
        <Eye size={13} /> View in document
      </Button>
    </div>
  );
}

export default function ConflictCard({
  contradiction,
  canModerate,
  updating,
  onView,
  onDismiss,
  onResolve,
}: {
  contradiction: Contradiction;
  canModerate: boolean;
  /** Which mutation is in flight for *this* card, if any — drives per-button spinners. */
  updating: 'dismiss' | 'resolve' | null;
  onView: (side: ContradictionSide) => void;
  onDismiss: () => void;
  onResolve: () => void;
}) {
  const { a, b } = contradiction;
  const parts = useMemo(() => diffWordsWithSpace(a.sentence, b.sentence), [a.sentence, b.sentence]);
  const status = statusBadge[contradiction.status];
  const busy = updating !== null;

  return (
    <li>
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-text-dim">
            <Badge color={status.color}>{status.label}</Badge>
            <span className="tabular-nums">{Math.round(contradiction.similarity * 100)}% similar passages</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-dim">Confidence</span>
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-card-hover">
              <div
                className={clsx(
                  'h-full rounded-full',
                  confidenceColor(contradiction.score) === 'red' ? 'bg-red' :
                  confidenceColor(contradiction.score) === 'orange' ? 'bg-orange' :
                  'bg-text-dim',
                )}
                style={{ width: `${Math.round(contradiction.score * 100)}%` }}
              />
            </div>
            <span className="text-xs font-medium tabular-nums text-text-dim">{Math.round(contradiction.score * 100)}%</span>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <SideView side={a} parts={parts} mode="a" onView={() => onView(a)} />
          <SideView side={b} parts={parts} mode="b" onView={() => onView(b)} />
        </div>

        {canModerate && contradiction.status === 'open' && (
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button size="sm" variant="secondary" disabled={busy} loading={updating === 'dismiss'} onClick={onDismiss}>
              <X size={14} /> Dismiss
            </Button>
            <Button size="sm" disabled={busy} loading={updating === 'resolve'} onClick={onResolve}>
              <Check size={14} /> Mark resolved
            </Button>
          </div>
        )}
      </Card>
    </li>
  );
}
