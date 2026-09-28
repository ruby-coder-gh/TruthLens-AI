import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, FileText } from 'lucide-react';
import { Badge, Button, Card, EmptyState, LoadingSpinner } from '../components/ui';
import { PageHeader, PageShell } from '../components/PageWrappers';
import { documentApi } from '../api/client';
import { useSourceViewer } from '../context/SourceViewerContext';
import type { DocumentDetail } from '../api/types';

/**
 * BUG-9. `status === 'ready'` only means processing finished without a crash
 * — a document whose every chunk was quarantined at ingest ends up "ready"
 * with `chunk_count === 0` and is invisible to search. `is_searchable` is
 * derived server-side from the live chunk counts, so it self-heals once a
 * chunk is released; absent on rows predating the fix, hence the `=== false`.
 */
function isUnsearchableReady(doc: DocumentDetail): boolean {
  return doc.is_searchable === false && doc.status === 'ready' && (doc.quarantined_chunk_count ?? 0) > 0;
}

const UNSEARCHABLE_TOOLTIP =
  'Every chunk of this document is held in quarantine — it returns no search results until a chunk is released.';

export default function WorkspaceDocumentDetailPage() {
  const { id: workspaceId, docId } = useParams<{ id: string; docId: string }>();
  const [searchParams] = useSearchParams();
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { open: openSourceViewer } = useSourceViewer();
  // Guards the `?chunk=` deep link so it auto-opens the viewer once per
  // load, not every time `document`/`searchParams` re-render.
  const autoOpenedRef = useRef(false);

  useEffect(() => {
    if (!workspaceId || !docId) return;
    documentApi.getDetail(workspaceId, docId).then(setDocument).catch((reason: Error) => setError(reason.message));
  }, [workspaceId, docId]);

  useEffect(() => {
    if (autoOpenedRef.current || !document || !workspaceId) return;
    const chunkId = searchParams.get('chunk');
    if (!chunkId) return;
    const chunk = document.chunks.find((c) => c.id === chunkId);
    if (!chunk) return;
    autoOpenedRef.current = true;
    openSourceViewer({ workspaceId, documentId: document.id, chunkId: chunk.id, documentName: document.original_filename });
  }, [document, workspaceId, searchParams, openSourceViewer]);

  if (!document && !error) return <LoadingSpinner text="Opening document…" />;
  if (!document) return <PageShell><EmptyState icon={<FileText size={24} />} title="Document unavailable" description={error || 'This document was not found.'} action={<Link to={`/workspaces/${workspaceId}`}><Button size="sm">Back to workspace</Button></Link>} /></PageShell>;

  const viewChunk = (chunkId: string) => {
    if (!workspaceId) return;
    openSourceViewer({ workspaceId, documentId: document.id, chunkId, documentName: document.original_filename });
  };

  return <div className="mx-auto max-w-4xl py-6"><PageShell><PageHeader title={document.original_filename} description={`${document.mime_type}${document.page_count ? ` · ${document.page_count} pages` : ''} · ${document.chunk_count} indexed chunks · ${document.status}`} actions={<div className="flex items-center gap-3">{isUnsearchableReady(document) && <span title={UNSEARCHABLE_TOOLTIP}><Badge color="orange">Unsearchable</Badge></span>}{(document.quarantined_chunk_count ?? 0) > 0 && <Badge color="red">{document.quarantined_chunk_count} chunks quarantined</Badge>}{document.chunks.length > 0 && <Button size="sm" variant="secondary" onClick={() => viewChunk(document.chunks[0].id)}><BookOpen size={14} /> Open document</Button>}<Link to={`/workspaces/${workspaceId}`} className="inline-flex items-center gap-1 text-sm text-primary-soft"><ArrowLeft size={14} /> Workspace</Link></div>} /><div className="space-y-3">{document.chunks.length === 0 ? <Card className="p-5 text-sm text-text-dim">This document has no indexed passages yet.</Card> : document.chunks.map((chunk) => <Card key={chunk.id} onClick={() => viewChunk(chunk.id)} hover className="p-4"><p className="mb-2 text-xs font-medium text-primary-soft">Passage {chunk.index + 1}</p><p className="whitespace-pre-wrap text-sm leading-relaxed text-text-muted">{chunk.content}</p></Card>)}</div></PageShell></div>;
}
