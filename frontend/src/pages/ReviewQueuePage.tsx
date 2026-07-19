import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, ClipboardCheck, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';
import { Button, Card, EmptyState, ProgressBar, Skeleton, TextArea } from '../components/ui';
import { PageHeader, PageShell } from '../components/PageWrappers';
import { reviewQueueApi, workspaceApi } from '../api/client';
import type { ReviewQueueItem } from '../api/types';
import { useAuth } from '../context/auth-context';
import { getTrustBadgeColor } from '../utils/relevance';

function TrustBreakdown({ item }: { item: ReviewQueueItem }) {
  const entries = Object.entries(item.trust_components || {});
  return <div className="mt-3 space-y-2">{entries.length === 0 ? <p className="text-xs text-text-dim">No persisted signal breakdown is available for this historical answer.</p> : entries.map(([name, value]) => <ProgressBar key={name} value={value * 100} size="sm" label={`${name.replace(/_/g, ' ')} ${(value * 100).toFixed(0)}%`} />)}</div>;
}

export default function ReviewQueuePage() {
  const { id: workspaceId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [workspaceOwner, setWorkspaceOwner] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [acting, setActing] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return undefined;
    const timer = window.setTimeout(() => {
      setLoading(true);
      Promise.all([reviewQueueApi.list(workspaceId), workspaceApi.get(workspaceId)]).then(([queue, workspace]) => {
        setItems(queue.data);
        setEnabled(Boolean(queue.meta.enabled));
        setWorkspaceOwner(workspace.owner_id);
      }).finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [workspaceId]);

  const review = async (item: ReviewQueueItem, status: 'reviewed' | 'dismissed') => {
    if (!workspaceId) return;
    setActing(item.id);
    try {
      await reviewQueueApi.review(workspaceId, item.id, { review_status: status, review_note: notes[item.id]?.trim() || undefined });
      setItems((current) => current.filter((entry) => entry.id !== item.id));
    } finally { setActing(null); }
  };

  const toggleEnabled = async () => {
    if (!workspaceId) return;
    const next = !enabled;
    setEnabled(next);
    try { await reviewQueueApi.settings(workspaceId, next); if (!next) setItems([]); } catch { setEnabled(!next); }
  };

  return <div className="mx-auto max-w-5xl py-6"><PageShell><PageHeader title="Review Queue" description="Low-trust answers needing a human decision, sorted from lowest confidence first." actions={workspaceOwner === user?.id ? <Button size="sm" variant="secondary" onClick={() => void toggleEnabled()}>{enabled ? 'Pause queue' : 'Enable queue'}</Button> : undefined} />{loading ? <div className="space-y-3"><Skeleton height={150} /><Skeleton height={150} /></div> : !enabled ? <EmptyState icon={<ShieldAlert size={24} />} title="Review queue is paused for this workspace" description="The workspace owner opted out of automatic low-confidence review." /> : items.length === 0 ? <EmptyState icon={<CheckCircle2 size={24} />} title="Nothing needs review right now" description="No pending answers are below the configured trust threshold." /> : <div className="space-y-4">{items.map((item) => <Card key={item.id} className="p-4"><div className="flex flex-col gap-4 sm:flex-row sm:justify-between"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><ClipboardCheck size={16} className="text-orange" /><p className="font-medium text-text">{item.query_text}</p><span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${getTrustBadgeColor(item.trust_score ?? 0) === 'red' ? 'bg-red/15 text-red' : 'bg-orange/15 text-orange'}`}>{item.trust_score == null ? 'Unscored' : `${(item.trust_score * 100).toFixed(0)}% trust`}</span></div><p className="mt-2 line-clamp-3 text-sm leading-relaxed text-text-muted">{item.response_text || 'No answer text was persisted.'}</p><TrustBreakdown item={item} /></div><div className="w-full space-y-2 sm:max-w-xs"><TextArea rows={2} value={notes[item.id] || ''} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Review note (optional)…" /><div className="flex flex-wrap gap-2"><Button size="sm" loading={acting === item.id} onClick={() => void review(item, 'reviewed')}><CheckCircle2 size={13} /> Mark reviewed</Button><Button size="sm" variant="secondary" disabled={acting === item.id} onClick={() => void review(item, 'dismissed')}><XCircle size={13} /> Dismiss</Button><Link to={`/workspaces/${workspaceId}/queries/${item.id}?compare=true`}><Button size="sm" variant="ghost"><RefreshCw size={13} /> Re-run query</Button></Link></div></div></div></Card>)}</div>}</PageShell></div>;
}
