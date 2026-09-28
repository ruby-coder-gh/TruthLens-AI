// Claim Ledger (Lane D1) — verdict metadata shared by the stamp, the claim
// rows, the tally chips and the prose view's inline icons. One source of
// truth so every surface agrees on label/icon/colour for a given verdict.
//
// Colour tokens: reuse the app's existing green/orange/red inks (already
// text-safe AA on both themes — see index.css) instead of inventing new
// "--v-*" tokens. `unsupported` maps to the existing neutral `text-muted`
// ink, matching the prototype's own grey (not a fourth hue). `conflict`
// reuses red, exactly as the prototype's own tokens do (`--conflict` ===
// `--v-contradicted` in both its light and dark palettes).
import { Check, CircleDashed, X, Ban, Scale } from 'lucide-react';
import type { ClaimVerdict } from '../../api/types';

export type LedgerVerdict = ClaimVerdict | 'conflict';

export interface VerdictMeta {
  label: string;
  icon: typeof Check;
  /** Tailwind text-color utility — also the `currentColor` source for `.wax-seal`. */
  textClass: string;
}

export const VERDICT_META: Record<LedgerVerdict, VerdictMeta> = {
  supported: { label: 'Verified', icon: Check, textClass: 'text-green' },
  partial: { label: 'Partial', icon: CircleDashed, textClass: 'text-orange' },
  unsupported: { label: 'Unsupported', icon: X, textClass: 'text-text-muted' },
  contradicted: { label: 'Contradicted', icon: Ban, textClass: 'text-red' },
  conflict: { label: 'Conflict', icon: Scale, textClass: 'text-red' },
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
