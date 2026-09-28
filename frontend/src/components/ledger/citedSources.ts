// Claim Ledger (Lane D1) — which 1-based source numbers the answer actually
// relies on, for the Exhibits list's "cited in the answer" vs "Not cited"
// flag. Unions claim.source_index (Truth Lens) with any bare [source:N]
// marker still in the text (claims with no locatable offset, or an answer
// with citations but no claims at all).
import type { Claim } from '../../api/types';

export function citedSourceIndices(content: string, claims: Claim[] | null | undefined): Set<number> {
  const indices = new Set<number>();
  for (const claim of claims ?? []) {
    if (claim.source_index != null) indices.add(claim.source_index);
  }
  for (const m of content.matchAll(/\[source:(\d+)\]/gi)) {
    indices.add(parseInt(m[1], 10));
  }
  return indices;
}
