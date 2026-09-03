import { useState, useEffect, useCallback, type DragEvent, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, FileText, X, CheckCircle, AlertCircle, Loader2, ArrowLeft } from 'lucide-react';
import { Button, Select } from '../components/ui';
import { pageTransition } from '../components/motion';
import { useToast } from '../components/toast-context';
import { PageHeader, PageShell, StateBlock } from '../components/PageWrappers';
import { documentApi, workspaceApi } from '../api/client';
import type { Workspace } from '../api/types';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface UploadFile {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'complete' | 'error';
  error?: string;
}

const ALLOWED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/markdown',
];

const ACCEPT_STRING = '.pdf,.docx,.xlsx,.txt,.md';

// ─── Ingestion Tracker ─────────────────────────────────────────────────────────

function IngestionTracker({ status }: { status: UploadFile['status'] }) {
  if (status === 'pending') return null;

  return (
    <div className="flex items-center gap-2 mt-2">
      {status === 'uploading' && (
        <>
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15">
            <Loader2 size={10} className="animate-spin text-primary-soft" />
          </span>
          <span className="text-[10px] text-primary-soft font-medium">Uploading...</span>
        </>
      )}
      {status === 'complete' && (
        <>
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green/12">
            <CheckCircle size={10} className="text-green" />
          </span>
          <span className="text-[10px] text-green font-medium">Complete</span>
        </>
      )}
      {status === 'error' && (
        <>
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red/15">
            <AlertCircle size={10} className="text-red" />
          </span>
          <span className="text-[10px] text-red font-medium">Error</span>
        </>
      )}
    </div>
  );
}

// ─── File Row ──────────────────────────────────────────────────────────────────

function FileRow({
  item,
  onRemove,
}: {
  item: UploadFile;
  onRemove: (id: string) => void;
}) {
  const isComplete = item.status === 'complete';
  const isError = item.status === 'error';

  return (
    <motion.div
      initial={{ opacity: 0.99, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8, height: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-start gap-3 rounded-card glass p-4 shadow-e1"
    >
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-control border ${
        isComplete
          ? 'border-green/30 bg-green/12 text-green'
          : isError
            ? 'border-red/30 bg-red/10 text-red'
            : 'border-primary/25 bg-primary/10 text-primary-soft'
      }`}>
        {isComplete ? <CheckCircle size={18} /> : isError ? <AlertCircle size={18} /> : <FileText size={18} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-text truncate">{item.file.name}</p>
            <p className="text-xs text-text-dim">{(item.file.size / 1024).toFixed(1)} KB</p>
          </div>
          {!isComplete && (
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              className="flex h-7 w-7 items-center justify-center rounded-chip text-text-dim transition-colors hover:bg-red/10 hover:text-red shrink-0"
              aria-label="Remove file"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <IngestionTracker status={item.status} />
        {item.error && (
          <p className="mt-1 text-xs text-red flex items-center gap-1">
            <AlertCircle size={10} />
            {item.error}
          </p>
        )}
      </div>
    </motion.div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function AdminUploadPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [dragOver, setDragOver] = useState(false);

  // Uploads are workspace-scoped, so a real workspace id is required before
  // anything can upload — previously this hardcoded the literal string
  // 'default', which the backend rejected as an invalid UUID (same bug class
  // as AdminCollectionsPage). Resolve the caller's real workspaces first, then
  // let them switch between workspaces if they belong to more than one.
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(true);
  const [workspacesError, setWorkspacesError] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');

  const loadWorkspaces = useCallback(async () => {
    setWorkspacesLoading(true);
    setWorkspacesError('');
    try {
      const result = await workspaceApi.list();
      const list = result.data || [];
      setWorkspaces(list);
      setWorkspaceId((prev) => prev || list[0]?.id || '');
    } catch (err) {
      setWorkspaces([]);
      setWorkspacesError(err instanceof Error ? err.message : 'Failed to load workspaces.');
    } finally {
      setWorkspacesLoading(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const uploadMutation = useMutation({
    mutationFn: ({ workspaceId, file }: { workspaceId: string; file: File }) =>
      documentApi.upload(workspaceId, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'documents'] });
    },
  });

  function addFiles(newFiles: FileList | File[]) {
    const valid: UploadFile[] = [];
    for (const f of Array.from(newFiles)) {
      if (!ALLOWED_TYPES.includes(f.type) && !f.name.match(/\.(pdf|docx|xlsx|txt|md)$/i)) {
        addToast(`Unsupported file type: ${f.name}`, 'error');
        continue;
      }
      valid.push({
        id: crypto.randomUUID(),
        file: f,
        progress: 0,
        status: 'pending',
      });
    }
    setFiles((prev) => [...prev, ...valid]);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  function handleFileSelect(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files);
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  async function handleUpload() {
    if (!workspaceId) {
      addToast('Select a workspace before uploading', 'error');
      return;
    }
    const pending = files.filter((f) => f.status === 'pending');
    if (pending.length === 0) {
      addToast('No files to upload', 'info');
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    for (const item of pending) {
      setFiles((prev) =>
        prev.map((f) =>
          f.id === item.id ? { ...f, status: 'uploading' as const, progress: 50 } : f,
        ),
      );

      try {
        await uploadMutation.mutateAsync({ workspaceId, file: item.file });
        setFiles((prev) =>
          prev.map((f) =>
            f.id === item.id ? { ...f, status: 'complete' as const, progress: 100 } : f,
          ),
        );
        successCount++;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        setFiles((prev) =>
          prev.map((f) =>
            f.id === item.id ? { ...f, status: 'error' as const, error: message } : f,
          ),
        );
        errorCount++;
      }
    }

    if (errorCount === 0) {
      addToast(`Uploaded ${successCount} file${successCount > 1 ? 's' : ''} successfully!`, 'success');
    } else {
      addToast(`${successCount} uploaded, ${errorCount} failed`, 'error');
    }
  }

  const allComplete = files.length > 0 && files.every((f) => f.status === 'complete' || f.status === 'error');
  const hasPending = files.some((f) => f.status === 'pending');
  const isUploading = files.some((f) => f.status === 'uploading');

  return (
    <motion.div variants={pageTransition} initial="initial" animate="animate">
      <PageShell>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/admin/documents')}
          className="flex h-8 w-8 items-center justify-center rounded-control border border-border bg-card-hover text-text-muted transition-colors hover:bg-card-2 hover:text-text"
          aria-label="Back to documents"
        >
          <ArrowLeft size={16} />
        </button>
        <PageHeader
          title="Upload Documents"
          description="Upload PDF, DOCX, XLSX, TXT, or MD files."
        />
      </div>

      {/* Workspace Selector — uploads are workspace-scoped, so a real workspace
          must be resolved/selected before anything can upload. */}
      {workspacesLoading ? (
        <StateBlock role="status">Loading workspaces…</StateBlock>
      ) : workspacesError ? (
        <StateBlock tone="danger" role="alert" className="space-y-3">
          <p>{workspacesError}</p>
          <Button variant="secondary" size="sm" onClick={() => void loadWorkspaces()}>
            Retry
          </Button>
        </StateBlock>
      ) : workspaces.length === 0 ? (
        <StateBlock role="alert">
          No workspaces available. Create a workspace first to upload documents.
        </StateBlock>
      ) : workspaces.length > 1 ? (
        <div className="max-w-xs">
          <Select
            label="Workspace"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            disabled={isUploading}
            options={workspaces.map((ws) => ({ value: ws.id, label: ws.name }))}
          />
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-text whitespace-nowrap">Workspace</span>
          <span className="rounded-control border border-border bg-solid px-3 py-2 text-sm text-text-muted">
            {workspaces[0].name}
          </span>
        </div>
      )}

      {/* Drop Zone */}
      <motion.div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`relative rounded-panel border-2 border-dashed p-8 lg:p-12 text-center transition-colors ${
          dragOver
            ? 'border-primary bg-primary/10'
            : 'border-border bg-card-2 hover:border-primary/40'
        }`}
      >
        <input
          type="file"
          id="file-upload"
          multiple
          accept={ACCEPT_STRING}
          onChange={handleFileSelect}
          className="hidden"
        />
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-card border border-primary/25 bg-primary/10 text-primary-soft">
            <Upload size={28} />
          </div>
          <div>
            <p className="text-base font-medium text-text">
              {dragOver ? 'Drop files here' : 'Drag & drop files here'}
            </p>
            <p className="text-sm text-text-muted mt-1">or</p>
          </div>
          <label htmlFor="file-upload" className="cursor-pointer">
            <Button variant="secondary" size="sm">
              Browse Files
            </Button>
          </label>
          <p className="text-xs text-text-dim">PDF, DOCX, XLSX, TXT, MD — max 50MB</p>
        </div>
      </motion.div>

      {/* File List */}
      <AnimatePresence>
        {files.length > 0 && (
          <motion.div
            initial={{ opacity: 0.99, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-2"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text">{files.length} file{files.length > 1 ? 's' : ''}</h2>
            </div>
            {files.map((item) => (
              <FileRow key={item.id} item={item} onRemove={removeFile} />
            ))}

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <Button
                onClick={handleUpload}
                loading={isUploading}
                disabled={!hasPending || !workspaceId}
                size="md"
              >
                <Upload size={14} />
                {isUploading ? 'Uploading...' : `Upload ${files.filter((f) => f.status === 'pending').length} file${files.filter((f) => f.status === 'pending').length > 1 ? 's' : ''}`}
              </Button>
              {allComplete && (
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => navigate('/admin/documents')}
                >
                  View Documents
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </PageShell>
    </motion.div>
  );
}
