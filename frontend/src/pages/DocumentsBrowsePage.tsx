import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  File,
  FileSpreadsheet,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  Upload,
} from 'lucide-react';
import { Badge, Button, Card, EmptyState, Input, LoadingSpinner, Modal } from '../components/ui';
import { pageTransition, staggerContainer, staggerItem } from '../components/motion';
import { PageHeader, PageShell } from '../components/PageWrappers';
import { useToast } from '../components/toast-context';
import { documentApi, workspaceApi } from '../api/client';
import type { Document, PaginatedResponse } from '../api/types';

const DOCUMENT_TYPE_FILTERS = ['All', 'PDF', 'DOCX', 'TXT', 'MD', 'CSV', 'JSON'] as const;
const PAGE_SIZE = 20;

type DocumentTypeFilter = typeof DOCUMENT_TYPE_FILTERS[number];

function getFileIcon(mime: string) {
  if (mime.includes('pdf')) return <FileText size={20} />;
  if (mime.includes('csv') || mime.includes('spreadsheet') || mime.includes('excel')) return <FileSpreadsheet size={20} />;
  return <File size={20} />;
}

function getFileType(mime: string, filename = ''): string {
  const extension = filename.split('.').pop()?.toUpperCase();
  if (extension && ['PDF', 'DOCX', 'TXT', 'MD', 'CSV', 'JSON'].includes(extension)) return extension;
  if (mime.includes('pdf')) return 'PDF';
  if (mime.includes('docx') || mime.includes('document')) return 'DOCX';
  if (mime.includes('markdown')) return 'MD';
  if (mime.includes('csv')) return 'CSV';
  if (mime.includes('json')) return 'JSON';
  if (mime.includes('text')) return 'TXT';
  return mime.split('/').pop()?.toUpperCase() || 'FILE';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusBadgeColor(status: string): 'green' | 'orange' | 'red' | 'blue' | 'gray' {
  switch (status) {
    case 'ready':
    case 'indexed': return 'green';
    case 'pending': return 'orange';
    case 'failed': return 'red';
    case 'processing': return 'blue';
    default: return 'gray';
  }
}

/**
 * BUG-9. `status === 'ready'` only means processing finished without a crash
 * — a document whose every chunk was quarantined at ingest ends up "ready"
 * with `chunk_count === 0` and is invisible to search. `is_searchable` is
 * derived server-side from the live chunk counts, so it self-heals once a
 * chunk is released; absent on rows predating the fix, hence the `=== false`.
 */
function isUnsearchableReady(doc: Document): boolean {
  return doc.is_searchable === false && doc.status === 'ready' && (doc.quarantined_chunk_count ?? 0) > 0;
}

const UNSEARCHABLE_TOOLTIP =
  'Every chunk of this document is held in quarantine — it returns no search results until a chunk is released.';

function documentRange(meta: PaginatedResponse<Document>['meta'] | null): string {
  if (!meta || meta.total === 0) return 'No documents';
  const start = (meta.page - 1) * meta.page_size + 1;
  const end = Math.min(meta.total, start + meta.page_size - 1);
  return `Showing ${start}–${end} of ${meta.total}`;
}

export default function DocumentsBrowsePage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<DocumentTypeFilter>('All');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [meta, setMeta] = useState<PaginatedResponse<Document>['meta'] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [resolvingWorkspace, setResolvingWorkspace] = useState(false);

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => {
      setLoading(true);
      documentApi.listAll({
        page,
        page_size: PAGE_SIZE,
        search: search.trim() || undefined,
        file_type: typeFilter === 'All' ? undefined : typeFilter.toLowerCase(),
      })
        .then((result) => {
          if (!active) return;
          setDocuments(result.data || []);
          setMeta(result.meta);
          setLoadError(null);
        })
        .catch((error: Error) => {
          if (!active) return;
          setLoadError(error.message || 'We could not load the document inventory.');
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [page, search, typeFilter, reloadToken]);

  const retryLoad = () => setReloadToken((value) => value + 1);

  async function handleSelectFile() {
    setResolvingWorkspace(true);
    try {
      const result = await workspaceApi.list();
      const workspaces = result.data || [];
      navigate(workspaces.length === 1 ? `/workspaces/${workspaces[0].id}` : '/workspaces');
      setUploadModalOpen(false);
    } catch {
      addToast('Failed to load your workspaces. Please try again.', 'error');
    } finally {
      setResolvingWorkspace(false);
    }
  }

  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.page_size)) : 1;
  const hasFilters = Boolean(search.trim()) || typeFilter !== 'All';

  return (
    <div className="-mx-4 px-4 lg:-mx-6 lg:px-8 xl:px-12">
      <motion.div className="mx-auto max-w-[1280px] space-y-5 py-6" variants={pageTransition} initial="initial" animate="animate">
        <PageShell>
          <motion.div variants={staggerItem}>
            <PageHeader
              title="Document Intelligence"
              description="A governed inventory across every workspace you can access. Search, verify ingestion state, and open the owning workspace."
              actions={(
                <Button onClick={() => setUploadModalOpen(true)} size="md">
                  <Upload size={16} /> Upload to workspace
                </Button>
              )}
            />
          </motion.div>

          <motion.div variants={staggerItem} className="grid gap-3 rounded-2xl border border-primary/15 bg-primary/[0.035] p-4 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <p className="text-sm font-semibold text-text">Workspace-scoped ingestion</p>
              <p className="mt-1 text-xs text-text-muted">Upload to a workspace to inherit its access controls. PDF, DOCX, TXT, MD, CSV, and JSON are supported up to 50 MB.</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setUploadModalOpen(true)}><Upload size={14} /> Choose workspace</Button>
          </motion.div>

          <motion.div variants={staggerItem} className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="w-full max-w-xl">
              <Input
                placeholder="Search every accessible document..."
                value={search}
                onChange={(event) => { setSearch(event.target.value); setPage(1); }}
                icon={<Search size={16} />}
              />
            </div>
            <div className="flex flex-wrap gap-1.5" aria-label="Document type filter">
              {DOCUMENT_TYPE_FILTERS.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => { setTypeFilter(filter); setPage(1); }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                    typeFilter === filter ? 'border border-primary/20 bg-primary/15 text-primary-soft' : 'glass text-text-muted hover:bg-white/[0.04] hover:text-text'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </motion.div>

          {loadError && (
            <motion.div variants={staggerItem} role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red/25 bg-red/5 px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-text-muted"><AlertCircle size={16} className="text-red" />{loadError}</div>
              <Button variant="secondary" size="sm" onClick={retryLoad}><RefreshCw size={14} /> Retry</Button>
            </motion.div>
          )}

          <motion.div variants={staggerItem} className="flex items-center justify-between text-xs text-text-dim">
            <span>{documentRange(meta)}</span>
            {loading && documents.length > 0 && <span className="inline-flex items-center gap-1"><Loader2 size={13} className="animate-spin" /> Updating inventory</span>}
          </motion.div>

          <motion.div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" variants={staggerContainer} initial="initial" animate="animate">
            {loading && documents.length === 0 ? (
              <div className="col-span-full"><LoadingSpinner text="Loading document inventory..." /></div>
            ) : documents.length === 0 ? (
              <div className="col-span-full">
                <EmptyState
                  icon={<FileText size={24} />}
                  title={hasFilters ? 'No documents match these filters' : 'No documents available'}
                  description={hasFilters ? 'Try a different search term or file type.' : 'Upload a document into a workspace to start grounded research.'}
                  action={<Button onClick={() => setUploadModalOpen(true)} size="sm"><Upload size={14} /> Upload document</Button>}
                />
              </div>
            ) : documents.map((document) => (
              <motion.button
                key={document.id}
                type="button"
                variants={staggerItem}
                onClick={() => navigate(`/workspaces/${document.workspace_id}`)}
                className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-xl"
              >
                <Card hover className="h-full p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg glass text-primary-soft">{getFileIcon(document.mime_type)}</div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text">{document.original_filename}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <Badge color={statusBadgeColor(document.status)}>{document.status === 'ready' ? 'indexed' : document.status}</Badge>
                        {isUnsearchableReady(document) && (
                          <span title={UNSEARCHABLE_TOOLTIP}>
                            <Badge color="orange">Unsearchable</Badge>
                          </span>
                        )}
                        <span className="text-xs text-text-dim">{getFileType(document.mime_type, document.original_filename)}</span>
                        <span className="text-xs text-text-dim">{formatFileSize(document.file_size)}</span>
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-xs text-text-dim">
                        <span>{document.chunk_count ?? 0} chunks</span><span aria-hidden="true">·</span><span>{formatDate(document.created_at)}</span>
                      </div>
                      {document.status === 'failed' && document.error_message && <p className="mt-2 line-clamp-2 text-xs text-red">{document.error_message}</p>}
                      <div className="mt-3 flex items-center gap-1 text-[11px] text-primary-soft"><Clock size={11} /> Open workspace</div>
                    </div>
                  </div>
                </Card>
              </motion.button>
            ))}
          </motion.div>

          {meta && meta.total > 0 && (
            <motion.div variants={staggerItem} className="flex items-center justify-center gap-3 border-t border-border pt-5">
              <Button variant="secondary" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={15} /> Previous</Button>
              <span className="text-xs text-text-muted">Page {page} of {totalPages}</span>
              <Button variant="secondary" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next <ChevronRight size={15} /></Button>
            </motion.div>
          )}

          <Modal open={uploadModalOpen} onClose={() => setUploadModalOpen(false)} title="Choose upload workspace">
            <div className="space-y-4 text-center">
              <div className="rounded-2xl border-2 border-dashed border-white/10 p-8">
                {resolvingWorkspace ? <Loader2 size={32} className="mx-auto mb-3 animate-spin text-primary-soft" /> : <Upload size={32} className="mx-auto mb-3 text-text-dim" />}
                <p className="text-sm text-text-muted">{resolvingWorkspace ? 'Finding your workspace…' : 'Documents are governed by the workspace they are uploaded to.'}</p>
                <p className="mt-1 text-xs text-text-dim">You will choose a file from the workspace document area.</p>
              </div>
              <div className="flex justify-end gap-3 pt-2"><Button variant="secondary" onClick={() => setUploadModalOpen(false)} disabled={resolvingWorkspace}>Cancel</Button><Button onClick={handleSelectFile} loading={resolvingWorkspace}><Upload size={14} /> Continue</Button></div>
            </div>
          </Modal>
        </PageShell>
      </motion.div>
    </div>
  );
}
