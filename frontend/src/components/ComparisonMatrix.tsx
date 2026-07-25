import { useId, useMemo, useState } from 'react';
import { Check, FileText, Filter, Minus, Quote, X } from 'lucide-react';
import type {
  ComparisonDetail,
  ComparisonResult,
  ComparisonSource,
  ComparisonSummary,
} from '../api/types';
import { Modal, Skeleton } from './ui';

export interface ComparisonMatrixProps {
  /** Completed comparison details. Each detail becomes one question/claim row. */
  comparisons: readonly ComparisonDetail[];
  /** Optional history metadata, used to preserve the question wording from list views. */
  summaries?: readonly ComparisonSummary[];
  /** Renders a structured skeleton while comparison details are being loaded. */
  isLoading?: boolean;
  className?: string;
}

type Stance = ComparisonResult['stance'];

interface MatrixDocument {
  id: string;
  name: string;
}

interface MatrixRow {
  detail: ComparisonDetail;
  question: string;
  resultsByDocumentId: Map<string, ComparisonResult>;
}

interface SelectedCell {
  document: MatrixDocument;
  row: MatrixRow;
  result?: ComparisonResult;
}

const STANCE_META = {
  supports: {
    label: 'Supports',
    cellClassName: 'border-green/30 bg-green/10 text-green hover:bg-green/15 focus-visible:ring-green/50',
    badgeClassName: 'border-green/25 bg-green/15 text-green',
    icon: Check,
  },
  contradicts: {
    label: 'Contradicts',
    cellClassName: 'border-red/30 bg-red/10 text-red hover:bg-red/15 focus-visible:ring-red/50',
    badgeClassName: 'border-red/25 bg-red/15 text-red',
    icon: X,
  },
  silent: {
    label: 'Silent',
    cellClassName: 'border-border bg-card-2 text-text-dim hover:border-text-dim/50 hover:bg-bg-soft focus-visible:ring-primary/50',
    badgeClassName: 'border-border bg-card-2 text-text-dim',
    icon: Minus,
  },
} as const;

function classes(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(' ');
}

function formatScore(score: number | undefined): string | null {
  if (score == null || !Number.isFinite(score)) return null;
  return score >= 0 && score <= 1 ? `${(score * 100).toFixed(0)}%` : score.toFixed(2);
}

function StanceBadge({ stance, className }: { stance: Stance; className?: string }) {
  const meta = STANCE_META[stance];
  const Icon = meta.icon;

  return (
    <span className={classes('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold', meta.badgeClassName, className)}>
      <Icon size={13} strokeWidth={2.5} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function MatrixSkeleton({ className }: { className?: string }) {
  return (
    <section className={classes('overflow-hidden rounded-xl border border-border bg-card', className)} aria-busy="true" aria-label="Loading stance matrix">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div className="space-y-2">
          <Skeleton width={142} height={14} />
          <Skeleton width={260} height={12} />
        </div>
        <Skeleton width={172} height={30} className="rounded-lg" />
      </div>
      <div className="overflow-hidden">
        <div className="min-w-[680px]">
          <div className="grid grid-cols-4 border-b border-border bg-bg-soft/60 p-3">
            {[0, 1, 2, 3].map((column) => <Skeleton key={column} height={14} className="mx-2" />)}
          </div>
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="grid grid-cols-4 border-b border-border/70 p-3 last:border-b-0">
              <Skeleton height={16} className="mx-2" />
              {[0, 1, 2].map((cell) => <Skeleton key={cell} width={32} height={32} className="mx-auto rounded-lg" />)}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function EmptyMatrix({ filtered, onClearFilter, className }: { filtered: boolean; onClearFilter: () => void; className?: string }) {
  return (
    <section className={classes('rounded-xl border border-border bg-card p-4 lg:p-6', className)}>
      <div className="flex min-h-44 flex-col items-center justify-center text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-bg-soft text-text-dim">
          <FileText size={19} aria-hidden="true" />
        </div>
        <h2 className="mt-3 text-sm font-semibold text-text">{filtered ? 'No conflicts in these rows' : 'No comparison rows yet'}</h2>
        <p className="mt-1 max-w-md text-sm text-text-muted">
          {filtered
            ? 'None of the loaded questions contains a contradiction. Show all rows to review the full comparison.'
            : 'Run at least one completed multi-document comparison to populate the stance matrix.'}
        </p>
        {filtered && (
          <button
            type="button"
            onClick={onClearFilter}
            className="mt-4 rounded-lg border border-border bg-bg-soft px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:border-primary/30 hover:text-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            Show all rows
          </button>
        )}
      </div>
    </section>
  );
}

function CitationList({ sources }: { sources: readonly ComparisonSource[] }) {
  if (sources.length === 0) {
    return <div className="rounded-xl border border-border bg-bg-soft p-4 text-sm text-text-muted">No cited passages were returned for this stance.</div>;
  }

  return (
    <div className="space-y-3">
      {sources.map((source, index) => {
        const relevance = formatScore(source.relevance_score);
        const rerank = formatScore(source.rerank_score);
        const confidence = formatScore(source.confidence);

        return (
          <article key={`${source.chunk_id}-${index}`} className="rounded-xl border border-border bg-bg-soft p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-dim">
              <span className="max-w-full truncate font-medium text-text-muted" title={source.document_name}>{source.document_name || 'Source document'}</span>
              <span className="font-mono">Chunk {source.chunk_id}</span>
              {relevance && <span>Relevance {relevance}</span>}
              {rerank && <span>Rerank {rerank}</span>}
              {confidence && <span>Confidence {confidence}</span>}
              {source.matched_chunks != null && <span>{source.matched_chunks} matched chunks</span>}
            </div>
            <blockquote className="mt-2 border-l-2 border-primary/40 pl-3 text-sm leading-relaxed text-text-muted">
              {source.excerpt || 'No excerpt was returned for this source.'}
            </blockquote>
          </article>
        );
      })}
    </div>
  );
}

function CellEvidenceModal({ cell, onClose }: { cell: SelectedCell | null; onClose: () => void }) {
  const stance: Stance = cell?.result?.stance ?? 'silent';

  return (
    <Modal
      open={cell !== null}
      onClose={onClose}
      title={cell ? `Evidence: ${cell.document.name}` : 'Cell evidence'}
      className="max-w-3xl"
    >
      {cell && (
        <div className="max-h-[calc(100vh-11rem)] space-y-4 overflow-y-auto pr-1">
          <div className="rounded-xl border border-border bg-bg-soft p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-dim">Question / claim</p>
            <p className="mt-1 text-sm leading-relaxed text-text">{cell.row.question}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StanceBadge stance={stance} />
              {cell.result?.trust_score != null && <span className="text-xs text-text-dim">Document trust {formatScore(cell.result.trust_score) ?? 'Unavailable'}</span>}
            </div>
          </div>

          {cell.result?.answer_text && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-dim">Document finding</p>
              <p className="rounded-xl border border-border bg-bg-soft p-3 text-sm leading-relaxed text-text-muted">{cell.result.answer_text}</p>
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center gap-2">
              <Quote size={15} className="text-primary-soft" aria-hidden="true" />
              <p className="text-xs font-semibold uppercase tracking-wider text-text-dim">Cited passages</p>
            </div>
            <CitationList sources={cell.result?.sources ?? []} />
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * Renders completed comparisons as a question-by-document stance grid.
 * Pass every `ComparisonDetail` that should be reviewed together; each detail
 * supplies one row and its per-document results supply the cells.
 */
export function ComparisonMatrix({ comparisons, summaries = [], isLoading = false, className }: ComparisonMatrixProps) {
  const matrixId = useId();
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);

  const summaryQuestions = useMemo(
    () => new Map(summaries.map((summary) => [summary.id, summary.question])),
    [summaries],
  );

  const rows = useMemo<MatrixRow[]>(
    () => comparisons.map((detail) => ({
      detail,
      question: summaryQuestions.get(detail.id) ?? detail.question,
      resultsByDocumentId: new Map(detail.results.map((result) => [result.document_id, result])),
    })),
    [comparisons, summaryQuestions],
  );

  const documents = useMemo<MatrixDocument[]>(() => {
    const documentsById = new Map<string, MatrixDocument>();

    for (const comparison of comparisons) {
      for (const result of comparison.results) {
        documentsById.set(result.document_id, { id: result.document_id, name: result.document_name || `Document ${result.document_id.slice(0, 8)}` });
      }
      for (const documentId of comparison.document_ids) {
        if (!documentsById.has(documentId)) {
          documentsById.set(documentId, { id: documentId, name: `Document ${documentId.slice(0, 8)}` });
        }
      }
    }

    return Array.from(documentsById.values());
  }, [comparisons]);

  const visibleRows = useMemo(
    () => conflictsOnly
      ? rows.filter((row) => Array.from(row.resultsByDocumentId.values()).some((result) => result.stance === 'contradicts'))
      : rows,
    [conflictsOnly, rows],
  );

  if (isLoading) return <MatrixSkeleton className={className} />;

  if (rows.length === 0 || documents.length === 0) {
    return <EmptyMatrix filtered={false} onClearFilter={() => setConflictsOnly(false)} className={className} />;
  }

  return (
    <section className={classes('overflow-hidden rounded-xl border border-border bg-card', className)} aria-label="Document stance matrix">
      <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2" aria-label="Stance legend">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-dim">Stance</span>
            <StanceBadge stance="supports" />
            <StanceBadge stance="contradicts" />
            <StanceBadge stance="silent" />
          </div>
          <p className="mt-2 text-xs text-text-dim">Select any cell to inspect the document finding and cited passages.</p>
        </div>
        <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-border bg-bg-soft px-3 py-2 text-xs font-medium text-text-muted transition-colors hover:border-primary/30 hover:text-text focus-within:ring-2 focus-within:ring-primary/50">
          <Filter size={14} aria-hidden="true" />
          <input
            type="checkbox"
            checked={conflictsOnly}
            onChange={(event) => setConflictsOnly(event.target.checked)}
            aria-controls={matrixId}
            className="h-3.5 w-3.5 accent-primary"
          />
          Contradictions only
        </label>
      </div>

      {visibleRows.length === 0 ? (
        <EmptyMatrix filtered onClearFilter={() => setConflictsOnly(false)} className="m-4" />
      ) : (
        <div id={matrixId} className="max-h-[34rem] overflow-auto" tabIndex={0} aria-label="Scrollable stance matrix">
          <table className="w-full min-w-max border-separate border-spacing-0 text-left text-sm">
            <caption className="sr-only">Stances for each question or claim across the selected documents.</caption>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 top-0 z-30 min-w-64 border-b border-r border-border bg-card px-4 py-3 text-xs font-semibold uppercase tracking-wider text-text-dim">
                  Question / claim
                </th>
                {documents.map((document) => (
                  <th key={document.id} scope="col" className="sticky top-0 z-20 w-36 min-w-36 border-b border-r border-border bg-card px-3 py-3 text-center text-xs font-semibold text-text-muted last:border-r-0">
                    <span className="block truncate" title={document.name}>{document.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.detail.id} className="group">
                  <th scope="row" className="sticky left-0 z-10 max-w-80 border-b border-r border-border bg-card px-4 py-3 text-left align-middle group-hover:bg-bg-soft">
                    <span className="line-clamp-2 text-sm font-medium leading-snug text-text" title={row.question}>{row.question}</span>
                  </th>
                  {documents.map((document) => {
                    const result = row.resultsByDocumentId.get(document.id);
                    const stance: Stance = result?.stance ?? 'silent';
                    const meta = STANCE_META[stance];
                    const Icon = meta.icon;
                    const citationCount = result?.sources.length ?? 0;

                    return (
                      <td key={document.id} className="border-b border-r border-border p-2 text-center last:border-r-0 group-hover:bg-bg-soft/30">
                        <button
                          type="button"
                          onClick={() => setSelectedCell({ document, row, result })}
                          aria-haspopup="dialog"
                          aria-label={`${meta.label}: ${document.name} on ${row.question}. View ${citationCount} cited ${citationCount === 1 ? 'passage' : 'passages'}.`}
                          title={`${meta.label} — ${citationCount} cited ${citationCount === 1 ? 'passage' : 'passages'}. View evidence.`}
                          className={classes('inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-card', meta.cellClassName)}
                        >
                          <Icon size={17} strokeWidth={2.75} aria-hidden="true" />
                          <span className="sr-only">{meta.label}</span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CellEvidenceModal cell={selectedCell} onClose={() => setSelectedCell(null)} />
    </section>
  );
}

export default ComparisonMatrix;
