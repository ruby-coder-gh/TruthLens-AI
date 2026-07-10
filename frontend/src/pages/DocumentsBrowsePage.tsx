import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FileText, File, FileSpreadsheet, FileImage, Search, Clock, Upload } from 'lucide-react';
import { Card, Badge, Modal, LoadingSpinner, EmptyState, Button, Input, staggerContainer, staggerItem, pageTransition } from '../components/ui';
import { PageHeader, PageShell } from '../components/PageWrappers';
import { documentApi } from '../api/client';
import type { Document } from '../api/types';

const DOCUMENT_TYPE_FILTERS = ['All', 'PDF', 'DOCX', 'TXT'] as const;

function getFileIcon(mime: string) {
  if (mime.includes('pdf')) return <FileText size={20} />;
  if (mime.includes('spreadsheet') || mime.includes('excel')) return <FileSpreadsheet size={20} />;
  if (mime.includes('image')) return <FileImage size={20} />;
  return <File size={20} />;
}

function getFileType(mime: string): string {
  if (mime.includes('pdf')) return 'PDF';
  if (mime.includes('docx') || mime.includes('document')) return 'DOCX';
  if (mime.includes('txt')) return 'TXT';
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
    case 'indexed': return 'green';
    case 'pending': return 'orange';
    case 'failed': return 'red';
    case 'processing': return 'blue';
    default: return 'gray';
  }
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function DocumentsBrowsePage() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('All');
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  useEffect(() => {
    documentApi.listAll()
      .then((result) => {
        setDocuments(result.data || []);
        setLoading(false);
      })
      .catch(() => {
        setDocuments([]);
        setLoading(false);
      });
  }, []);

  const filtered = documents.filter((doc) => {
    const matchesSearch = doc.original_filename.toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === 'All' || getFileType(doc.mime_type) === typeFilter;
    return matchesSearch && matchesType;
  });

  return (
    <div className="-mx-4 lg:-mx-6 px-4 lg:px-8 xl:px-12">
      <motion.div
        className="mx-auto max-w-[1200px] space-y-5 py-6"
        variants={pageTransition}
        initial="initial"
        animate="animate"
      >
      <PageShell>
      {/* Header */}
      <motion.div variants={staggerItem}>
        <PageHeader
          title="Documents"
          description="Browse all indexed documents."
          actions={(
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
              <Button onClick={() => setUploadModalOpen(true)} size="md">
                <Upload size={16} />
                Upload Document
              </Button>
            </motion.div>
          )}
        />
      </motion.div>

      {/* Upload Area — dashed border with glowing hover */}
      <motion.div
        variants={staggerItem}
        onClick={() => setUploadModalOpen(true)}
        className="relative cursor-pointer group"
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.98 }}
      >
        <div className="rounded-2xl border-2 border-dashed border-white/10 bg-white/[0.02] p-8 text-center transition-all duration-300 group-hover:border-primary/40 group-hover:bg-primary/[0.04] group-hover:shadow-lg group-hover:shadow-primary/10">
          <motion.div
            className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary-soft"
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Upload size={24} />
          </motion.div>
          <h3 className="text-base font-semibold text-text group-hover:text-primary-soft transition-colors">
            Upload new document
          </h3>
          <p className="mt-1 text-sm text-text-muted">
            Drop files here or click to browse. Supports PDF, DOCX, TXT.
          </p>
        </div>
      </motion.div>

      {/* Search & Filters */}
      <motion.div variants={staggerItem} className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 max-w-md">
          <Input
            placeholder="Search documents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            icon={<Search size={16} />}
          />
        </div>
        <div className="flex gap-1.5">
          {DOCUMENT_TYPE_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setTypeFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                typeFilter === f
                  ? 'bg-primary/15 text-primary-soft border border-primary/20'
                  : 'glass text-text-muted hover:text-text hover:bg-white/[0.04]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Document Grid */}
      <motion.div
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        {loading ? (
          <LoadingSpinner text="Loading documents..." />
        ) : filtered.length === 0 ? (
          <div className="col-span-full">
            <EmptyState
              icon={<FileText size={24} />}
              title={search ? 'No documents match your search' : 'No documents available'}
              description={search ? 'Try modifying your search or filters.' : 'Documents will appear here once uploaded by an administrator.'}
              action={
                <Button onClick={() => setUploadModalOpen(true)} size="sm">
                  <Upload size={14} />
                  Upload Document
                </Button>
              }
            />
          </div>
        ) : (
          filtered.map((doc) => (
            <motion.div key={doc.id} variants={staggerItem}>
              <Card hover className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg glass text-primary-soft">
                    {getFileIcon(doc.mime_type)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text truncate">{doc.original_filename}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <Badge color={statusBadgeColor(doc.status)}>{doc.status}</Badge>
                      <span className="text-xs text-text-dim">{getFileType(doc.mime_type)}</span>
                      <span className="text-xs text-text-dim">{formatFileSize(doc.file_size)}</span>
                      {doc.chunk_count != null && (
                        <span className="text-xs text-text-dim">{doc.chunk_count} chunks</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-2 text-xs text-text-dim">
                      <Clock size={11} />
                      {formatDate(doc.created_at)}
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))
        )}
      </motion.div>

      {/* Upload Modal */}
      <Modal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        title="Upload Document"
      >
        <div className="space-y-4 text-center">
          <div className="rounded-2xl border-2 border-dashed border-white/10 p-8 hover:border-primary/30 transition-colors">
            <Upload size={32} className="mx-auto text-text-dim mb-3" />
            <p className="text-sm text-text-muted">Drag & drop or click to browse</p>
            <p className="text-xs text-text-dim mt-1">PDF, DOCX, TXT up to 50MB</p>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setUploadModalOpen(false)}>
              Cancel
            </Button>
            <Button>
              <Upload size={14} />
              Select File
            </Button>
          </div>
        </div>
      </Modal>
      </PageShell>
      </motion.div>
    </div>
  );
}
