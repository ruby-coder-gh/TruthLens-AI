// Claim Ledger (Lane D1) — the hero surface of the redesigned chat: each
// claim in the answer gets its own row, stamped with a verdict, beside the
// exact evidence sentence it cites. Design brief item 4 (+5 for conflicts).
//
// Exports two DOM-lookup helpers (flashRowById/flashRows) alongside the
// component, for the answer-head tally chips.
/* eslint-disable react-refresh/only-export-components */
import { useCallback, useState } from 'react';
import { clsx } from 'clsx';
import { ChevronDown, ExternalLink, Scale } from 'lucide-react';
import { useSourceViewer } from '../../context/SourceViewerContext';
import { shortDocTitle } from '../../utils/docTitle';
import type { Claim, Source, Contradiction } from '../../api/types';
import { Stamp } from './Stamp';
import { VERDICT_META } from './verdict';
import { alignTokens } from './align';
import { pairClaimConflicts, figureDiff, type ConflictPair } from './conflicts';

// Bold out currency/number figures in the claim cell — the thing a reader's
// eye needs to catch fastest when two rows disagree.
const FIGURE_RE = /([€$£]?\s?[\d][\d,]*(?:\.\d+)?\s?(?:million|billion|thousand|%|bn)?)/gi;

function EmphasizedFigures({ text }: { text: string }) {
  const parts = text.split(FIGURE_RE);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-semibold text-text">{part}</strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function AlignedClaim({ claim }: { claim: Claim }) {
  if (!claim.evidence) return <p className="text-sm text-text">{claim.text}</p>;
  const tokens = alignTokens(claim.text, claim.evidence);
  return (
    <p className="text-sm leading-6 text-text">
      {tokens.map((t, i) =>
        !t.isWord ? (
          <span key={i}>{t.text}</span>
        ) : t.matched ? (
          <span key={i} className="underline decoration-green decoration-2 underline-offset-2">{t.text}</span>
        ) : (
          <span key={i}>
            <mark className="rounded-sm bg-orange/15 px-0.5 text-text no-underline decoration-orange decoration-2 decoration-wavy">
              {t.text}
            </mark>
            <span className="sr-only"> (not in source)</span>
          </span>
        ),
      )}
    </p>
  );
}

function whyText(claim: Claim): string {
  const pct = Math.round(claim.entailment * 100);
  switch (claim.verdict) {
    case 'supported':
      return `The cited passage states the same thing (${pct}% entailment).`;
    case 'partial':
      return `The source backs part of this claim, but some wording goes further than the passage says (${pct}% entailment). Words in the source are underlined; words the claim adds are flagged.`;
    case 'unsupported':
      return 'No retrieved passage supports this claim.';
    case 'contradicted':
      return `The cited passage states the opposite (${Math.round(claim.contradiction * 100)}% contradiction).`;
  }
}

function ClaimRow({
  claim,
  index,
  sources,
  allDocNames,
  workspaceId,
  xrefTo,
  isOpen,
  onToggle,
  flashed,
}: {
  claim: Claim;
  index: number;
  sources: Source[];
  allDocNames: string[];
  workspaceId?: string;
  xrefTo: number[]; // other 1-based claim numbers this row conflicts with
  isOpen: boolean;
  onToggle: () => void;
  flashed: boolean;
}) {
  const { open: openViewer } = useSourceViewer();
  const rid = `C${index + 1}`;
  const source = claim.source_index != null ? sources[claim.source_index - 1] : undefined;
  const canView = Boolean(workspaceId && claim.document_id && claim.chunk_id);
  const shortTitle = claim.document_name ? shortDocTitle(claim.document_name, allDocNames) : null;

  const handleView = useCallback(() => {
    if (!canView || !workspaceId || !claim.document_id || !claim.chunk_id) return;
    openViewer({
      workspaceId,
      documentId: claim.document_id,
      chunkId: claim.chunk_id,
      documentName: claim.document_name ?? undefined,
      pageNumber: claim.page_number ?? undefined,
    });
  }, [canView, workspaceId, claim, openViewer]);

  return (
    <li
      id={`row-${rid}`}
      className={clsx(
        'border-b border-border last:border-b-0 transition-colors',
        flashed && 'bg-primary/10',
        xrefTo.length > 0 && 'bg-conflict-tint',
      )}
    >
      <div className="flex flex-col gap-2.5 px-2 py-4 sm:grid sm:grid-cols-[2.5rem_7.5rem_minmax(0,1fr)_minmax(0,1.1fr)_2.25rem] sm:items-start sm:gap-4">
        <span className="font-cond text-[13px] font-medium text-text-dim sm:pt-0.5">{rid}</span>

        <div className="flex flex-row items-center gap-3 sm:flex-col sm:items-start sm:gap-2">
          <Stamp verdict={claim.verdict} />
          <span className="flex items-center gap-1.5 text-xs text-text-muted">
            <span className="h-[3px] w-10 overflow-hidden rounded-full bg-border" aria-hidden="true">
              <span
                className={clsx('block h-full', VERDICT_META[claim.verdict].textClass.replace('text-', 'bg-'))}
                style={{ width: `${Math.round(claim.entailment * 100)}%` }}
              />
            </span>
            <span className="tabular-nums">
              <span className="sr-only">Entailment score </span>
              {claim.entailment.toFixed(2)}
            </span>
          </span>
        </div>

        <div className="min-w-0 text-sm leading-6 text-text">
          <span className="sr-only">Claim: </span>
          <EmphasizedFigures text={claim.text} />
          {xrefTo.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => flashRowById(`row-C${n}`)}
              className="ml-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 align-middle text-xs font-medium text-conflict hover:bg-conflict-tint"
            >
              <Scale size={12} aria-hidden="true" />
              Differs from C{n}
            </button>
          ))}
        </div>

        <div className="min-w-0">
          {claim.evidence && (
            <blockquote className="border-l-2 border-border-strong pl-2.5 text-[13px] italic leading-5 text-text-muted">
              “{claim.evidence}”
            </blockquote>
          )}
          {source && (
            <button
              type="button"
              onClick={handleView}
              disabled={!canView}
              title={claim.document_name ?? undefined}
              className="mt-1 inline-flex min-h-6 items-center gap-1 rounded px-1 text-xs font-medium text-primary-soft hover:bg-primary/10 disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent [@media(pointer:coarse)]:min-h-11"
            >
              [{claim.source_index}] {shortTitle}{claim.page_number ? `, page ${claim.page_number}` : ''}
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-controls={`detail-${rid}`}
          aria-label={`Why ${rid} is ${VERDICT_META[claim.verdict].label.toLowerCase()}`}
          className="flex h-7 w-7 shrink-0 items-center justify-center self-start rounded text-text-dim hover:bg-card-2 hover:text-text sm:justify-self-end [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
        >
          <ChevronDown size={16} className={clsx('transition-transform', isOpen && 'rotate-180')} aria-hidden="true" />
        </button>
      </div>

      {isOpen && (
        <div id={`detail-${rid}`} className="space-y-2.5 border-t border-border-light bg-card-2/40 px-2 py-3.5 sm:ml-[10rem] sm:pr-9">
          <p className="text-[13px] leading-5 text-text-muted"><strong className="font-semibold text-text">Why {VERDICT_META[claim.verdict].label.toLowerCase()}.</strong> {whyText(claim)}</p>
          {claim.evidence && <AlignedClaim claim={claim} />}
          <div className="flex flex-wrap items-center gap-3 pt-0.5">
            {canView && (
              <button
                type="button"
                onClick={handleView}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-control border border-border-strong px-2.5 text-xs font-medium text-text hover:bg-card-2 [@media(pointer:coarse)]:min-h-11"
              >
                <ExternalLink size={13} aria-hidden="true" />
                View in document{claim.page_number ? `, page ${claim.page_number}` : ''}
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function DiscrepancyRow({ pair, claims, allDocNames, workspaceId }: { pair: ConflictPair; claims: Claim[]; allDocNames: string[]; workspaceId?: string }) {
  const { open: openViewer } = useSourceViewer();
  const claimA = claims[pair.claimAIndex];
  const claimB = claims[pair.claimBIndex];
  const diff = figureDiff(claimA, claimB);
  const titleA = claimA.document_name ? shortDocTitle(claimA.document_name, allDocNames) : `C${pair.claimAIndex + 1}`;
  const titleB = claimB.document_name ? shortDocTitle(claimB.document_name, allDocNames) : `C${pair.claimBIndex + 1}`;

  const handleCompare = useCallback(() => {
    if (!workspaceId || !claimA.document_id || !claimA.chunk_id) return;
    openViewer({
      workspaceId,
      documentId: claimA.document_id,
      chunkId: claimA.chunk_id,
      documentName: claimA.document_name ?? undefined,
      pageNumber: claimA.page_number ?? undefined,
    });
  }, [workspaceId, claimA, openViewer]);

  return (
    <li id={`row-D${pair.claimAIndex}${pair.claimBIndex}`} className="border-b border-border bg-conflict-tint px-2 py-4 last:border-b-0">
      <div className="flex flex-col gap-2.5 sm:grid sm:grid-cols-[2.5rem_7.5rem_minmax(0,1fr)_minmax(0,1.1fr)] sm:gap-4">
        <span className="font-cond text-[13px] font-medium text-text-dim">D</span>
        <Stamp verdict="conflict" />
        <div className="min-w-0 text-sm text-text">
          <p className="font-medium">Sources disagree{diff ? '' : ` (C${pair.claimAIndex + 1} vs C${pair.claimBIndex + 1})`}</p>
          <p className="mt-0.5 text-[13px] leading-5 text-text-muted">
            {titleA} and {titleB} report different figures for the same thing. TruthLens shows both and doesn't pick one.
          </p>
          {workspaceId && claimA.document_id && claimA.chunk_id && (
            <button type="button" onClick={handleCompare} className="mt-2 inline-flex min-h-7 items-center gap-1.5 rounded-control border border-border-strong px-2 text-xs font-medium text-text hover:bg-card-2 [@media(pointer:coarse)]:min-h-11">
              <ExternalLink size={12} aria-hidden="true" />
              Compare the pages
            </button>
          )}
        </div>
        {diff && (
          <table className="w-full max-w-xs text-[13px]">
            <caption className="sr-only">Figures by source</caption>
            <tbody>
              <tr><th scope="row" className="pr-3 py-0.5 text-left font-normal text-text-muted">{titleA}</th><td className="py-0.5 text-right font-semibold tabular-nums text-text">{diff.a.raw}</td></tr>
              <tr><th scope="row" className="pr-3 py-0.5 text-left font-normal text-text-muted">{titleB}</th><td className="py-0.5 text-right font-semibold tabular-nums text-text">{diff.b.raw}</td></tr>
              <tr className="border-t border-border-strong"><th scope="row" className="pr-3 pt-1 text-left font-normal text-conflict">Difference</th><td className="pt-1 text-right font-semibold tabular-nums text-conflict">{diff.diff.toLocaleString()}</td></tr>
            </tbody>
          </table>
        )}
      </div>
    </li>
  );
}

// Delegated DOM lookup (rather than lifting every row's ref to the parent) so
// a claim's xref button and the answer-head tally chips can both jump to a
// row owned by a sibling <ClaimRow>. Exported for the tally chips in ChatPage.
export function flashRowById(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('bg-primary/10');
  // Force reflow so the re-added class re-triggers the transition.
  void el.offsetWidth;
  el.classList.add('bg-primary/10');
  window.setTimeout(() => el.classList.remove('bg-primary/10'), 1400);
}

/** Scrolls to the first id, flashes all of them (tally chip click). */
export function flashRows(ids: string[]): void {
  ids.forEach(flashRowById);
}

export interface ClaimLedgerProps {
  claims: Claim[];
  sources: Source[];
  allDocNames: string[];
  contradictions?: Contradiction[];
  workspaceId?: string;
  /** Row `Cn` to open expanded and scroll to on mount (e.g. from a tally chip click). */
  initialOpenIndex?: number | null;
}

export function ClaimLedger({ claims, sources, allDocNames, contradictions = [], workspaceId, initialOpenIndex = null }: ClaimLedgerProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(initialOpenIndex);
  const pairs = pairClaimConflicts(claims, contradictions);

  const xrefFor = (index: number): number[] =>
    pairs
      .filter((p) => p.claimAIndex === index || p.claimBIndex === index)
      .map((p) => (p.claimAIndex === index ? p.claimBIndex : p.claimAIndex) + 1);

  return (
    <div className="overflow-hidden rounded-panel border border-border bg-solid">
      <ol aria-label="Claims in this answer, each with its evidence">
        {claims.map((claim, i) => (
          <ClaimRow
            key={i}
            claim={claim}
            index={i}
            sources={sources}
            allDocNames={allDocNames}
            workspaceId={workspaceId}
            xrefTo={xrefFor(i)}
            isOpen={openIndex === i}
            onToggle={() => setOpenIndex((v) => (v === i ? null : i))}
            flashed={false}
          />
        ))}
        {pairs.map((pair) => (
          <DiscrepancyRow key={`${pair.claimAIndex}-${pair.claimBIndex}`} pair={pair} claims={claims} allDocNames={allDocNames} workspaceId={workspaceId} />
        ))}
      </ol>
    </div>
  );
}
