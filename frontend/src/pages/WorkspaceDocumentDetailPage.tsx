import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileText } from 'lucide-react';
import { Button, Card, EmptyState, LoadingSpinner } from '../components/ui';
import { PageHeader, PageShell } from '../components/PageWrappers';
import { documentApi } from '../api/client';
import type { DocumentDetail } from '../api/types';

export default function WorkspaceDocumentDetailPage() {
  const { id: workspaceId, docId } = useParams<{ id: string; docId: string }>();
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!workspaceId || !docId) return;
    documentApi.getDetail(workspaceId, docId).then(setDocument).catch((reason: Error) => setError(reason.message));
  }, [workspaceId, docId]);
  if (!document && !error) return <LoadingSpinner text="Opening document…" />;
  if (!document) return <PageShell><EmptyState icon={<FileText size={24} />} title="Document unavailable" description={error || 'This document was not found.'} action={<Link to={`/workspaces/${workspaceId}`}><Button size="sm">Back to workspace</Button></Link>} /></PageShell>;
  return <div className="mx-auto max-w-4xl py-6"><PageShell><PageHeader title={document.original_filename} description={`${document.mime_type} · ${document.chunk_count} indexed chunks`} actions={<Link to={`/workspaces/${workspaceId}`} className="inline-flex items-center gap-1 text-sm text-primary-soft"><ArrowLeft size={14} /> Workspace</Link>} /><div className="space-y-3">{document.chunks.length === 0 ? <Card className="p-5 text-sm text-text-dim">This document has no indexed passages yet.</Card> : document.chunks.map((chunk) => <Card key={chunk.id} className="p-4"><p className="mb-2 text-xs font-medium text-primary-soft">Passage {chunk.index + 1}</p><p className="whitespace-pre-wrap text-sm leading-relaxed text-text-muted">{chunk.content}</p></Card>)}</div></PageShell></div>;
}
