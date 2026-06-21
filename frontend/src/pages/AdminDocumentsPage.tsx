import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FileText, Search, Upload, ChevronRight, Clock } from 'lucide-react';
import { Button, Card, Badge, Input, LoadingSpinner, EmptyState, staggerContainer, staggerItem, pageTransition } from '../components/ui';
import type { Document } from '../api/types';

const MOCK_DOCUMENTS: Document[] = [
  { id: 'd1', workspace_id: 'w1', filename: 'q3-financial-report-2025.pdf', original_filename: 'Q3 Financial Report 2025.pdf', mime_type: 'application/pdf', file_size: 2450000, page_count: 24, chunk_count: 48, status: 'indexed', uploaded_by: 'alice@example.com', created_at: '2026-06-15T10:00:00Z', updated_at: '2026-06-15T10:05:00Z' },
  { id: 'd2', workspace_id: 'w1', filename: 'employment-contract-template.docx', original_filename: 'Employment Contract Template.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', file_size: 520000, page_count: 8, chunk_count: 16, status: 'indexed', uploaded_by: 'bob@example.com', created_at: '2026-06-14T14:30:00Z', updated_at: '2026-06-14T14:35:00Z' },
  { id: 'd3', workspace_id: 'w1', filename: 'annual-report-2024.pdf', original_filename: 'Annual Report 2024.pdf', mime_type: 'application/pdf', file_size: 5200000, page_count: 62, chunk_count: 124, status: 'indexed', uploaded_by: 'alice@example.com', created_at: '2026-06-13T09:00:00Z', updated_at: '2026-06-13T09:08:00Z' },
  { id: 'd4', workspace_id: 'w1', filename: 'project-charter-v3.docx', original_filename: 'Project Charter v3.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', file_size: 380000, page_count: 5, chunk_count: 10, status: 'indexed', uploaded_by: 'carol@example.com', created_at: '2026-06-12T16:00:00Z', updated_at: '2026-06-12T16:03:00Z' },
  { id: 'd5', workspace_id: 'w1', filename: 'compliance-audit-2025.pdf', original_filename: 'Compliance Audit 2025.pdf', mime_type: 'application/pdf', file_size: 3100000, page_count: 36, chunk_count: 72, status: 'pending', uploaded_by: 'bob@example.com', created_at: '2026-06-11T11:00:00Z', updated_at: '2026-06-11T11:00:00Z' },
  { id: 'd6', workspace_id: 'w1', filename: 'environmental-impact-assessment.pdf', original_filename: 'Environmental Impact Assessment.pdf', mime_type: 'application/pdf', file_size: 8900000, page_count: 98, chunk_count: 196, status: 'indexed', uploaded_by: 'alice@example.com', created_at: '2026-06-10T08:00:00Z', updated_at: '2026-06-10T08:10:00Z' },
  { id: 'd7', workspace_id: 'w1', filename: 'meeting-notes-june.txt', original_filename: 'Meeting Notes June.txt', mime_type: 'text/plain', file_size: 15000, chunk_count: 3, status: 'failed', uploaded_by: 'carol@example.com', created_at: '2026-06-09T15:00:00Z', updated_at: '2026-06-09T15:02:00Z' },
  { id: 'd8', workspace_id: 'w1', filename: 'research-paper-ai-ethics.pdf', original_filename: 'Research Paper - AI Ethics.pdf', mime_type: 'application/pdf', file_size: 1200000, page_count: 15, chunk_count: 30, status: 'indexed', uploaded_by: 'alice@example.com', created_at: '2026-06-08T12:00:00Z', updated_at: '2026-06-08T12:04:00Z' },
  { id: 'd9', workspace_id: 'w1', filename: 'budget-proposal-2026.xlsx', original_filename: 'Budget Proposal 2026.xlsx', mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', file_size: 890000, chunk_count: 18, status: 'pending', uploaded_by: 'bob@example.com', created_at: '2026-06-07T09:00:00Z', updated_at: '2026-06-07T09:00:00Z' },
  { id: 'd10', workspace_id: 'w1', filename: 'security-policy-v2.pdf', original_filename: 'Security Policy v2.pdf', mime_type: 'application/pdf', file_size: 450000, page_count: 6, chunk_count: 12, status: 'indexed', uploaded_by: 'carol@example.com', created_at: '2026-06-06T16:00:00Z', updated_at: '2026-06-06T16:02:00Z' },
];

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

// ─── Component ─────────────────────────────────────────────────────────────────

export default function AdminDocumentsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<Document[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDocuments(MOCK_DOCUMENTS);
      setLoading(false);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  const filtered = documents.filter((doc) =>
    doc.original_filename.toLowerCase().includes(search.toLowerCase()),
  );

  if (loading) {
    return (
      <motion.div variants={pageTransition} initial="initial" animate="animate">
        <LoadingSpinner text="Loading documents..." />
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
      {/* Header */}
      <motion.div variants={staggerItem} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">Documents</h1>
          <p className="text-sm text-text-muted mt-1">Manage all indexed documents.</p>
        </div>
        <Link to="/admin/documents/upload">
          <Button size="sm">
            <Upload size={14} />
            Upload Document
          </Button>
        </Link>
      </motion.div>

      {/* Search */}
      <motion.div variants={staggerItem} className="max-w-md">
        <Input
          placeholder="Search documents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
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
          <tbody>
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
                <tr
                  key={doc.id}
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
                </tr>
              ))
            )}
          </tbody>
        </table>
      </motion.div>

      <motion.p variants={staggerItem} className="text-xs text-text-muted">
        Showing {filtered.length} of {documents.length} documents
      </motion.p>
    </motion.div>
  );
}
