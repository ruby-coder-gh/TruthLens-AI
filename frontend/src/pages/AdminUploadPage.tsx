import { useState, useCallback, type DragEvent, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, FileText, X, CheckCircle, AlertCircle, Loader2, ArrowLeft } from 'lucide-react';
import { Button, Card, Badge, ProgressBar, useToast, pageTransition } from '../components/ui';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface UploadFile {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'parsing' | 'chunking' | 'embedding' | 'indexing' | 'complete' | 'error';
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

const INGESTION_STEPS = ['Parsing', 'Chunking', 'Embedding', 'Indexing'] as const;

const STAGE_ORDER: UploadFile['status'][] = ['parsing', 'chunking', 'embedding', 'indexing', 'complete'];

// ─── Ingestion Tracker ─────────────────────────────────────────────────────────

function IngestionTracker({ status }: { status: UploadFile['status'] }) {
  const currentStepIndex = STAGE_ORDER.indexOf(status as typeof STAGE_ORDER[number]);
  const isError = status === 'error';

  return (
    <div className="flex items-center gap-2 mt-2">
      {INGESTION_STEPS.map((step, i) => {
        const stepStatus: 'active' | 'done' | 'pending' | 'error' =
          isError && i === currentStepIndex
            ? 'error'
            : currentStepIndex >= i
              ? 'done'
              : 'pending';
        if (i === currentStepIndex && !isError && status !== 'complete') {
          // Currently processing this step
          return (
            <div key={step} className="flex items-center gap-1.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-2/20">
                <Loader2 size={10} className="animate-spin text-accent-2" />
              </span>
              <span className="text-[10px] text-accent-2 font-medium">{step}</span>
              {i < INGESTION_STEPS.length - 1 && <span className="text-text-dim text-[10px]">→</span>}
            </div>
          );
        }
        return (
          <div key={step} className="flex items-center gap-1.5">
            <span className={`flex h-5 w-5 items-center justify-center rounded-full ${
              stepStatus === 'done' ? 'bg-green/15' : stepStatus === 'error' ? 'bg-red/15' : 'bg-card-2'
            }`}>
              {stepStatus === 'done' ? (
                <CheckCircle size={10} className="text-green" />
              ) : stepStatus === 'error' ? (
                <AlertCircle size={10} className="text-red" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-text-dim" />
              )}
            </span>
            <span className={`text-[10px] ${
              stepStatus === 'done' ? 'text-green' : stepStatus === 'error' ? 'text-red' : 'text-text-dim'
            }`}>
              {step}
            </span>
            {i < INGESTION_STEPS.length - 1 && <span className="text-text-dim text-[10px]">→</span>}
          </div>
        );
      })}
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
  const isUploading = item.status === 'uploading';

  return (
    <motion.div
      initial={{ opacity: 0.99, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8, height: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-start gap-3 rounded-xl glass p-4"
    >
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
        isComplete ? 'bg-green/15 text-green' : isError ? 'bg-red/15 text-red' : 'glass text-primary-soft'
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
              className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim hover:text-red hover:bg-red/10 transition-all shrink-0"
              aria-label="Remove file"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {isUploading && (
          <ProgressBar value={item.progress} size="sm" className="mt-2" />
        )}
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
  const { addToast } = useToast();
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
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
  }, [addToast]);

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

  function simulateIngestion(item: UploadFile) {
    const stages: UploadFile['status'][] = ['uploading', 'parsing', 'chunking', 'embedding', 'indexing', 'complete'];
    let idx = 0;

    setFiles((prev) =>
      prev.map((f) => (f.id === item.id ? { ...f, status: 'uploading' as const, progress: 0 } : f)),
    );

    const interval = setInterval(() => {
      idx++;
      if (idx >= stages.length) {
        clearInterval(interval);
        return;
      }
      const status = stages[idx];
      const progress = Math.min(100, Math.round((idx / (stages.length - 1)) * 100));

      setFiles((prev) =>
        prev.map((f) =>
          f.id === item.id ? { ...f, status, progress: status === 'uploading' ? Math.min(90, f.progress + 25) : progress } : f,
        ),
      );
    }, 800);
  }

  function handleUpload() {
    const pending = files.filter((f) => f.status === 'pending');
    if (pending.length === 0) {
      addToast('No files to upload', 'info');
      return;
    }

    setUploading(true);
    pending.forEach((item) => simulateIngestion(item));

    setTimeout(() => {
      setUploading(false);
      addToast('Upload complete!', 'success');
    }, pending.length * 4000 + 1000);
  }

  const allComplete = files.length > 0 && files.every((f) => f.status === 'complete' || f.status === 'error');
  const hasPending = files.some((f) => f.status === 'pending');

  return (
    <motion.div
      className="space-y-5"
      variants={pageTransition}
      initial="initial"
      animate="animate"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/admin/documents')}
          className="flex h-8 w-8 items-center justify-center rounded-lg glass text-text-muted hover:text-text transition-all"
          aria-label="Back to documents"
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-text">Upload Documents</h1>
          <p className="text-sm text-text-muted mt-1">Upload PDF, DOCX, XLSX, TXT, or MD files.</p>
        </div>
      </div>

      {/* Drop Zone */}
      <motion.div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`relative rounded-2xl border-2 border-dashed p-8 lg:p-12 text-center transition-all ${
          dragOver
            ? 'border-primary/50 bg-primary/5'
            : 'border-border hover:border-primary/30'
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
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl glass text-primary-soft">
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
                loading={uploading}
                disabled={!hasPending}
                size="md"
              >
                <Upload size={14} />
                {uploading ? 'Uploading...' : `Upload ${files.filter((f) => f.status === 'pending').length} file${files.filter((f) => f.status === 'pending').length > 1 ? 's' : ''}`}
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
    </motion.div>
  );
}
