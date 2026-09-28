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

// R2-3: a chunk can be page-sized and carry several unrelated facts (the AR's
// page 1 chunk has the revenue figure, the CEO's start date *and* the
// emissions figure) — matching on `chunk_id` alone attached every open
// contradiction that merely touched that page to every claim that cited it.
// A claim only "belongs" to a contradiction side when its own wording (text
// or cited evidence) actually shares a number or a distinguishing word with
// that side's sentence.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'these', 'those', 'was', 'were', 'are', 'been', 'have',
  'has', 'had', 'will', 'would', 'could', 'should', 'their', 'they', 'them', 'into', 'over', 'than', 'then',
  'also', 'which', 'while', 'about', 'across', 'after', 'before', 'during', 'under', 'both', 'source', 'sources',
  'report', 'reports', 'reported', 'company', 'companys', 'said', 'says', 'year', 'years', 'same', 'figure',
  'figures', 'differ', 'differs', 'different', 'shows', 'show', 'states', 'state', 'stated', 'according',
]);

function isYearToken(token: string): boolean {
  return /^\d{4}$/.test(token) && Number(token) >= 1900 && Number(token) <= 2099;
}

function significantTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      // A bare year (every sentence in an annual report mentions "2025"
      // somewhere) is common ground, not evidence two sentences share a
      // subject — it would otherwise match an unrelated capacity claim to
      // the revenue contradiction just because both mention "2025".
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !isYearToken(w)),
  );
}

/** True when `claim` is actually *about* `sentence` (a contradiction side's
 * own evidence sentence) — they share at least one significant word or
 * number, not just the same oversized source chunk. */
function isAboutSameFact(claim: Claim, sentence: string): boolean {
  const claimTokens = significantTokens(`${claim.text} ${claim.evidence ?? ''}`);
  for (const token of significantTokens(sentence)) {
    if (claimTokens.has(token)) return true;
  }
  return false;
}

/** Every open contradiction with at least one side cited by a claim in this
 *  answer — the uncited side (if any) carries a -1 index and falls back to
 *  the radar's own sentence/doc data (BUG-5). */
export function pairClaimConflicts(claims: Claim[], contradictions: Contradiction[]): ConflictPair[] {
  const pairs: ConflictPair[] = [];
  for (const contradiction of contradictions) {
    const claimAIndex = claims.findIndex(
      (c) => c.chunk_id === contradiction.a.chunk_id && isAboutSameFact(c, contradiction.a.sentence),
    );
    const claimBIndex = claims.findIndex(
      (c) => c.chunk_id === contradiction.b.chunk_id && isAboutSameFact(c, contradiction.b.sentence),
    );
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
// `\d[\d,]*` (not `[\d,]+`) requires an actual digit — the old pattern let a
// lone "," in running prose match as a zero-value "figure" (R2-3/BUG-29).
const FIGURE_RE = /([€$£]?)\s?(\d[\d,]*(?:\.\d+)?)\s?(million|billion|thousand|%|bn|m|k)?/gi;

/** A bare 4-digit number with no currency/scale/decimal, in a plausible
 * calendar-year range, is a date — not a figure to diff (R2-3: "March 2021"
 * vs "January 2022" must never produce a fake numeric difference). */
function looksLikeYear(raw: string, value: number, unit: string): boolean {
  return unit === '' && !raw.includes(',') && !raw.includes('.') && Number.isInteger(value) && value >= 1900 && value <= 2099;
}

export function extractFigure(text: string): ExtractedFigure | null {
  FIGURE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FIGURE_RE.exec(text))) {
    if (!match[2]) continue;
    const value = Number(match[2].replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    const unit = `${match[1] ?? ''}${match[3] ? ` ${match[3].toLowerCase()}` : ''}`.trim();
    if (looksLikeYear(match[2], value, unit)) continue;
    return { raw: match[0].trim(), value, unit };
  }
  return null;
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
 * headcount) is labelled "pts" so it never looks unitless). A percentage
 * difference is also "pts" (percentage *points*), not "%": "41% vs 34%" is a
 * 7-point gap, and printing "7%" reads as a further relative change (R2-3). */
export function formatFigureDiff({ diff, a }: { diff: number; a: ExtractedFigure }): string {
  const n = diff.toLocaleString();
  const symbol = a.unit.match(/^[€$£]/)?.[0] ?? '';
  const rest = a.unit.replace(/^[€$£]\s*/, '');
  if (symbol && rest) return `${symbol}${n}${SCALE_SUFFIX[rest] ?? ` ${rest}`}`;
  if (symbol) return `${symbol}${n}`;
  if (rest && rest !== '%') return `${n} ${rest}`;
  return `${n} pts`;
}
