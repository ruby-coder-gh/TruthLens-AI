import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Equal, FilePlus2, FileX2, GitCompareArrows } from 'lucide-react';
import { diffWordsWithSpace } from 'diff';
import { Badge, Card } from './ui';
import type { QueryComparison, Source } from '../api/types';
import { getTrustBadgeColor } from '../utils/relevance';

function DiffText({ original, rerun, side }: { original: string; rerun: string; side: 'original' | 'rerun' }) {
  const changes = diffWordsWithSpace(original, rerun);
  return <>
    {changes.map((part, index) => {
      if (part.added && side === 'original') return null;
      if (part.removed && side === 'rerun') return null;
      const className = part.added ? 'rounded bg-green/20 text-green' : part.removed ? 'rounded bg-red/20 text-red line-through' : '';
      return <span key={index} className={className}>{part.value}</span>;
    })}
  </>;
}

function SourceList({ sources, empty, icon }: { sources: Source[]; empty: string; icon: ReactNode }) {
  if (!sources.length) return <p className="text-xs text-text-dim">{empty}</p>;
  return <div className="space-y-2">{sources.map((source, index) => <div key={`${source.chunk_id}-${index}`} className="rounded-lg border border-border bg-bg-soft p-2.5"><div className="flex items-center gap-2 text-xs font-medium text-text"><span className="text-primary-soft">{icon}</span><span className="truncate">{source.document_name || source.document_id || `Source ${index + 1}`}</span></div><p className="mt-1 line-clamp-2 text-xs text-text-muted">{source.excerpt}</p></div>)}</div>;
}

export default function AnswerComparison({ comparison }: { comparison: QueryComparison }) {
  const delta = comparison.trust_score_delta;
  const DeltaIcon = delta == null || delta === 0 ? Equal : delta > 0 ? ArrowUp : ArrowDown;
  const deltaColor = delta == null || delta === 0 ? 'gray' : delta > 0 ? 'green' : 'red';
  return <div className="space-y-5">
    <Card className="p-4"><div className="flex items-center gap-2"><GitCompareArrows size={17} className="text-primary-soft" /><div><h2 className="text-base font-semibold text-text">Answer comparison</h2><p className="text-xs text-text-dim">The rerun used the current document set and bypassed the answer cache.</p></div><Badge color={deltaColor} className="ml-auto"><DeltaIcon size={13} className="mr-1" />{delta == null ? 'Trust unavailable' : `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(0)} pts`}</Badge></div></Card>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4"><div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-medium text-text">Original answer</h3><div className="flex items-center gap-2">{comparison.original.prompt_version && <Badge color="purple" className="font-mono">prompt {comparison.original.prompt_version}</Badge>}<Badge color={getTrustBadgeColor(comparison.original.trust_score ?? 0)}>{comparison.original.trust_score == null ? 'Unscored' : `${(comparison.original.trust_score * 100).toFixed(0)}% trust`}</Badge></div></div><p className="whitespace-pre-wrap text-sm leading-relaxed text-text-muted"><DiffText original={comparison.original.response_text || ''} rerun={comparison.rerun.response_text || ''} side="original" /></p></Card>
      <Card className="border-primary/30 p-4"><div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-medium text-text">Current rerun</h3><div className="flex items-center gap-2">{comparison.rerun.prompt_version && <Badge color="purple" className="font-mono">prompt {comparison.rerun.prompt_version}</Badge>}<Badge color={getTrustBadgeColor(comparison.rerun.trust_score ?? 0)}>{comparison.rerun.trust_score == null ? 'Unscored' : `${(comparison.rerun.trust_score * 100).toFixed(0)}% trust`}</Badge></div></div><p className="whitespace-pre-wrap text-sm leading-relaxed text-text-muted"><DiffText original={comparison.original.response_text || ''} rerun={comparison.rerun.response_text || ''} side="rerun" /></p></Card>
    </div>
    <Card className="space-y-4 p-4"><div><h3 className="font-medium text-text">Why the answer changed</h3><p className="text-xs text-text-dim">New evidence is shown first, followed by shared and dropped citations.</p></div><div className="grid gap-4 lg:grid-cols-3"><section><h4 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-green"><FilePlus2 size={14} /> New sources</h4><SourceList sources={comparison.source_diff.new_sources} empty="No new sources contributed." icon={<FilePlus2 size={12} />} /></section><section><h4 className="mb-2 text-sm font-medium text-text-muted">Shared sources</h4><SourceList sources={comparison.source_diff.shared_sources} empty="No sources were shared." icon={<Equal size={12} />} /></section><section><h4 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-red"><FileX2 size={14} /> Dropped sources</h4><SourceList sources={comparison.source_diff.dropped_sources} empty="No sources dropped out." icon={<FileX2 size={12} />} /></section></div></Card>
  </div>;
}
