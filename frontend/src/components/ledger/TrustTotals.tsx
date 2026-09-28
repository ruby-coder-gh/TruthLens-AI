// Claim Ledger (Lane D1) — trust score + its four components, styled like a
// document's totals line (single rule above, double rule below). Design
// brief item 6.
const COMPONENT_LABEL: Record<string, string> = {
  retrieval_quality: 'Retrieval',
  faithfulness: 'Faithfulness',
  relevance: 'Relevance',
  source_authority: 'Authority',
};
const COMPONENT_ORDER = ['retrieval_quality', 'faithfulness', 'relevance', 'source_authority'];

export function TrustTotals({ score, components }: { score: number; components: Record<string, number> }) {
  const scorePct = Math.round(score * 100);
  const entries = COMPONENT_ORDER.filter((k) => components[k] !== undefined);

  return (
    <div className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-t border-text-dim/60 border-b-[3px] border-double border-b-text-dim/60 py-3.5">
      <div>
        <p className="text-sm font-semibold text-text">Trust score</p>
        <p className="max-w-[34ch] text-xs text-text-dim">How strongly the retrieved evidence supports this answer.</p>
      </div>
      <dl className="flex flex-wrap items-end gap-x-6 gap-y-3">
        {entries.map((key) => {
          const v = Math.round((components[key] ?? 0) * 100);
          return (
            <div key={key} className="flex min-w-16 flex-col gap-0.5">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-text-dim">{COMPONENT_LABEL[key]}</dt>
              <dd className="text-base font-medium tabular-nums text-text">
                {v}
                <span className="mt-1 block h-[2px] w-full bg-border" aria-hidden="true">
                  <span className="block h-full bg-text-muted" style={{ width: `${v}%` }} />
                </span>
              </dd>
            </div>
          );
        })}
        <div className="flex flex-col items-end gap-0.5 pl-2">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-text-dim">Trust</dt>
          <dd className="font-mono text-3xl font-semibold leading-none tabular-nums text-text">
            {scorePct}
            <span className="ml-0.5 text-base font-medium text-text-dim">/100</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}
