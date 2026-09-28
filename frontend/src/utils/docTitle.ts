// Claim Ledger redesign (Lane D1) — demo corpus doc names all share a prefix
// ("Northwind Renewables — …"), so every exhibit/source card used to truncate
// to the same "Northwind Renewab…" and become indistinguishable (problem #5
// in the design brief). Strip the extension and any prefix shared by every
// sibling name in the list; keep the full name available for a `title` tooltip.
const EXT_RE = /\.[a-z0-9]{1,5}$/i;
const PREFIX_SEPS = [' — ', ' – ', ': ', ' - '];

function stripExt(name: string): string {
  return name.replace(EXT_RE, '').trim();
}

/** Longest separator-terminated prefix shared by every name (2+ names only). */
function sharedPrefix(names: string[]): string {
  if (names.length < 2) return '';
  const [first, ...rest] = names;
  for (const sep of PREFIX_SEPS) {
    const idx = first.indexOf(sep);
    if (idx === -1) continue;
    const candidate = first.slice(0, idx + sep.length);
    if (candidate && rest.every((n) => n.startsWith(candidate))) return candidate;
  }
  return '';
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
    const rest = stripped.slice(prefix.length).trim();
    if (rest) return rest;
  }
  return stripped || name.trim();
}
