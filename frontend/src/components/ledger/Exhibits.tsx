// Claim Ledger (Lane D1) — the exhibits list: every retrieved passage, one
// relevance number each (not four redundant ones — design brief problem #5),
// short distinct titles, and a conflict flag or "Not cited". Design brief item 6.
import { Scale } from 'lucide-react';
import { clsx } from 'clsx';
import { useSourceViewer } from '../../context/SourceViewerContext';
import { shortDocTitle } from '../../utils/docTitle';
import { relevancePercent } from '../../utils/relevance';
import type { Source } from '../../api/types';

export interface ExhibitsProps {
  sources: Source[];
  /** 1-based source_index values a claim actually cites. */
  citedIndices: Set<number>;
  allDocNames: string[];
  workspaceId?: string;
  loading?: boolean;
}

export function Exhibits({ sources, citedIndices, allDocNames, workspaceId, loading = false }: ExhibitsProps) {
  const { open: openViewer } = useSourceViewer();

  if (loading) {
    return (
      <section className="mt-8" aria-label="Exhibits">
        <div className="flex items-baseline gap-4 border-b border-border-strong pb-2">
          <h3 className="text-sm font-semibold text-text">Exhibits</h3>
          <p className="text-xs text-text-dim">Ranking passages…</p>
        </div>
        <div className="divide-y divide-border">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex h-12 items-center gap-3 px-2">
              <div className="h-3 w-6 animate-pulse rounded bg-card-2" />
              <div className="h-3 flex-1 animate-pulse rounded bg-card-2" />
              <div className="h-3 w-10 animate-pulse rounded bg-card-2" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (sources.length === 0) return null;

  const citedCount = sources.filter((_, i) => citedIndices.has(i + 1)).length;
  const docCount = new Set(sources.map((s) => s.document_id)).size;

  return (
    <section className="mt-8" aria-labelledby="exhibits-h">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border-strong pb-2">
        <h3 id="exhibits-h" className="text-sm font-semibold text-text">Exhibits</h3>
        <p className="text-xs text-text-dim" aria-live="polite">
          {sources.length} passage{sources.length === 1 ? '' : 's'} across {docCount} document{docCount === 1 ? '' : 's'}. {citedCount} cited in the answer.
        </p>
        <span className="ml-auto text-[11px] font-medium uppercase tracking-wide text-text-dim">Relevance</span>
      </div>
      <ol className="divide-y divide-border">
        {sources.map((source, i) => {
          const n = i + 1;
          const cited = citedIndices.has(n);
          const rel = relevancePercent(source.relevance_score);
          const title = shortDocTitle(source.document_name, allDocNames);
          return (
            <li key={source.chunk_id || i}>
              <button
                type="button"
                onClick={() =>
                  workspaceId &&
                  openViewer({
                    workspaceId,
                    documentId: source.document_id,
                    chunkId: source.chunk_id,
                    documentName: source.document_name,
                    pageNumber: source.page_number,
                  })
                }
                title={source.document_name}
                className="flex min-h-12 w-full items-center gap-3 px-2 text-left text-sm hover:bg-card-2"
              >
                <span className="w-7 shrink-0 font-mono text-xs text-text-dim">[{n}]</span>
                <span className="min-w-0 flex-1 truncate font-medium text-text">{title}</span>
                {source.page_number != null && <span className="hidden shrink-0 text-xs text-text-muted sm:inline">page {source.page_number}</span>}
                {(source.conflicts ?? 0) > 0 ? (
                  <span className="hidden shrink-0 items-center gap-1 text-xs font-medium text-conflict sm:flex">
                    <Scale size={13} aria-hidden="true" />
                    Conflict
                  </span>
                ) : (
                  <span className={clsx('hidden shrink-0 text-xs sm:inline', cited ? 'invisible' : 'text-text-dim')}>Not cited</span>
                )}
                <span className="flex w-16 shrink-0 items-center justify-end gap-2 tabular-nums text-text-muted">
                  <span className="h-[3px] w-8 overflow-hidden rounded-full bg-border" aria-hidden="true">
                    <span className="block h-full bg-text-muted" style={{ width: `${rel}%` }} />
                  </span>
                  <span className="text-xs"><span className="sr-only">Relevance </span>{rel}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
