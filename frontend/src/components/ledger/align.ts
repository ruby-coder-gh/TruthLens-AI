// Claim Ledger (Lane D1) — word-level match between a claim and its cited
// evidence sentence, for the row detail's "why partial/unsupported"
// explanation: words the claim shares with the source are underlined; words
// the claim adds that the source never said are flagged "(not in source)".
// ponytail: a case-insensitive token-membership diff, not a real sequence
// alignment (LCS) — it can't tell "reordered" from "matched", but for a
// single sentence claim vs. a single sentence of evidence (the guardrail's
// unit of comparison) that distinction rarely matters. Upgrade to an LCS-based
// diff if longer claims start producing misleading flags.
export interface AlignToken {
  text: string;
  isWord: boolean;
  matched: boolean;
}

const WORD_RE = /[\p{L}\p{N}']+/gu;

function wordSet(text: string): Set<string> {
  const set = new Set<string>();
  for (const m of text.toLowerCase().matchAll(WORD_RE)) set.add(m[0]);
  return set;
}

export function alignTokens(claimText: string, evidenceText: string): AlignToken[] {
  const evidenceWords = wordSet(evidenceText);
  const tokens: AlignToken[] = [];
  let lastIndex = 0;
  for (const m of claimText.matchAll(WORD_RE)) {
    const index = m.index ?? 0;
    if (index > lastIndex) tokens.push({ text: claimText.slice(lastIndex, index), isWord: false, matched: false });
    const word = m[0];
    tokens.push({ text: word, isWord: true, matched: evidenceWords.has(word.toLowerCase()) });
    lastIndex = index + word.length;
  }
  if (lastIndex < claimText.length) tokens.push({ text: claimText.slice(lastIndex), isWord: false, matched: false });
  return tokens;
}
