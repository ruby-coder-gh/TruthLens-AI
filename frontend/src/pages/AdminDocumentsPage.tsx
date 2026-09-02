import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FileText, Search, Upload, ChevronRight, Clock, Tag as TagIcon, Trash2, RefreshCw, AlertTriangle, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Badge, Input, EmptyState, Modal } from '../components/ui';
import { useToast } from '../components/toast-context';
import { staggerContainer, staggerItem, pageTransition } from '../components/motion';
import { PageHeader, PageShell, StateBlock } from '../components/PageWrappers';
import { documentApi } from '../api/client';
import type { BulkDocumentAction } from '../api/types';

const ACTION_LABELS: Record<BulkDocumentAction, string> = {
  delete: 'Delete',
  reindex: 'Reindex',
  tag: 'Tag',
  untag: 'Untag',
};

function getFileType(mime: string): string {
  if (mime.includes('pdf')) return 'PDF';
  if (mime.includes('docx') || mime.includes('document')) return 'DOCX';
  if (mime.includes('sheet') || mime.includes('excel')) return 'XLSX';
  if (mime.includes('txt')) return 'TXT';
  return 'FILE';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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

export default function AdminDocumentsPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [reindexModalOpen, setReindexModalOpen] = useState(false);
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [tagInput, setTagInput] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'documents', search, tagFilter, page],
    queryFn: () => documentApi.listAll({
      page,
      page_size: 20,
      search: search || undefined,
      tags: tagFilter || undefined,
    }),
    placeholderData: (prev) => prev,
  });

  const documents = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));

  const allSelected = documents.length > 0 && documents.every((doc) => selected.has(doc.id));
  const someSelected = !allSelected && documents.some((doc) => selected.has(doc.id));
  const selectedDocs = documents.filter((doc) => selected.has(doc.id));
  const commonTags = selectedDocs.length === 0
    ? []
    : selectedDocs.reduce<string[]>(
      (acc, doc, index) => (index === 0 ? [...(doc.tags ?? [])] : acc.filter((tag) => (doc.tags ?? []).includes(tag))),
      [],
    );

  const bulkMutation = useMutation({
    mutationFn: ({ action, ids, tags }: { action: BulkDocumentAction; ids: string[]; tags?: string[] }) =>
      documentApi.bulk(action, ids, tags),
    onSuccess: (response, variables) => {
      const { ok, accepted, failed } = response.summary;
      addToast(
        `${ACTION_LABELS[variables.action]}: ${ok} ok, ${accepted} accepted, ${failed} failed`,
        failed > 0 ? 'error' : 'success',
      );
      queryClient.invalidateQueries({ queryKey: ['admin', 'documents'] });
    },
    onError: (err) => {
      addToast(err instanceof Error ? err.message : 'Bulk action failed.', 'error');
    },
  });

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        documents.forEach((doc) => next.delete(doc.id));
      } else {
        documents.forEach((doc) => next.add(doc.id));
      }
      return next;
    });
  }

  function toggleSelectOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function confirmDelete() {
    const ids = Array.from(selected);
    bulkMutation.mutate(
      { action: 'delete', ids },
      { onSuccess: () => { setSelected(new Set()); setDeleteModalOpen(false); } },
    );
  }

  function confirmReindex() {
    const ids = Array.from(selected);
    bulkMutation.mutate(
      { action: 'reindex', ids },
      { onSuccess: () => { setSelected(new Set()); setReindexModalOpen(false); } },
    );
  }

  function applyTags() {
    const tags = tagInput.split(',').map((t) => t.trim()).filter(Boolean);
    if (tags.length === 0) return;
    const ids = Array.from(selected);
    bulkMutation.mutate(
      { action: 'tag', ids, tags },
      { onSuccess: () => { setSelected(new Set()); setTagModalOpen(false); setTagInput(''); } },
    );
  }

  function removeTag(tag: string) {
    const ids = Array.from(selected);
    bulkMutation.mutate({ action: 'untag', ids, tags: [tag] });
  }

  if (isLoading) {
    return (
      <motion.div variants={pageTransition} initial="initial" animate="animate">
        <PageShell>
          <PageHeader title="Documents" description="Manage all indexed documents." />
          <StateBlock role="status">Loading documents…</StateBlock>
        </PageShell>
      </motion.div>
    );
  }

  if (isError) {
    return (
      <motion.div variants={pageTransition} initial="initial" animate="animate">
        <PageShell>
          <PageHeader title="Documents" description="Manage all indexed documents." />
          <StateBlock tone="danger" role="alert" className="space-y-3">
            <p>{(error as Error)?.message ?? 'Failed to load documents.'}</p>
            <Button onClick={() => refetch()} size="sm" variant="secondary">Retry</Button>
          </StateBlock>
        </PageShell>
      </motion.div>
    );
  }

  return (
    <motion.div variants={pageTransition} initial="initial" animate="animate">
      <PageShell>
      {/* Header */}
      <motion.div variants={staggerItem}>
        <PageHeader
          title="Documents"
          description="Manage all indexed documents."
          actions={(
            <Link to="/admin/documents/upload">
              <Button size="sm">
                <Upload size={14} />
                Upload Document
              </Button>
            </Link>
          )}
        />
      </motion.div>

      {/* Search + tag filter */}
      <motion.div variants={staggerItem} className="flex flex-col gap-3 sm:flex-row sm:max-w-2xl">
        <Input
          placeholder="Search documents..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          icon={<Search size={16} />}
          className="sm:max-w-md"
        />
        <Input
          placeholder="Filter by tags (comma-separated)"
          value={tagFilter}
          onChange={(e) => { setTagFilter(e.target.value); setPage(1); }}
          icon={<TagIcon size={16} />}
          className="sm:max-w-xs"
        />
      </motion.div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <motion.div
          variants={staggerItem}
          className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 backdrop-blur-md"
        >
          <p className="text-sm font-medium text-text">{selected.size} selected</p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setTagModalOpen(true)}>
              <TagIcon size={14} />
              Tag
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setReindexModalOpen(true)}>
              <RefreshCw size={14} />
              Reindex
            </Button>
            <Button size="sm" variant="danger" onClick={() => setDeleteModalOpen(true)}>
              <Trash2 size={14} />
              Delete
            </Button>
          </div>
        </motion.div>
      )}

      {/* Table */}
      <motion.div
        variants={staggerItem}
        className="overflow-x-auto rounded-xl border border-border glass"
      >
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-card-2/80">
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={toggleSelectAll}
                  aria-label="Select all documents"
                  className="h-4 w-4 accent-primary"
                />
              </th>
              <th className="px-4 py-3 font-medium text-text-muted">Name</th>
              <th className="px-4 py-3 font-medium text-text-muted">Type</th>
              <th className="px-4 py-3 font-medium text-text-muted">Status</th>
              <th className="px-4 py-3 font-medium text-text-muted">Chunks</th>
              <th className="px-4 py-3 font-medium text-text-muted">Size</th>
              <th className="px-4 py-3 font-medium text-text-muted">Tags</th>
              <th className="px-4 py-3 font-medium text-text-muted">Uploaded By</th>
              <th className="px-4 py-3 font-medium text-text-muted">Date</th>
              <th className="px-4 py-3 w-10" />
            </tr>
          </thead>
          <motion.tbody variants={staggerContainer} initial="initial" animate="animate">
            {documents.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-12">
                  <EmptyState
                    icon={<FileText size={24} />}
                    title="No documents found"
                    description={search || tagFilter ? 'Try a different search term or tag filter.' : 'No documents have been uploaded yet.'}
                  />
                </td>
              </tr>
            ) : (
              documents.map((doc) => (
                <motion.tr
                  key={doc.id}
                  variants={staggerItem}
                  onClick={() => navigate(`/admin/documents/${doc.id}`)}
                  className="border-b border-border last:border-b-0 transition-colors hover:bg-card-2/50 cursor-pointer"
                >
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(doc.id)}
                      onChange={() => toggleSelectOne(doc.id)}
                      aria-label={`Select ${doc.original_filename}`}
                      className="h-4 w-4 accent-primary"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="text-primary-soft shrink-0" />
                      <span className="text-text truncate max-w-[220px] block">{doc.original_filename}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-text-muted">{getFileType(doc.mime_type)}</td>
                  <td className="px-4 py-3">
                    <Badge color={statusBadgeColor(doc.status)}>{doc.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-text tabular-nums">{doc.chunk_count ?? '—'}</td>
                  <td className="px-4 py-3 text-text-muted tabular-nums">{formatFileSize(doc.file_size)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1 max-w-[160px]">
                      {(doc.tags ?? []).length === 0 ? (
                        <span className="text-xs text-text-dim">—</span>
                      ) : (
                        doc.tags.map((tag) => <Badge key={tag} color="purple">{tag}</Badge>)
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-text-muted text-xs">{doc.uploaded_by}</td>
                  <td className="px-4 py-3 text-text-dim text-xs whitespace-nowrap">
                    <span className="flex items-center gap-1">
                      <Clock size={11} />
                      {formatDate(doc.created_at)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <ChevronRight size={14} className="text-text-dim" />
                  </td>
                </motion.tr>
              ))
            )}
          </motion.tbody>
        </table>
      </motion.div>

      {/* Pagination */}
      <motion.div variants={staggerItem} className="flex items-center justify-between">
        <p className="text-xs text-text-muted">
          Showing {documents.length} of {total} documents
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span className="text-xs text-text-muted tabular-nums">
            Page {page} of {totalPages}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </motion.div>

      {/* Tag modal */}
      <Modal open={tagModalOpen} onClose={() => setTagModalOpen(false)} title="Tag Documents">
        <div className="space-y-4">
          <p className="text-sm text-text-muted">
            Apply tags to <strong className="text-text">{selected.size}</strong> selected document{selected.size === 1 ? '' : 's'}.
          </p>
          {commonTags.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-text-muted">Existing tags</p>
              <div className="flex flex-wrap gap-2">
                {commonTags.map((tag) => (
                  <Badge key={tag} color="purple" className="gap-1.5 pr-1.5">
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      aria-label={`Remove tag ${tag}`}
                      className="ml-1 rounded-full p-0.5 hover:bg-black/20"
                    >
                      <X size={10} />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <Input
            label="Add tags (comma-separated)"
            placeholder="legal, finance"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
          />
          <div className="flex gap-3">
            <Button size="sm" loading={bulkMutation.isPending} onClick={applyTags}>
              Apply Tags
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setTagModalOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm modal */}
      <Modal open={deleteModalOpen} onClose={() => setDeleteModalOpen(false)} title="Delete Documents">
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-red/20 bg-red/10 p-4">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-red" />
            <div>
              <p className="text-sm font-medium text-red">Are you sure?</p>
              <p className="mt-1 text-xs text-text-muted">
                This will permanently delete <strong className="text-text">{selected.size}</strong> document{selected.size === 1 ? '' : 's'} and all associated chunks.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="danger" size="sm" loading={bulkMutation.isPending} onClick={confirmDelete}>
              <Trash2 size={14} />
              Delete
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setDeleteModalOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Reindex confirm modal */}
      <Modal open={reindexModalOpen} onClose={() => setReindexModalOpen(false)} title="Reindex Documents">
        <div className="space-y-4">
          <p className="text-sm text-text-muted">
            Re-index <strong className="text-text">{selected.size}</strong> document{selected.size === 1 ? '' : 's'}? This will re-process each file and rebuild its embeddings.
          </p>
          <div className="flex gap-3">
            <Button size="sm" loading={bulkMutation.isPending} onClick={confirmReindex}>
              <RefreshCw size={14} />
              Reindex
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setReindexModalOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
      </PageShell>
    </motion.div>
  );
}
