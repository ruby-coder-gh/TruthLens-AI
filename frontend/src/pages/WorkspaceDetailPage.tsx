import { useState, useRef, type FormEvent, type DragEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Upload,
  Trash2,
  Users,
  FileText,
  Settings,
  UserPlus,
  X,
  AlertTriangle,
  UploadCloud,
  CheckCircle2,
  Clock,
  FileWarning,
} from 'lucide-react';
import {
  Button,
  Input,
  TextArea,
  Select,
  Card,
  Badge,
  Modal,
  Tabs,
  EmptyState,
  Skeleton,
  ProgressBar,
  useToast,
  staggerContainer,
  staggerItem,
  fadeIn,
  pageTransition,
  slideInRight,
} from '../components/ui';
import {
  workspaceApi,
  documentApi,
} from '../api/client';
import { useAuth } from '../context/AuthContext';
import type {
  Workspace,
  Document,
} from '../api/types';

// ─── Tab definitions ─────────────────────────────────────────────────────────
const TABS = [
  { id: 'documents', label: 'Documents', icon: <FileText size={16} /> },
  { id: 'members', label: 'Members', icon: <Users size={16} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={16} /> },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function statusBadgeColor(status: string) {
  switch (status) {
    case 'ready':
      return 'green' as const;
    case 'processing':
      return 'orange' as const;
    case 'pending':
      return 'blue' as const;
    case 'failed':
      return 'red' as const;
    default:
      return 'gray' as const;
  }
}

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

// ─── Status icon ─────────────────────────────────────────────────────────────
function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'ready':
      return <CheckCircle2 size={14} className="text-green" />;
    case 'processing':
    case 'pending':
      return (
        <motion.span
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
        >
          <Clock size={14} />
        </motion.span>
      );
    case 'failed':
      return <FileWarning size={14} className="text-red" />;
    default:
      return null;
  }
}

// ─── Upload Progress Area ────────────────────────────────────────────────────
function UploadProgressArea({
  uploading,
  uploadFileName,
  uploadProgress,
}: {
  uploading: boolean;
  uploadFileName: string | null;
  uploadProgress: number;
}) {
  if (!uploading) return null;
  return (
    <motion.div
      className="glass rounded-2xl p-4 mb-4"
      initial={{ opacity: 0.99, y: -10, height: 0 }}
      animate={{ opacity: 1, y: 0, height: 'auto' }}
      exit={{ opacity: 0, y: -10, height: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="mb-2 flex items-center gap-2 text-sm text-text">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
        >
          <Upload size={14} className="text-primary" />
        </motion.div>
        <span className="truncate font-medium">{uploadFileName || 'Uploading…'}</span>
      </div>
      <ProgressBar
        value={uploadProgress}
        size="sm"
        label={
          uploadProgress < 100
            ? 'Uploading…'
            : 'Processing…'
        }
      />
    </motion.div>
  );
}

// ─── Workspace Header ────────────────────────────────────────────────────────
function WorkspaceHeader({
  workspace,
  isOwner,
  navigate,
  activeTab,
  setActiveTab,
}: {
  workspace: Workspace;
  isOwner: boolean;
  navigate: ReturnType<typeof useNavigate>;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}) {
  return (
    <motion.div variants={staggerItem} className="space-y-4">
      <motion.button
        type="button"
        onClick={() => navigate('/workspaces')}
        className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text transition-colors group"
        whileHover={{ x: -4 }}
        transition={{ duration: 0.2 }}
      >
        <ArrowLeft size={16} className="transition-transform group-hover:-translate-x-0.5" />
        Back to workspaces
      </motion.button>

      <motion.div
        className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"
        variants={staggerItem}
      >
        <div>
          <motion.h1
            className="text-2xl font-bold text-text"
            initial={{ opacity: 0.99, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] as const }}
          >
            {workspace.name}
            <motion.div
              className="mt-1 h-0.5 w-full rounded-full bg-gradient-to-r from-primary via-accent to-accent-2"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.8, delay: 0.3, ease: [0.16, 1, 0.3, 1] as const }}
              style={{ transformOrigin: 'left' }}
            />
          </motion.h1>
          <motion.p
            className="mt-2 text-sm text-text-muted"
            initial={{ opacity: 0.99 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.25 }}
          >
            {workspace.description || 'No description'}
          </motion.p>
          <motion.div
            className="mt-3 flex items-center gap-4 text-xs text-text-dim"
            initial={{ opacity: 0.99 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            <span className="flex items-center gap-1.5">
              <Users size={14} />
              {workspace.member_count || 1} members
            </span>
            <span className="flex items-center gap-1.5">
              <FileText size={14} />
              {workspace.document_count || 0} documents
            </span>
            {isOwner && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', damping: 15, stiffness: 200, delay: 0.4 }}
              >
                <Badge color="purple">Owner</Badge>
              </motion.span>
            )}
          </motion.div>
        </div>
      </motion.div>

      {/* Tabs */}
      <motion.div variants={staggerItem}>
        <Tabs
          tabs={TABS}
          activeTab={activeTab}
          onChange={setActiveTab}
          className="mt-6"
        />
      </motion.div>
    </motion.div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  PAGE COMPONENT
// ═════════════════════════════════════════════════════════════════════════════

export default function WorkspaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const workspaceId = id!;
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('documents');

  // ─── Fetch workspace ──────────────────────────────────────────────────────
  const {
    data: workspace,
    isLoading: wsLoading,
    isError: wsError,
    error: wsErrorObj,
    refetch: refetchWorkspace,
  } = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => workspaceApi.get(workspaceId),
    enabled: !!workspaceId,
  });

  const isOwner = workspace?.owner_id === user?.id;

  if (wsLoading) {
    return (
      <motion.div
        className="space-y-6"
        variants={pageTransition}
        initial="initial"
        animate="animate"
      >
        {/* Ambient blobs */}
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          <div className="ambient-blob ambient-blob-1" />
          <div className="ambient-blob ambient-blob-2" />
          <div className="ambient-blob ambient-blob-3" />
        </div>
        <Skeleton height={32} width={200} />
        <Skeleton height={16} width="60%" />
        <div className="mt-6">
          <Skeleton height={40} width="100%" />
        </div>
      </motion.div>
    );
  }

  if (wsError || !workspace) {
    return (
      <motion.div
        className="flex flex-col items-center justify-center py-20 text-center"
        variants={pageTransition}
        initial="initial"
        animate="animate"
      >
        {/* Ambient blobs */}
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          <div className="ambient-blob ambient-blob-1" />
          <div className="ambient-blob ambient-blob-2" />
          <div className="ambient-blob ambient-blob-3" />
        </div>

        <motion.div
          className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red/15 text-red"
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', damping: 15, stiffness: 200 }}
        >
          <AlertTriangle size={28} />
        </motion.div>
        <motion.h3
          className="text-lg font-semibold text-text"
          initial={{ opacity: 0.99, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          Workspace not found
        </motion.h3>
        <motion.p
          className="mt-1 text-sm text-text-muted"
          initial={{ opacity: 0.99, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          {wsErrorObj instanceof Error
            ? wsErrorObj.message
            : 'This workspace does not exist or you do not have access.'}
        </motion.p>
        <motion.div
          className="mt-6 flex gap-3"
          initial={{ opacity: 0.99, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
        >
          <Button variant="secondary" onClick={() => navigate('/workspaces')}>
            <ArrowLeft size={18} />
            Back to workspaces
          </Button>
          <Button onClick={() => refetchWorkspace()}>Try again</Button>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="relative space-y-6"
      variants={pageTransition}
      initial="initial"
      animate="animate"
    >
      {/* Ambient blobs */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="ambient-blob ambient-blob-1" />
        <div className="ambient-blob ambient-blob-2" />
        <div className="ambient-blob ambient-blob-3" />
      </div>

      <motion.div
        className="relative z-10 space-y-6"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        <WorkspaceHeader
          workspace={workspace}
          isOwner={isOwner}
          navigate={navigate}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
        />

        {/* Tab content with AnimatePresence */}
        <div className="relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              variants={slideInRight}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              {activeTab === 'documents' && (
                <DocumentsTab workspaceId={workspaceId} />
              )}
              {activeTab === 'members' && (
                <MembersTab workspaceId={workspaceId} isOwner={isOwner} />
              )}
              {activeTab === 'settings' && (
                <SettingsTab workspace={workspace} isOwner={isOwner} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  DOCUMENTS TAB
// ═════════════════════════════════════════════════════════════════════════════

function DocumentsTab({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);

  // ─── Fetch documents ─────────────────────────────────────────────────────
  const {
    data: docList,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['documents', workspaceId],
    queryFn: () => documentApi.list(workspaceId),
    enabled: !!workspaceId,
    // Poll while any document is processing
    refetchInterval: (query) => {
      const docs = query.state.data?.data;
      if (docs?.some((d) => d.status === 'pending' || d.status === 'processing')) {
        return 3000;
      }
      return false;
    },
  });

  const documents = docList?.data ?? [];

  // ─── Upload handler ──────────────────────────────────────────────────────
  async function handleUpload(file: File) {
    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.includes(file.type) && !file.name.match(/\.(pdf|docx|txt|md|csv|xlsx)$/i)) {
      addToast('Unsupported file type. Allowed: PDF, DOCX, TXT, MD, CSV', 'error');
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadFileName(file.name);

    // Simulate progress updates (real upload doesn't have progress events with fetch)
    const progressInterval = setInterval(() => {
      setUploadProgress((prev) => Math.min(prev + 15, 90));
    }, 500);

    try {
      await documentApi.upload(workspaceId, file);
      clearInterval(progressInterval);
      setUploadProgress(100);
      addToast(`"${file.name}" uploaded successfully`, 'success');
      queryClient.invalidateQueries({ queryKey: ['documents', workspaceId] });
      // Reset after a moment
      setTimeout(() => {
        setUploading(false);
        setUploadProgress(0);
        setUploadFileName(null);
      }, 800);
    } catch (err: unknown) {
      clearInterval(progressInterval);
      setUploading(false);
      setUploadProgress(0);
      setUploadFileName(null);
      const msg =
        err instanceof Error ? err.message : 'Upload failed';
      addToast(msg, 'error');
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    handleUpload(file);
    // Reset input so the same file can be re-selected
    e.target.value = '';
  }

  // ─── Drag-and-drop handlers ─────────────────────────────────────────────
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  }

  // ─── Delete handler ──────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (docId: string) => documentApi.delete(workspaceId, docId),
    onSuccess: () => {
      addToast('Document deleted', 'success');
      queryClient.invalidateQueries({ queryKey: ['documents', workspaceId] });
      setDeleteConfirm(null);
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof Error ? err.message : 'Failed to delete document';
      addToast(msg, 'error');
    },
  });

  // ─── Loading ─────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <motion.div
        className="space-y-4"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        <div className="flex items-center justify-between">
          <Skeleton height={24} width={120} />
          <Skeleton height={36} width={140} />
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <motion.div key={i} variants={staggerItem}>
            <Skeleton height={52} width="100%" />
          </motion.div>
        ))}
      </motion.div>
    );
  }

  // ─── Error ───────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <motion.div
        className="flex flex-col items-center justify-center py-12 text-center"
        variants={fadeIn}
        initial="initial"
        animate="animate"
      >
        <motion.div
          className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red/15 text-red"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', damping: 15 }}
        >
          <AlertTriangle size={24} />
        </motion.div>
        <h3 className="text-base font-semibold text-text">Failed to load documents</h3>
        <p className="mt-1 text-sm text-text-muted">
          {error instanceof Error ? error.message : 'Something went wrong'}
        </p>
        <motion.div whileHover={{ scale: 1.05 }}>
          <Button variant="secondary" className="mt-4" onClick={() => refetch()}>
            Try again
          </Button>
        </motion.div>
      </motion.div>
    );
  }

  // ─── Empty ────────────────────────────────────────────────────────────────
  if (documents.length === 0 && !uploading) {
    return (
      <motion.div
        variants={fadeIn}
        initial="initial"
        animate="animate"
      >
        {/* Drag-and-drop upload zone */}
        <motion.div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative mb-6 cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-all duration-300 ${
            dragOver
              ? 'border-primary bg-primary/10 shadow-lg shadow-primary/20'
              : 'border-border hover:border-primary/40 hover:bg-card/50'
          }`}
          whileHover={{ scale: 1.005 }}
          animate={dragOver ? { scale: 1.01 } : { scale: 1 }}
          onClick={() => fileInputRef.current?.click()}
        >
          <motion.div
            animate={dragOver ? { y: -6, scale: 1.1 } : { y: 0, scale: 1 }}
            transition={{ type: 'spring', damping: 15 }}
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl glass text-primary"
          >
            <UploadCloud size={28} />
          </motion.div>
          <p className="text-sm font-medium text-text">
            {dragOver ? 'Drop file to upload' : 'Drop files here or click to browse'}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            PDF, DOCX, TXT, MD, CSV up to 50MB
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md,.csv,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv"
            className="hidden"
            onChange={handleFileChange}
            aria-label="Upload document"
          />
          {dragOver && (
            <motion.div
              className="pointer-events-none absolute inset-0 rounded-2xl"
              initial={{ opacity: 0.99 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{
                boxShadow: 'inset 0 0 40px rgba(124, 92, 255, 0.1), 0 0 60px rgba(124, 92, 255, 0.05)',
              }}
            />
          )}
        </motion.div>

        <EmptyState
          icon={<FileText size={28} />}
          title="No documents yet"
          description="Upload PDF, DOCX, TXT, MD, or CSV files to get started."
          action={
            <Button onClick={() => fileInputRef.current?.click()}>
              <Upload size={18} />
              Upload document
            </Button>
          }
        />
      </motion.div>
    );
  }

  return (
    <motion.div variants={fadeIn} initial="initial" animate="animate">
      {/* Drag-and-drop upload zone */}
      <motion.div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative mb-6 cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition-all duration-300 ${
          dragOver
            ? 'border-primary bg-primary/10 shadow-lg shadow-primary/20'
            : 'border-border hover:border-primary/40 hover:bg-card/50'
        }`}
        whileHover={{ scale: 1.005 }}
        animate={dragOver ? { scale: 1.01 } : { scale: 1 }}
        onClick={() => fileInputRef.current?.click()}
      >
        <motion.div
          animate={dragOver ? { y: -4, scale: 1.1 } : { y: 0, scale: 1 }}
          transition={{ type: 'spring', damping: 15 }}
          className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl glass text-primary"
        >
          <UploadCloud size={22} />
        </motion.div>
        <p className="text-sm text-text-muted">
          {dragOver ? 'Drop file to upload' : 'Drop new files or click to browse'}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.txt,.md,.csv,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv"
          className="hidden"
          onChange={handleFileChange}
          aria-label="Upload document"
        />
        {dragOver && (
          <motion.div
            className="pointer-events-none absolute inset-0 rounded-2xl"
            initial={{ opacity: 0.99 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              boxShadow: 'inset 0 0 40px rgba(124, 92, 255, 0.1), 0 0 60px rgba(124, 92, 255, 0.05)',
            }}
          />
        )}
      </motion.div>

      {/* Actions bar */}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-text-muted">
          {documents.length} document{documents.length !== 1 ? 's' : ''}
        </p>
        <Button
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          <Upload size={16} />
          Upload
        </Button>
      </div>

      {/* Hidden file input (also used for empty state upload) */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.txt,.md,.csv,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv"
        className="hidden"
        onChange={handleFileChange}
        aria-label="Upload document"
      />

      <AnimatePresence>
        <UploadProgressArea
          uploading={uploading}
          uploadFileName={uploadFileName}
          uploadProgress={uploadProgress}
        />
      </AnimatePresence>

      {/* Document list */}
      <motion.div
        className="space-y-2"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        <AnimatePresence mode="popLayout">
          {documents.map((doc) => (
            <motion.div
              key={doc.id}
              variants={staggerItem}
              layout
              exit={{ opacity: 0, x: -40, scale: 0.95, transition: { duration: 0.3 } }}
            >
              <DocumentRow
                doc={doc}
                onDelete={() => setDeleteConfirm(doc.id)}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>

      {/* Delete confirmation modal */}
      <AnimatePresence>
        {deleteConfirm && (
          <Modal
            open={!!deleteConfirm}
            onClose={() => setDeleteConfirm(null)}
            title="Delete document"
          >
            <motion.div
              initial={{ opacity: 0.99, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <div className="flex items-start gap-3 rounded-xl border border-red/20 bg-red/8 p-4">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', damping: 15, delay: 0.15 }}
                >
                  <AlertTriangle size={20} className="shrink-0 mt-0.5 text-red" />
                </motion.div>
                <div className="text-sm text-text">
                  <p className="font-medium text-red">Are you sure?</p>
                  <p className="mt-1 text-text-muted">
                    This will permanently delete this document and all associated
                    data. This action cannot be undone.
                  </p>
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <Button
                  variant="secondary"
                  onClick={() => setDeleteConfirm(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  loading={deleteMutation.isPending}
                  onClick={() => {
                    if (deleteConfirm) deleteMutation.mutate(deleteConfirm);
                  }}
                >
                  <Trash2 size={16} />
                  Delete
                </Button>
              </div>
            </motion.div>
          </Modal>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Document row ────────────────────────────────────────────────────────────
function DocumentRow({
  doc,
  onDelete,
}: {
  doc: Document;
  onDelete: () => void;
}) {
  const isProcessing =
    doc.status === 'pending' || doc.status === 'processing';

  return (
    <Card className="flex items-center gap-4 p-3 lg:p-4" hover>
      {/* Icon */}
      <motion.div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-card-2 text-text-dim"
        whileHover={{ rotate: [0, -10, 10, 0], transition: { duration: 0.4 } }}
      >
        {isProcessing ? (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
          >
            <FileText size={18} />
          </motion.div>
        ) : (
          <FileText size={18} />
        )}
      </motion.div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text">
          {doc.original_filename}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-dim">
          <span>{formatFileSize(doc.file_size)}</span>
          {doc.page_count != null && <span>{doc.page_count} pages</span>}
          <span>{formatDate(doc.created_at)}</span>
        </div>
      </div>

      {/* Status */}
      <Badge color={statusBadgeColor(doc.status)}>
        <span className="flex items-center gap-1">
          <StatusIcon status={doc.status} />
          {isProcessing ? (
            <motion.span
              animate={{ opacity: [1, 0.5, 1] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
            >
              {doc.status}
            </motion.span>
          ) : (
            doc.status
          )}
        </span>
      </Badge>

      {/* Delete */}
      <motion.button
        type="button"
        onClick={onDelete}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-red/15 hover:text-red"
        aria-label={`Delete ${doc.original_filename}`}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
      >
        <Trash2 size={16} />
      </motion.button>
    </Card>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  MEMBERS TAB
// ═════════════════════════════════════════════════════════════════════════════

function MembersTab({
  workspaceId,
  isOwner,
}: {
  workspaceId: string;
  isOwner: boolean;
}) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [newUserId, setNewUserId] = useState('');
  const [newRole, setNewRole] = useState('editor');
  const [addError, setAddError] = useState('');

  // ─── Fetch members ───────────────────────────────────────────────────────
  const {
    data: memberList,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['workspace-members', workspaceId],
    queryFn: () => workspaceApi.listMembers(workspaceId),
    enabled: !!workspaceId,
  });

  const members = memberList?.data ?? [];

  // ─── Add member mutation ─────────────────────────────────────────────────
  const addMemberMutation = useMutation({
    mutationFn: (data: { user_id: string; role?: string }) =>
      workspaceApi.addMember(workspaceId, data),
    onSuccess: () => {
      addToast('Member added', 'success');
      queryClient.invalidateQueries({
        queryKey: ['workspace-members', workspaceId],
      });
      handleAddClose();
    },
    onError: (err: unknown) => {
      setAddError(
        err instanceof Error ? err.message : 'Failed to add member',
      );
    },
  });

  // ─── Remove member mutation ──────────────────────────────────────────────
  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) =>
      workspaceApi.removeMember(workspaceId, userId),
    onSuccess: () => {
      addToast('Member removed', 'success');
      queryClient.invalidateQueries({
        queryKey: ['workspace-members', workspaceId],
      });
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof Error ? err.message : 'Failed to remove member';
      addToast(msg, 'error');
    },
  });

  function handleAddClose() {
    setAddOpen(false);
    setNewUserId('');
    setNewRole('editor');
    setAddError('');
  }

  function handleAddSubmit(e: FormEvent) {
    e.preventDefault();
    setAddError('');
    if (!newUserId.trim()) {
      setAddError('User ID is required');
      return;
    }
    addMemberMutation.mutate({
      user_id: newUserId.trim(),
      role: newRole,
    });
  }

  function roleBadgeColor(role: string) {
    switch (role) {
      case 'owner':
        return 'purple' as const;
      case 'admin':
        return 'blue' as const;
      case 'editor':
        return 'green' as const;
      case 'viewer':
        return 'gray' as const;
      default:
        return 'gray' as const;
    }
  }

  // ─── Loading ─────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        {isOwner && (
          <div className="mb-4 flex justify-end">
            <Skeleton height={36} width={140} />
          </div>
        )}
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <motion.div key={i} variants={staggerItem}>
              <Skeleton height={56} width="100%" />
            </motion.div>
          ))}
        </div>
      </motion.div>
    );
  }

  // ─── Error ───────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <motion.div
        className="flex flex-col items-center justify-center py-12 text-center"
        variants={fadeIn}
        initial="initial"
        animate="animate"
      >
        <motion.div
          className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red/15 text-red"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', damping: 15 }}
        >
          <AlertTriangle size={24} />
        </motion.div>
        <h3 className="text-base font-semibold text-text">Failed to load members</h3>
        <p className="mt-1 text-sm text-text-muted">
          {error instanceof Error ? error.message : 'Something went wrong'}
        </p>
        <motion.div whileHover={{ scale: 1.05 }}>
          <Button variant="secondary" className="mt-4" onClick={() => refetch()}>
            Try again
          </Button>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div variants={fadeIn} initial="initial" animate="animate">
      {/* Add member button */}
      {isOwner && (
        <motion.div
          className="mb-4 flex justify-end"
          initial={{ opacity: 0.99, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <UserPlus size={16} />
              Add member
            </Button>
          </motion.div>
        </motion.div>
      )}

      {/* Empty */}
      {members.length === 0 && (
        <EmptyState
          icon={<Users size={28} />}
          title="No members"
          description="This workspace has no members yet."
        />
      )}

      {/* Members list */}
      <motion.div
        className="space-y-2"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        <AnimatePresence mode="popLayout">
          {members.map((member) => {
            const isSelf = member.user_id === user?.id;
            return (
              <motion.div
                key={member.id}
                variants={staggerItem}
                layout
                exit={{ opacity: 0, x: -40, scale: 0.95, transition: { duration: 0.3 } }}
              >
                <Card className="flex items-center gap-4 p-3 lg:p-4" hover>
                  {/* Avatar */}
                  <motion.div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card-2 text-text-dim text-sm font-medium"
                    whileHover={{ scale: 1.1 }}
                    transition={{ type: 'spring', damping: 15 }}
                  >
                    <span className="gradient-text font-semibold">
                      {member.username.charAt(0).toUpperCase()}
                    </span>
                  </motion.div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text">
                      {member.username}
                      {isSelf && (
                        <span className="ml-2 text-xs text-text-dim">(you)</span>
                      )}
                    </p>
                    <p className="truncate text-xs text-text-dim">{member.email}</p>
                  </div>

                  {/* Joined date */}
                  <span className="hidden text-xs text-text-dim sm:block">
                    {formatDate(member.joined_at)}
                  </span>

                  {/* Role */}
                  <Badge color={roleBadgeColor(member.role)}>{member.role}</Badge>

                  {/* Remove (owner only, not self, not other owners) */}
                  {isOwner && !isSelf && member.role !== 'owner' && (
                    <motion.button
                      type="button"
                      onClick={() => removeMemberMutation.mutate(member.user_id)}
                      disabled={removeMemberMutation.isPending}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-red/15 hover:text-red"
                      aria-label={`Remove ${member.username}`}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <X size={16} />
                    </motion.button>
                  )}
                </Card>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </motion.div>

      {/* Add member modal */}
      <AnimatePresence>
        {addOpen && (
          <Modal open={addOpen} onClose={handleAddClose} title="Add member">
            <motion.div
              initial={{ opacity: 0.99, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <form onSubmit={handleAddSubmit} className="space-y-4">
                <AnimatePresence>
                  {addError && (
                    <motion.div
                      initial={{ opacity: 0.99, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div
                        className="rounded-lg border border-red/30 bg-red/10 px-4 py-3 text-sm text-red"
                        role="alert"
                      >
                        {addError}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <Input
                  label="User ID"
                  placeholder="Enter the user's ID"
                  value={newUserId}
                  onChange={(e) => setNewUserId(e.target.value)}
                  autoFocus
                />
                <Select
                  label="Role"
                  options={[
                    { value: 'editor', label: 'Editor' },
                    { value: 'viewer', label: 'Viewer' },
                    { value: 'admin', label: 'Admin' },
                  ]}
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                />
                <div className="flex justify-end gap-3 pt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleAddClose}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" loading={addMemberMutation.isPending}>
                    <UserPlus size={16} />
                    Add
                  </Button>
                </div>
              </form>
            </motion.div>
          </Modal>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  SETTINGS TAB
// ═════════════════════════════════════════════════════════════════════════════

function SettingsTab({
  workspace,
  isOwner,
}: {
  workspace: Workspace;
  isOwner: boolean;
}) {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description || '');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // ─── Update mutation ─────────────────────────────────────────────────────
  const updateMutation = useMutation({
    mutationFn: (data: { name?: string; description?: string }) =>
      workspaceApi.update(workspace.id, data),
    onSuccess: (updated) => {
      addToast('Workspace updated', 'success');
      queryClient.setQueryData(['workspace', workspace.id], updated);
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof Error ? err.message : 'Failed to update workspace';
      addToast(msg, 'error');
    },
  });

  // ─── Delete mutation ─────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: () => workspaceApi.delete(workspace.id),
    onSuccess: () => {
      addToast('Workspace deleted', 'success');
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      navigate('/workspaces', { replace: true });
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof Error ? err.message : 'Failed to delete workspace';
      addToast(msg, 'error');
    },
  });

  function handleUpdateSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      addToast('Workspace name is required', 'error');
      return;
    }
    updateMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
    });
  }

  if (!isOwner) {
    return (
      <motion.div variants={fadeIn} initial="initial" animate="animate">
        <Card className="p-8 text-center">
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', damping: 15 }}
          >
            <Settings size={32} className="mx-auto mb-4 text-text-dim" />
          </motion.div>
          <p className="text-sm text-text-muted">
            Only the workspace owner can access settings.
          </p>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="max-w-lg space-y-8"
      variants={fadeIn}
      initial="initial"
      animate="animate"
    >
      {/* Update form */}
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        <motion.h3
          className="text-base font-semibold text-text mb-4"
          variants={staggerItem}
        >
          General
        </motion.h3>
        <motion.form
          onSubmit={handleUpdateSubmit}
          className="space-y-4"
          variants={staggerItem}
        >
          <Input
            label="Workspace name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextArea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Button type="submit" loading={updateMutation.isPending}>
              Save changes
            </Button>
          </motion.div>
        </motion.form>
      </motion.div>

      {/* Danger zone */}
      <motion.div
        className="border-t border-border pt-6"
        variants={staggerItem}
      >
        <motion.h3
          className="text-base font-semibold text-red mb-4 flex items-center gap-2"
          initial={{ opacity: 0.99, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
        >
          <AlertTriangle size={16} />
          Danger zone
        </motion.h3>
        <p className="text-sm text-text-muted mb-4">
          Deleting this workspace will permanently remove all documents, queries,
          and data. This action cannot be undone.
        </p>
        <motion.div
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
        >
          <Button
            variant="danger"
            onClick={() => setDeleteConfirmOpen(true)}
          >
            <Trash2 size={16} />
            Delete workspace
          </Button>
        </motion.div>
      </motion.div>

      {/* Delete confirmation */}
      <AnimatePresence>
        {deleteConfirmOpen && (
          <Modal
            open={deleteConfirmOpen}
            onClose={() => setDeleteConfirmOpen(false)}
            title="Delete workspace"
          >
            <motion.div
              initial={{ opacity: 0.99, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="space-y-4"
            >
              <motion.div
                className="flex items-start gap-3 rounded-lg border border-red/30 bg-red/10 p-4"
                initial={{ x: -12, opacity: 0.99 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.15, type: 'spring', damping: 20 }}
              >
                <motion.div
                  initial={{ scale: 0, rotate: -90 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', damping: 12, delay: 0.2 }}
                >
                  <AlertTriangle size={20} className="shrink-0 mt-0.5 text-red" />
                </motion.div>
                <div className="text-sm text-text">
                  <p className="font-medium text-red">Warning</p>
                  <p className="mt-1 text-text-muted">
                    This will permanently delete{' '}
                    <strong className="text-text">{workspace.name}</strong> and all
                    associated data. This action cannot be undone.
                  </p>
                </div>
              </motion.div>
              <div className="flex justify-end gap-3 pt-2">
                <Button
                  variant="secondary"
                  onClick={() => setDeleteConfirmOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  loading={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate()}
                >
                  <Trash2 size={16} />
                  Delete permanently
                </Button>
              </div>
            </motion.div>
          </Modal>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
