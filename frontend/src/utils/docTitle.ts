// Claim Ledger redesign (Lane D1) — demo corpus doc names all share a prefix
// ("Northwind Renewables — …"), so every exhibit/source card used to truncate
// to the same "Northwind Renewab…" and become indistinguishable (problem #5
// in the design brief). Strip the extension and any prefix shared by every
// sibling name in the list; keep the full name available for a `title` tooltip.
const EXT_RE = /\.[a-z0-9]{1,5}$/i;
// Leading separator punctuation left dangling once a shared prefix is
// stripped off the front of a name (an em/en dash, colon or hyphen, plus
// whatever whitespace surrounds it).
const LEADING_SEP_RE = /^[\s:–—-]+/;

function stripExt(name: string): string {
  return name.replace(EXT_RE, '').trim();
}

/**
 * Longest word-prefix shared by the most names in the list (BUG-8: the old
 * version required *every* name to share one exact separator-terminated
 * prefix, so a single differently-worded title — "Northwind Renewables
 * Reports …" has no " — " — made the whole corpus fall back to unshortened
 * names, even though "Northwind Renewables" is still a real shared prefix
 * for the rest). Ties broken by the longer prefix.
 */
function sharedPrefix(names: string[]): string {
  if (names.length < 2) return '';
  let best = '';
  let bestCount = 0;
  for (const candidate of names) {
    const words = candidate.split(/\s+/);
    for (let len = 1; len <= words.length; len += 1) {
      const prefix = words.slice(0, len).join(' ');
      const count = names.filter((n) => n.startsWith(prefix)).length;
      if (count < 2) continue;
      if (count > bestCount || (count === bestCount && prefix.length > best.length)) {
        best = prefix;
        bestCount = count;
      }
    }
  }
  return best;
}

/**
 * Short, distinct display title for a document name.
 *
 * @param name - the document's stored name (with extension).
 * @param allNames - every document name in the same scope (workspace/answer);
 *   when 2+ are given, a prefix shared by all of them is dropped too, so
 *   "Northwind Renewables — Annual Report 2025" and "Northwind Renewables —
 *   Sustainability Report" become "Annual Report 2025" / "Sustainability
 *   Report" instead of both reading "Northwind Renewab…" when truncated.
 *   The full name still belongs in a `title` attribute for the tooltip.
 */
export function shortDocTitle(name: string | null | undefined, allNames?: string[]): string {
  if (!name || !name.trim()) return 'Untitled document';
  const stripped = stripExt(name);
  if (!allNames || allNames.length < 2) return stripped || name.trim();

  const prefix = sharedPrefix(allNames.map(stripExt));
  if (prefix && stripped.startsWith(prefix)) {
    const rest = stripped.slice(prefix.length).replace(LEADING_SEP_RE, '').trim();
    if (rest) return rest;
  }
  return stripped || name.trim();
}
