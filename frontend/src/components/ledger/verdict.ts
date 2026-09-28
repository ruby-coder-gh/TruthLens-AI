// Claim Ledger (Lane D1) — verdict metadata shared by the stamp, the claim
// rows, the tally chips and the prose view's inline icons. One source of
// truth so every surface agrees on label/icon/colour for a given verdict.
//
// Colour tokens: index.css's Claim Ledger port defines --color-v-supported /
// -v-partial / -v-unsupported / -v-contradicted / -conflict for exactly this
// purpose (Tailwind auto-generates text-v-supported etc. from them).
import { Check, CircleDashed, X, Ban, Scale } from 'lucide-react';
import type { ClaimVerdict } from '../../api/types';

export type LedgerVerdict = ClaimVerdict | 'conflict';

export interface VerdictMeta {
  label: string;
  icon: typeof Check;
  /** Tailwind text-color utility — also the `currentColor` source for `.stamp`. */
  textClass: string;
}

export const VERDICT_META: Record<LedgerVerdict, VerdictMeta> = {
  supported: { label: 'Verified', icon: Check, textClass: 'text-v-supported' },
  partial: { label: 'Partial', icon: CircleDashed, textClass: 'text-v-partial' },
  unsupported: { label: 'Unsupported', icon: X, textClass: 'text-v-unsupported' },
  contradicted: { label: 'Contradicted', icon: Ban, textClass: 'text-v-contradicted' },
  conflict: { label: 'Conflict', icon: Scale, textClass: 'text-conflict' },
};

export interface ClaimTally {
  total: number;
  supported: number;
  partial: number;
  unsupported: number;
  contradicted: number;
}

export function tallyClaims(claims: { verdict: ClaimVerdict }[]): ClaimTally {
  const tally: ClaimTally = { total: claims.length, supported: 0, partial: 0, unsupported: 0, contradicted: 0 };
  for (const c of claims) tally[c.verdict] += 1;
  return tally;
}
