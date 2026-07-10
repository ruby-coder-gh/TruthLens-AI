import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FileText, Search, Upload, ChevronRight, Clock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button, Badge, Input, EmptyState, staggerContainer, staggerItem, pageTransition } from '../components/ui';
import { PageHeader, PageShell, StateBlock } from '../components/PageWrappers';
import { documentApi } from '../api/client';

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
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'documents', search, page],
    queryFn: () => documentApi.listAll({ page, page_size: 20 }),
    placeholderData: (prev) => prev,
  });

  const documents = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));

  const filtered = documents.filter((doc) =>
    doc.original_filename.toLowerCase().includes(search.toLowerCase()),
  );

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

      {/* Search */}
      <motion.div variants={staggerItem} className="max-w-md">
        <Input
          placeholder="Search documents..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          icon={<Search size={16} />}
        />
      </motion.div>

      {/* Table */}
      <motion.div
        variants={staggerItem}
        className="overflow-x-auto rounded-xl border border-border glass"
      >
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-card-2/80">
              <th className="px-4 py-3 font-medium text-text-muted">Name</th>
              <th className="px-4 py-3 font-medium text-text-muted">Type</th>
              <th className="px-4 py-3 font-medium text-text-muted">Status</th>
              <th className="px-4 py-3 font-medium text-text-muted">Chunks</th>
              <th className="px-4 py-3 font-medium text-text-muted">Size</th>
              <th className="px-4 py-3 font-medium text-text-muted">Uploaded By</th>
              <th className="px-4 py-3 font-medium text-text-muted">Date</th>
              <th className="px-4 py-3 w-10" />
            </tr>
          </thead>
          <motion.tbody variants={staggerContainer} initial="initial" animate="animate">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12">
                  <EmptyState
                    icon={<FileText size={24} />}
                    title="No documents found"
                    description={search ? 'Try a different search term.' : 'No documents have been uploaded yet.'}
                  />
                </td>
              </tr>
            ) : (
              filtered.map((doc) => (
                <motion.tr
                  key={doc.id}
                  variants={staggerItem}
                  onClick={() => navigate(`/admin/documents/${doc.id}`)}
                  className="border-b border-border last:border-b-0 transition-colors hover:bg-card-2/50 cursor-pointer"
                >
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
          Showing {filtered.length} of {total} documents
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
      </PageShell>
    </motion.div>
  );
}
