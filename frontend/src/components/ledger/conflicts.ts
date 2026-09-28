// Claim Ledger (Lane D1) — pairs claims whose cited chunks are on opposite
// sides of an open Contradiction Radar (L5/L6) pair, so the ledger can draw
// the "Differs from Cn" cross-reference and a discrepancy (D-) row between
// them (design brief item 5).
import type { Claim, Contradiction } from '../../api/types';

export interface ConflictPair {
  claimAIndex: number;
  claimBIndex: number;
  contradiction: Contradiction;
}

/** One open contradiction whose chunks are both cited by a claim in this answer. */
export function pairClaimConflicts(claims: Claim[], contradictions: Contradiction[]): ConflictPair[] {
  const pairs: ConflictPair[] = [];
  for (const contradiction of contradictions) {
    const claimAIndex = claims.findIndex((c) => c.chunk_id && c.chunk_id === contradiction.a.chunk_id);
    const claimBIndex = claims.findIndex((c) => c.chunk_id && c.chunk_id === contradiction.b.chunk_id);
    if (claimAIndex !== -1 && claimBIndex !== -1 && claimAIndex !== claimBIndex) {
      pairs.push({ claimAIndex, claimBIndex, contradiction });
    }
  }
  return pairs;
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

/** Numeric difference between two claims' figures, only when their units match. */
export function figureDiff(a: Claim, b: Claim): { a: ExtractedFigure; b: ExtractedFigure; diff: number } | null {
  const figA = extractFigure(a.text);
  const figB = extractFigure(b.text);
  if (!figA || !figB || figA.unit !== figB.unit) return null;
  return { a: figA, b: figB, diff: Math.abs(figA.value - figB.value) };
}
