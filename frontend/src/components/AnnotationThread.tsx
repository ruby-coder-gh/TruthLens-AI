import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, MessageCircle, Pencil, Send, Trash2 } from 'lucide-react';
import { annotationApi } from '../api/client';
import type { Annotation } from '../api/types';
import { Button, Card, TextArea } from './ui';

function relativeTime(iso: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function AnnotationThread({ workspaceId, queryId, sourceId, label = 'Comments', compact = false }: {
  workspaceId: string;
  queryId: string;
  sourceId?: string;
  label?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');

  const params = useMemo(() => sourceId ? { source_id: sourceId } : { answer_only: true }, [sourceId]);
  const refresh = useCallback(() => annotationApi.list(workspaceId, queryId, params).then((response) => setAnnotations(response.data)), [workspaceId, queryId, params]);

  useEffect(() => {
    annotationApi.count(workspaceId, queryId, params).then((response) => setCount(response.count)).catch(() => setCount(0));
  }, [workspaceId, queryId, params]);

  useEffect(() => { if (open) void refresh(); }, [open, refresh]);

  const post = async () => {
    const trimmed = body.trim();
    if (!trimmed || posting) return;
    setError(null);
    const optimistic: Annotation = { id: `optimistic-${Date.now()}`, workspace_id: workspaceId, query_id: queryId, source_id: sourceId, body: trimmed, author_name: 'You', is_deleted: false, can_edit: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    setAnnotations((current) => [...current, optimistic]);
    setBody('');
    setPosting(true);
    try {
      const saved = await annotationApi.create(workspaceId, queryId, { body: trimmed, source_id: sourceId });
      setAnnotations((current) => current.map((item) => item.id === optimistic.id ? saved : item));
      setCount((current) => current + 1);
    } catch (err) {
      setAnnotations((current) => current.filter((item) => item.id !== optimistic.id));
      setBody(trimmed);
      setError(err instanceof Error ? err.message : 'Could not post this comment.');
    } finally { setPosting(false); }
  };

  const saveEdit = async (annotationId: string) => {
    const trimmed = editBody.trim();
    if (!trimmed) return;
    try {
      const updated = await annotationApi.update(workspaceId, queryId, annotationId, trimmed);
      setAnnotations((current) => current.map((item) => item.id === annotationId ? updated : item));
      setEditing(null);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update this comment.'); }
  };

  const remove = async (annotationId: string) => {
    const previous = annotations;
    setAnnotations((current) => current.map((item) => item.id === annotationId ? { ...item, body: undefined, is_deleted: true, can_edit: false } : item));
    try {
      await annotationApi.delete(workspaceId, queryId, annotationId);
      setCount((current) => Math.max(0, current - 1));
    } catch (err) {
      setAnnotations(previous);
      setError(err instanceof Error ? err.message : 'Could not delete this comment.');
    }
  };

  return <div className={compact ? 'inline-flex' : 'mt-3'}>
    <button type="button" onClick={() => setOpen((value) => !value)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-text-dim transition-colors hover:bg-primary/10 hover:text-primary-soft" aria-expanded={open}>
      <MessageCircle size={compact ? 13 : 15} /> {compact ? null : label}{count > 0 && <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary-soft">{count}</span>}
    </button>
    {open && <Card className="mt-2 w-full min-w-[260px] space-y-3 p-3"><div className="flex items-center justify-between"><p className="text-sm font-medium text-text">{label}</p><span className="text-xs text-text-dim">{count} active</span></div><div className="max-h-52 space-y-2 overflow-y-auto">{annotations.length === 0 && <p className="py-2 text-xs text-text-dim">No comments yet. Start a focused review thread.</p>}{annotations.map((annotation) => <div key={annotation.id} className="rounded-lg bg-bg-soft p-2.5"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-primary-soft">{annotation.author_name || 'Workspace member'}</span><span className="text-[10px] text-text-dim">{relativeTime(annotation.updated_at)}</span></div>{annotation.is_deleted ? <p className="mt-1 text-xs italic text-text-dim">Comment deleted</p> : editing === annotation.id ? <div className="mt-2 space-y-2"><TextArea value={editBody} onChange={(event) => setEditBody(event.target.value)} rows={2} /><div className="flex gap-2"><Button size="sm" onClick={() => void saveEdit(annotation.id)}><Check size={12} /> Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div></div> : <><p className="mt-1 text-xs leading-relaxed text-text-muted">{annotation.body}</p>{annotation.can_edit && <div className="mt-2 flex gap-1"><button type="button" onClick={() => { setEditing(annotation.id); setEditBody(annotation.body || ''); }} aria-label="Edit comment" className="rounded p-1 text-text-dim hover:text-text"><Pencil size={12} /></button><button type="button" onClick={() => void remove(annotation.id)} aria-label="Delete comment" className="rounded p-1 text-text-dim hover:text-red"><Trash2 size={12} /></button></div>}</>}</div>)}</div><TextArea value={body} onChange={(event) => setBody(event.target.value)} rows={2} placeholder="Add a plain-text review note…" error={error || undefined} /><div className="flex justify-end"><Button size="sm" loading={posting} disabled={!body.trim()} onClick={() => void post()}><Send size={13} /> Comment</Button></div></Card>}
  </div>;
}
