import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, FileText, Clock, Trash2, RefreshCw, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { Button, Card, Badge, Modal, LoadingSpinner, EmptyState, useToast, pageTransition, fadeInUp } from '../components/ui';
import type { Document } from '../api/types';

// ─── Mock Data ─────────────────────────────────────────────────────────────────

const MOCK_DOCUMENTS: Record<string, Document> = {
  d1: { id: 'd1', workspace_id: 'w1', filename: 'q3-financial-report-2025.pdf', original_filename: 'Q3 Financial Report 2025.pdf', mime_type: 'application/pdf', file_size: 2450000, page_count: 24, chunk_count: 48, status: 'indexed', uploaded_by: 'alice@example.com', created_at: '2026-06-15T10:00:00Z', updated_at: '2026-06-15T10:05:00Z' },
  d2: { id: 'd2', workspace_id: 'w1', filename: 'employment-contract-template.docx', original_filename: 'Employment Contract Template.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', file_size: 520000, page_count: 8, chunk_count: 16, status: 'indexed', uploaded_by: 'bob@example.com', created_at: '2026-06-14T14:30:00Z', updated_at: '2026-06-14T14:35:00Z' },
  d3: { id: 'd3', workspace_id: 'w1', filename: 'annual-report-2024.pdf', original_filename: 'Annual Report 2024.pdf', mime_type: 'application/pdf', file_size: 5200000, page_count: 62, chunk_count: 124, status: 'indexed', uploaded_by: 'alice@example.com', created_at: '2026-06-13T09:00:00Z', updated_at: '2026-06-13T09:08:00Z' },
};

const MOCK_CHUNKS = [
  { id: 'c1', excerpt: 'Revenue for Q3 2025 increased by 23% year-over-year, reaching $4.2 million. This growth was primarily driven by expansion in the enterprise segment, which saw a 31% increase in new customer acquisitions.' },
  { id: 'c2', excerpt: 'Operating expenses decreased by 8% compared to the same period last year, attributed to improved operational efficiency and strategic cost management initiatives implemented in Q1.' },
  { id: 'c3', excerpt: 'The company\'s cash position remains strong at $12.8 million, with a healthy operating runway of approximately 18 months based on current burn rate projections.' },
];

const STATUS_TIMELINE: { status: string; label: string; date: string }[] = [
  { status: 'uploaded', label: 'Uploaded', date: '2026-06-15T10:00:00Z' },
  { status: 'parsing', label: 'Parsing', date: '2026-06-15T10:01:00Z' },
  { status: 'chunking', label: 'Chunking', date: '2026-06-15T10:02:00Z' },
  { status: 'embedding', label: 'Embedding', date: '2026-06-15T10:03:00Z' },
  { status: 'indexing', label: 'Indexing', date: '2026-06-15T10:04:00Z' },
  { status: 'indexed', label: 'Indexed', date: '2026-06-15T10:05:00Z' },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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

// ─── Component ─────────────────────────────────────────────────────────────────

export default function AdminDocumentDetailPage() {
  const { docId } = useParams<{ docId: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [doc, setDoc] = useState<Document | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [reindexLoading, setReindexLoading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDoc(MOCK_DOCUMENTS[docId || ''] || null);
      setLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [docId]);

  function handleReindex() {
    setReindexLoading(true);
    setTimeout(() => {
      setReindexLoading(false);
      addToast('Document re-indexing started', 'success');
    }, 2000);
  }

  function handleDelete() {
    setDeleteLoading(true);
    setTimeout(() => {
      setDeleteLoading(false);
      setDeleteModalOpen(false);
      addToast('Document deleted', 'success');
      navigate('/admin/documents');
    }, 1500);
  }

  if (loading) {
    return <motion.div variants={pageTransition} initial="initial" animate="animate"><LoadingSpinner text="Loading document..." /></motion.div>;
  }

  if (!doc) {
    return (
      <motion.div variants={pageTransition} initial="initial" animate="animate">
        <EmptyState
          icon={<FileText size={24} />}
          title="Document not found"
          description="The requested document could not be found."
          action={<Button variant="secondary" onClick={() => navigate('/admin/documents')}>Back to Documents</Button>}
        />
      </motion.div>
    );
  }

  return (
    <motion.div
      className="space-y-5"
      variants={pageTransition}
      initial="initial"
      animate="animate"
    >
      {/* Back */}
      <button
        type="button"
        onClick={() => navigate('/admin/documents')}
        className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text transition-colors"
      >
        <ArrowLeft size={14} />
        Back to Documents
      </button>

      {/* Header Card */}
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
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={reindexLoading}
              onClick={handleReindex}
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

        {/* Metadata */}
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

      {/* Status Timeline */}
      <Card className="p-5 lg:p-6">
        <h2 className="text-sm font-semibold text-text mb-3 flex items-center gap-2">
          <Clock size={14} className="text-primary-soft" />
          Processing Timeline
        </h2>
        <div className="space-y-2">
          {STATUS_TIMELINE.map((step) => {
            const isDone = STATUS_TIMELINE.findIndex((s) => s.status === doc.status) >= STATUS_TIMELINE.findIndex((s) => s.status === step.status);
            return (
              <div key={step.status} className="flex items-center gap-3">
                <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                  isDone ? 'bg-green/15 text-green' : 'bg-card-2 text-text-dim'
                }`}>
                  {isDone ? <CheckCircle size={12} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                </div>
                <div className="flex-1 flex items-center justify-between">
                  <span className={`text-xs ${isDone ? 'text-text' : 'text-text-dim'}`}>{step.label}</span>
                  {isDone && <span className="text-[10px] text-text-dim">{formatDate(step.date)}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Chunk Preview */}
      <Card className="p-5 lg:p-6">
        <h2 className="text-sm font-semibold text-text mb-3 flex items-center gap-2">
          <FileText size={14} className="text-accent" />
          Chunk Preview
        </h2>
        <div className="space-y-3">
          {MOCK_CHUNKS.map((chunk, i) => (
            <div key={chunk.id} className="rounded-xl glass p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <Badge color="gray">Chunk {i + 1}</Badge>
                <span className="text-[10px] text-text-dim">{chunk.id}</span>
              </div>
              <p className="text-sm text-text-muted leading-relaxed">&ldquo;{chunk.excerpt}&rdquo;</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Delete Modal */}
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
            <Button variant="danger" size="sm" loading={deleteLoading} onClick={handleDelete}>
              <Trash2 size={14} />
              Delete
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setDeleteModalOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </motion.div>
  );
}
