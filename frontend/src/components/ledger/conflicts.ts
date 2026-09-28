// Claim Ledger (Lane D1) — pairs claims whose cited chunks are on opposite
// sides of an open Contradiction Radar (L5/L6) pair, so the ledger can draw
// the "Differs from Cn" cross-reference and a discrepancy (D-) row between
// them (design brief item 5).
import type { Claim, Contradiction, Source } from '../../api/types';

export interface ConflictPair {
  /** -1 when this side's chunk isn't cited by any claim in this answer —
   *  the D-row still renders, reading straight off `contradiction.a`/`.b`
   *  (BUG-5: a planted contradiction must not disappear just because the
   *  answer only quoted one side of it). */
  claimAIndex: number;
  claimBIndex: number;
  contradiction: Contradiction;
}

/** Every open contradiction with at least one side cited by a claim in this
 *  answer — the uncited side (if any) carries a -1 index and falls back to
 *  the radar's own sentence/doc data (BUG-5). */
export function pairClaimConflicts(claims: Claim[], contradictions: Contradiction[]): ConflictPair[] {
  const pairs: ConflictPair[] = [];
  for (const contradiction of contradictions) {
    const claimAIndex = claims.findIndex((c) => c.chunk_id && c.chunk_id === contradiction.a.chunk_id);
    const claimBIndex = claims.findIndex((c) => c.chunk_id && c.chunk_id === contradiction.b.chunk_id);
    if (claimAIndex === -1 && claimBIndex === -1) continue;
    if (claimAIndex !== -1 && claimAIndex === claimBIndex) continue;
    pairs.push({ claimAIndex, claimBIndex, contradiction });
  }
  return pairs;
}

/** DOM id of the row a conflict pair's chip should jump to when clicked — the
 * partner claim's own row if it's cited in this answer, else the discrepancy
 * row itself (there's no claim row to jump to for an uncited partner). */
export function conflictRowId(pair: ConflictPair, side: 'a' | 'b' = 'a'): string {
  const index = side === 'a' ? pair.claimAIndex : pair.claimBIndex;
  return index !== -1 ? `row-C${index + 1}` : `row-D-${pair.contradiction.id}`;
}

/** Client-side fallback for a source's open-contradiction count. Live chat's
 * WS `sources` event already sets `Source.conflicts` server-side; a stored
 * answer's persisted `response_sources` never carried it (BUG-22), so the
 * Exhibits "Conflict" tag would silently vanish on `/chat/:id` — recompute
 * it from the same open-contradictions list the ledger already fetches. */
export function countSourceConflicts(sources: Source[], contradictions: Contradiction[]): Source[] {
  if (contradictions.length === 0 || sources.every((s) => s.conflicts != null)) return sources;
  const counts = new Map<string, number>();
  for (const c of contradictions) {
    counts.set(c.a.chunk_id, (counts.get(c.a.chunk_id) ?? 0) + 1);
    counts.set(c.b.chunk_id, (counts.get(c.b.chunk_id) ?? 0) + 1);
  }
  return sources.map((s) => (s.conflicts != null ? s : { ...s, conflicts: counts.get(s.chunk_id) ?? 0 }));
}

/** First number (with an optional unit word/symbol) found in a claim's text. */
export interface ExtractedFigure {
  raw: string;
  value: number;
  unit: string;
}

// ponytail: single-figure, single-locale heuristic (₤/€/$ + optional
// scale word) — good enough for the demo corpus's "€412 million" style
// claims. Multi-figure or non-Western-numeral claims fall back to showing
// both raw strings with no computed difference (see figureDiff below).
const FIGURE_RE = /([€$£]?)\s?([\d,]+(?:\.\d+)?)\s?(million|billion|thousand|%|bn|m|k)?/i;

export function extractFigure(text: string): ExtractedFigure | null {
  const match = FIGURE_RE.exec(text);
  if (!match || !match[2]) return null;
  const value = Number(match[2].replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  const unit = `${match[1] ?? ''}${match[3] ? ` ${match[3].toLowerCase()}` : ''}`.trim();
  return { raw: match[0].trim(), value, unit };
}

/** Numeric difference between two figures' source texts, only when their
 * units match. Takes raw text (a claim's own wording, or — for a D-row whose
 * partner isn't cited by any claim — the radar's own sentence) rather than a
 * `Claim`, so a discrepancy row can diff either side regardless of whether
 * it's a cited claim or a raw contradiction sentence (BUG-5). */
export function figureDiff(textA: string, textB: string): { a: ExtractedFigure; b: ExtractedFigure; diff: number } | null {
  const figA = extractFigure(textA);
  const figB = extractFigure(textB);
  if (!figA || !figB || figA.unit !== figB.unit) return null;
  return { a: figA, b: figB, diff: Math.abs(figA.value - figB.value) };
}

const SCALE_SUFFIX: Record<string, string> = { million: 'M', billion: 'B', thousand: 'K', m: 'M', bn: 'B', k: 'K' };

/** Human-readable label for a D-row's numeric difference (BUG-29: a bare
 * "7" with no unit reads as a typo, not a real number — the prototype shows
 * "€14M" for a currency+scale figure, so mirror the figure's own unit
 * instead of a naked count; an entirely unit-less figure (a raw score or
 * headcount) is labelled "pts" so it never looks unitless). */
export function formatFigureDiff({ diff, a }: { diff: number; a: ExtractedFigure }): string {
  const n = diff.toLocaleString();
  const symbol = a.unit.match(/^[€$£]/)?.[0] ?? '';
  const rest = a.unit.replace(/^[€$£]\s*/, '');
  if (symbol && rest) return `${symbol}${n}${SCALE_SUFFIX[rest] ?? ` ${rest}`}`;
  if (symbol) return `${symbol}${n}`;
  if (rest === '%') return `${n}%`;
  if (rest) return `${n} ${rest}`;
  return `${n} pts`;
}
