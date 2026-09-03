/**
 * AbstentionCard — F7c
 *
 * Rendered instead of a normal answer whenever the evidence-sufficiency gate
 * refused to generate (`edge_case === 'insufficient_evidence'`). "I don't know"
 * is a first-class truth claim here, so it gets its own amber treatment rather
 * than being dressed up as a low-trust answer: no citation chips, no feedback
 * thumbs — nothing was generated, so there is nothing to rate or cite.
 *
 * `sufficiency` is optional on purpose. The live WebSocket `complete` frame
 * carries it, but the cache-replay path and persisted history rows only carry
 * `edge_case`; in that case the numbers already live inside the answer text, so
 * the metric line is simply omitted.
 */
import { memo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, PenLine, Upload } from 'lucide-react';
import type { SufficiencyVerdict } from '../api/types';

interface AbstentionCardProps {
  /** Server-authored abstention text (already starts with the refusal sentence). */
  answer?: string;
  /** Present on the live path only — see module docblock. */
  sufficiency?: SufficiencyVerdict | null;
  /** Target for the "Upload a document" chip; falls back to the global browser. */
  workspaceId?: string | null;
  /** Puts the last question back in the composer and focuses it. */
  onRephrase?: () => void;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

// The chip sits *inside* an amber card, so its own `bg-orange/12` used to
// stack tint on tint (composite #E5D2C5) and drag the amber ink down to
// 4.41:1 (QA S3-3). An opaque base stops the stacking; the amber border and
// ink still carry the family.
const chipClass =
  'inline-flex items-center gap-1.5 rounded-full border border-orange/35 bg-solid px-3 py-1.5 text-xs font-semibold text-orange transition-colors hover:bg-orange/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export const AbstentionCard = memo(function AbstentionCard({
  answer,
  sufficiency,
  workspaceId,
  onRephrase,
}: AbstentionCardProps) {
  const uploadHref = workspaceId ? `/workspaces/${workspaceId}` : '/documents';

  return (
    <div
      // The 3px amber rail is a second, non-colour signal: the card still
      // reads as a distinct stop even with the hue desaturated away.
      className="rounded-card border border-orange/35 bg-orange/12 p-4 shadow-[inset_3px_0_0_var(--color-trust-mid)]"
      role="status"
      data-testid="abstention-card"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-orange" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-orange">No sufficient evidence</p>

          {sufficiency ? (
            <p className="mt-1 text-xs tabular-nums text-text-muted">
              {`Searched ${plural(sufficiency.searched_count, 'chunk')} across ${plural(sufficiency.document_count, 'document')} · best evidence score ${sufficiency.top_score.toFixed(2)}`}
            </p>
          ) : null}

          {answer ? (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-text">{answer}</p>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-text">
              I cannot find this information in your documents.
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {onRephrase ? (
              <button type="button" onClick={onRephrase} className={chipClass}>
                <PenLine size={12} aria-hidden="true" />
                Rephrase the question
              </button>
            ) : null}
            <Link to={uploadHref} className={chipClass}>
              <Upload size={12} aria-hidden="true" />
              Upload a document
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
});

export default AbstentionCard;
