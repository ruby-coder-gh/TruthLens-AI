import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowLeft, FileText, Clock, Trash2, RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react';
import { Button, Card, Badge, Modal } from '../components/ui';
import { pageTransition, fadeInUp } from '../components/motion';
import { useToast } from '../components/toast-context';
import { PageHeader, PageShell, StateBlock } from '../components/PageWrappers';
import { documentApi } from '../api/client';

const STATUS_ORDER = ['uploaded', 'parsing', 'chunking', 'embedding', 'indexing', 'indexed'] as const;

const STATUS_LABELS: Record<string, string> = {
  uploaded: 'Uploaded',
  parsing: 'Parsing',
  chunking: 'Chunking',
  embedding: 'Embedding',
  indexing: 'Indexing',
  indexed: 'Indexed',
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function statusBadgeColor(status: string): 'green' | 'orange' | 'red' | 'blue' | 'gray' {
  switch (status) {
    case 'indexed': return 'green';
    case 'pending': return 'orange';
    case 'failed': return 'red';
    case 'processing': return 'blue';
    default: return 'gray';
  }
}

function getFileType(mime: string): string {
  if (mime.includes('pdf')) return 'PDF';
  if (mime.includes('docx') || mime.includes('document')) return 'DOCX';
  if (mime.includes('txt')) return 'TXT';
  return 'FILE';
}

export default function AdminDocumentDetailPage() {
  const { docId } = useParams<{ docId: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  // The route only gives us the document id, not its workspace id — and the
  // detail/delete/reindex endpoints are workspace-scoped. Resolve the real
  // workspace id via the workspace-agnostic `listAll` lookup first, then use
  // it for the actual document fetch (previously this hardcoded a literal
  // 'default' workspace id, which the backend rejected as an invalid UUID).
  const {
    data: doc,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['document', docId],
    queryFn: async () => {
      const found = await documentApi.listAll({ page_size: 100 }).then(
        (res) => res.data.find((d) => d.id === docId),
      );
      if (!found) throw new Error('Document not found.');
      return documentApi.get(found.workspace_id, docId!);
    },
    enabled: !!docId,
  });

  const deleteMutation = useMutation({
    mutationFn: () => documentApi.delete(doc!.workspace_id, docId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setDeleteModalOpen(false);
      addToast('Document deleted', 'success');
      navigate('/admin/documents');
    },
    onError: (err) => {
      addToast(err instanceof Error ? err.message : 'Failed to delete document', 'error');
    },
  });

  const reindexMutation = useMutation({
    mutationFn: () => documentApi.reindex(doc!.workspace_id, docId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document', docId] });
      addToast('Document re-indexing started', 'success');
    },
    onError: (err) => {
      addToast(err instanceof Error ? err.message : 'Failed to re-index document', 'error');
    },
  });

  if (isLoading) {
    return (
      <motion.div variants={pageTransition} initial="initial" animate="animate">
        <PageShell>
          <PageHeader title="Document Details" description="Inspect document status, metadata, and indexing timeline." />
          <StateBlock role="status">Loading document…</StateBlock>
        </PageShell>
      </motion.div>
    );
  }

  if (isError) {
    return (
      <motion.div variants={pageTransition} initial="initial" animate="animate">
        <PageShell>
          <PageHeader title="Document Details" description="Inspect document status, metadata, and indexing timeline." />
          <StateBlock tone="danger" role="alert" className="space-y-3">
            <p>{error instanceof Error ? error.message : 'Failed to load document.'}</p>
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              <RefreshCw size={14} />
              Retry
            </Button>
          </StateBlock>
        </PageShell>
      </motion.div>
    );
  }

  if (!doc) {
    return (
      <motion.div variants={pageTransition} initial="initial" animate="animate">
        <PageShell>
          <PageHeader title="Document Details" description="Inspect document status, metadata, and indexing timeline." />
          <StateBlock role="alert" className="space-y-3">
            <p>The requested document could not be found.</p>
            <Button variant="secondary" size="sm" onClick={() => navigate('/admin/documents')}>
              Back to Documents
            </Button>
          </StateBlock>
        </PageShell>
      </motion.div>
    );
  }

  const currentIdx = STATUS_ORDER.indexOf(doc.status as typeof STATUS_ORDER[number]);

  return (
    <motion.div variants={pageTransition} initial="initial" animate="animate">
      <PageShell>
      <button
        type="button"
        onClick={() => navigate('/admin/documents')}
        className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text transition-colors"
      >
        <ArrowLeft size={14} />
        Back to Documents
      </button>

      <PageHeader
        title="Document Details"
        description="Inspect document status, metadata, and indexing timeline."
      />

      <motion.div variants={fadeInUp}>
        <Card className="p-5 lg:p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl glass text-primary-soft">
                <FileText size={24} />
              </div>
              <div>
                <h1 className="text-xl font-bold text-text">{doc.original_filename}</h1>
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                  <Badge color={statusBadgeColor(doc.status)}>{doc.status}</Badge>
                  <span className="text-xs text-text-muted">{getFileType(doc.mime_type)}</span>
                  <span className="text-xs text-text-muted">{formatFileSize(doc.file_size)}</span>
                  {doc.page_count != null && <span className="text-xs text-text-muted">{doc.page_count} pages</span>}
                  {doc.chunk_count != null && <span className="text-xs text-text-muted">{doc.chunk_count} chunks</span>}
                  {/* F7a — passages the injection scanner held back at ingest time. */}
                  {(doc.quarantined_chunk_count ?? 0) > 0 && (
                    <Badge color="red">
                      {doc.quarantined_chunk_count} chunks quarantined
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                loading={reindexMutation.isPending}
                onClick={() => reindexMutation.mutate()}
              >
                <RefreshCw size={14} />
                Re-index
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => setDeleteModalOpen(true)}
              >
                <Trash2 size={14} />
                Delete
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-5 border-t border-border">
            <div>
              <p className="text-xs text-text-dim">Uploaded by</p>
              <p className="text-sm text-text">{doc.uploaded_by}</p>
            </div>
            <div>
              <p className="text-xs text-text-dim">Created</p>
              <p className="text-sm text-text">{formatDate(doc.created_at)}</p>
            </div>
            <div>
              <p className="text-xs text-text-dim">Updated</p>
              <p className="text-sm text-text">{formatDate(doc.updated_at)}</p>
            </div>
            <div>
              <p className="text-xs text-text-dim">Workspace ID</p>
              <p className="text-sm font-mono text-text-dim text-xs">{doc.workspace_id}</p>
            </div>
          </div>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <Card className="p-5 lg:p-6">
          <h2 className="text-sm font-semibold text-text mb-3 flex items-center gap-2">
            <Clock size={14} className="text-primary-soft" />
            Processing Timeline
          </h2>
          <div className="space-y-2">
            {STATUS_ORDER.map((status, i) => {
              const isDone = currentIdx >= 0 && i <= currentIdx;
              const isLastCompleted = isDone && (i === currentIdx || currentIdx === STATUS_ORDER.length - 1);
              return (
                <div key={status} className="flex items-center gap-3">
                  <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                    isDone ? 'bg-green/15 text-green' : 'bg-card-2 text-text-dim'
                  }`}>
                    {isDone ? <CheckCircle size={12} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                  </div>
                  <div className="flex-1 flex items-center justify-between">
                    <span className={`text-xs ${isDone ? 'text-text' : 'text-text-dim'}`}>{STATUS_LABELS[status]}</span>
                    {isLastCompleted && (
                      <span className="text-[10px] text-text-dim">{formatDate(doc.updated_at)}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <Card className="p-5 lg:p-6">
          <h2 className="text-sm font-semibold text-text mb-3 flex items-center gap-2">
            <FileText size={14} className="text-accent" />
            Chunks
          </h2>
          <p className="text-sm text-text-muted">
            Chunks are loaded on demand from the document viewer.
          </p>
        </Card>
      </motion.div>

      <Modal open={deleteModalOpen} onClose={() => setDeleteModalOpen(false)} title="Delete Document">
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl bg-red/10 border border-red/20 p-4">
            <AlertTriangle size={20} className="text-red shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red">Are you sure?</p>
              <p className="text-xs text-text-muted mt-1">
                This will permanently delete <strong className="text-text">{doc.original_filename}</strong> and all its chunks.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="danger" size="sm" loading={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
              <Trash2 size={14} />
              Delete
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setDeleteModalOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
      </PageShell>
    </motion.div>
  );
}
