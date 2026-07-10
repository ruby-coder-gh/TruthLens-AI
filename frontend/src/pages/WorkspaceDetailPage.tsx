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
  Settings as SettingsIcon,
  UserPlus,
  X,
  AlertTriangle,
  UploadCloud,
  CheckCircle2,
  Clock,
  FileWarning,
  Brain,
  HardDrive,
  MoreHorizontal,
  Calendar,
  Shield,
  Copy,
  Check,
  MessageSquare,
  Loader2,
} from 'lucide-react';
import {
  Button,
  Input,
  TextArea,
  Select,
  Card,
  Badge,
  Modal,
  EmptyState,
  Tabs,
  Skeleton,
  ProgressBar,
  useToast,
  staggerContainer,
  staggerItem,
  fadeIn,
  pageTransition,
  slideInRight,
} from '../components/ui';
import { PageShell } from '../components/PageWrappers';
import {
  workspaceApi,
  documentApi,
} from '../api/client';
import { useAuth } from '../context/AuthContext';
import type {
  ActivityEntry,
  Workspace,
  Document,
  WorkspaceMember,
} from '../api/types';

// ─── Tab definitions ─────────────────────────────────────────────────────────
const TABS = [
  { id: 'documents', label: 'Documents', icon: <FileText size={15} /> },
  { id: 'activity', label: 'Activity', icon: <Clock size={15} /> },
  { id: 'members', label: 'Members', icon: <Users size={15} /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon size={15} /> },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatJoinDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
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
      className="glass rounded-xl p-4 mb-5 border border-glass-border"
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
        label={uploadProgress < 100 ? 'Uploading…' : 'Processing…'}
      />
    </motion.div>
  );
}

// ─── Workspace Avatar Fallback ───────────────────────────────────────────────
function WorkspaceAvatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'h-9 w-9 text-sm', md: 'h-12 w-12 text-lg', lg: 'h-16 w-16 text-2xl' };
  const gradientPairs = [
    'from-primary to-accent',
    'from-accent to-accent-2',
    'from-primary to-gold',
    'from-accent-2 to-primary',
  ];
  const idx = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % gradientPairs.length;
  return (
    <div className={`${sizes[size]} rounded-xl bg-gradient-to-br ${gradientPairs[idx]} flex items-center justify-center font-bold text-white shadow-lg shrink-0`}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  DASHBOARD STATS CARDS
// ═════════════════════════════════════════════════════════════════════════════

function DashboardStats({ workspace }: { workspace: Workspace }) {
  const stats = [
    {
      label: 'Documents',
      value: workspace.document_count ?? 0,
      icon: <FileText size={18} />,
      gradient: 'from-primary/20 to-primary/5',
      border: 'border-primary/20',
      textColor: 'text-primary-soft',
    },
    {
      label: 'Members',
      value: workspace.member_count ?? 1,
      icon: <Users size={18} />,
      gradient: 'from-accent/20 to-accent/5',
      border: 'border-accent/20',
      textColor: 'text-accent',
    },
    {
      label: 'AI Queries',
      value: '—',
      icon: <Brain size={18} />,
      gradient: 'from-gold/20 to-gold/5',
      border: 'border-gold/20',
      textColor: 'text-gold',
    },
    {
      label: 'Storage Used',
      value: '—',
      icon: <HardDrive size={18} />,
      gradient: 'from-accent-2/20 to-accent-2/5',
      border: 'border-accent-2/20',
      textColor: 'text-accent-2',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((stat, i) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0.99, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 + i * 0.05, duration: 0.35, ease: [0.16, 1, 0.3, 1] as const }}
          className={`relative overflow-hidden rounded-xl border ${stat.border} bg-gradient-to-br ${stat.gradient} p-4 backdrop-blur-sm`}
        >
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-xs font-medium text-text-dim tracking-wide">{stat.label}</p>
              <p className={`text-2xl font-bold ${stat.textColor}`}>
                {typeof stat.value === 'number' ? stat.value.toLocaleString() : stat.value}
              </p>
            </div>
            <div className={`p-2 rounded-lg bg-white/5 ${stat.textColor}`}>
              {stat.icon}
            </div>
          </div>
          {/* Subtle shimmer line */}
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        </motion.div>
      ))}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  WORKSPACE HEADER (Redesigned)
// ═════════════════════════════════════════════════════════════════════════════

function WorkspaceHeader({
  workspace,
  isOwner,
  navigate,
  activeTab,
  setActiveTab,
  memberCount,
}: {
  workspace: Workspace;
  isOwner: boolean;
  navigate: ReturnType<typeof useNavigate>;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  memberCount: number;
}) {
  return (
    <motion.div variants={staggerItem} className="space-y-5">
      {/* Back + breadcrumb */}
      <motion.button
        type="button"
        onClick={() => navigate('/workspaces')}
        className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text transition-colors group w-fit"
        whileHover={{ x: -3 }}
        transition={{ duration: 0.2 }}
      >
        <ArrowLeft size={14} className="transition-transform group-hover:-translate-x-0.5" />
        Workspaces
        <span className="text-text-dim mx-1">/</span>
        <span className="text-text font-medium">{workspace.name}</span>
      </motion.button>

      {/* Header content */}
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4 min-w-0">
          <WorkspaceAvatar name={workspace.name} size="lg" />
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-center gap-3 flex-wrap">
              <motion.h1
                className="text-2xl font-bold text-text tracking-tight"
                initial={{ opacity: 0.99, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] as const }}
              >
                {workspace.name}
              </motion.h1>
              {isOwner && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', damping: 15, stiffness: 200, delay: 0.3 }}
                >
                  <Badge color="purple" className="text-[10px] px-2 py-0.5">
                    <Shield size={10} className="mr-1" />
                    Owner
                  </Badge>
                </motion.div>
              )}
            </div>
            <motion.p
              className="text-sm text-text-muted leading-relaxed max-w-xl"
              initial={{ opacity: 0.99 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
            >
              {workspace.description || 'No description set'}
            </motion.p>
            <motion.div
              className="flex items-center gap-3 text-xs text-text-dim pt-0.5"
              initial={{ opacity: 0.99 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              <span className="flex items-center gap-1.5">
                <Users size={12} />
                {memberCount} {memberCount === 1 ? 'member' : 'members'}
              </span>
              <span className="flex items-center gap-1.5">
                <FileText size={12} />
                {workspace.document_count ?? 0} documents
              </span>
              <span className="flex items-center gap-1.5">
                <Calendar size={12} />
                Created {formatJoinDate(workspace.created_at)}
              </span>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Dashboard Stats */}
      <DashboardStats workspace={workspace} />

      {/* Tabs — Segmented control style */}
      <motion.div
        variants={staggerItem}
        className="sticky top-0 z-20 -mx-1 px-1 pt-2 pb-1"
      >
        <Tabs
          tabs={TABS}
          activeTab={activeTab}
          onChange={setActiveTab}
          className="w-fit border border-border/40 bg-white/[0.03]"
        />
      </motion.div>
    </motion.div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  MAIN PAGE
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

  // ─── Fetch members (for count) ────────────────────────────────────────────
  const { data: memberList } = useQuery({
    queryKey: ['workspace-members', workspaceId],
    queryFn: () => workspaceApi.listMembers(workspaceId),
    enabled: !!workspaceId,
  });

  const members = memberList?.data ?? [];
  const isOwner = workspace?.owner_id === user?.id;

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (wsLoading) {
    return (
      <div className="-mx-4 lg:-mx-6 px-4 lg:px-8 xl:px-12">
        <div className="mx-auto w-full max-w-[1400px] py-6">
        <PageShell>
        <motion.div
          className="space-y-6"
          variants={pageTransition}
          initial="initial"
          animate="animate"
        >
          <Skeleton height={16} width={120} />
          <div className="flex items-start gap-4">
            <Skeleton height={64} width={64} className="rounded-xl" />
            <div className="space-y-2 flex-1">
              <Skeleton height={28} width={280} />
              <Skeleton height={14} width="60%" />
              <Skeleton height={12} width={200} />
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={88} width="100%" className="rounded-xl" />
            ))}
          </div>
          <Skeleton height={40} width={300} className="rounded-lg" />
        </motion.div>
        </PageShell>
        </div>
      </div>
    );
  }

  // ─── Error ────────────────────────────────────────────────────────────────
  if (wsError || !workspace) {
    return (
      <div className="-mx-4 lg:-mx-6 px-4 lg:px-8 xl:px-12">
        <div className="mx-auto w-full max-w-[1400px] py-6">
        <PageShell>
        <motion.div
          className="flex flex-col items-center justify-center py-24 text-center"
          variants={pageTransition}
          initial="initial"
          animate="animate"
        >
          <motion.div
            className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-red/15 text-red"
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', damping: 15, stiffness: 200 }}
          >
            <AlertTriangle size={28} />
          </motion.div>
          <motion.h2
            className="text-xl font-bold text-text"
            initial={{ opacity: 0.99, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            Workspace not found
          </motion.h2>
          <motion.p
            className="mt-1.5 text-sm text-text-muted max-w-sm"
            initial={{ opacity: 0.99, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            {wsErrorObj instanceof Error
              ? wsErrorObj.message
              : 'This workspace does not exist or you do not have access.'}
          </motion.p>
          <motion.div
            className="mt-8 flex gap-3"
            initial={{ opacity: 0.99, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
          >
            <Button variant="secondary" onClick={() => navigate('/workspaces')}>
              <ArrowLeft size={16} />
              Back to workspaces
            </Button>
            <Button onClick={() => refetchWorkspace()}>Try again</Button>
          </motion.div>
        </motion.div>
        </PageShell>
        </div>
      </div>
    );
  }

  // ─── Success ──────────────────────────────────────────────────────────────
  return (
    <div className="-mx-4 lg:-mx-6 px-4 lg:px-8 xl:px-12">
      <div className="mx-auto w-full max-w-[1400px] py-6">
      <PageShell>
      <motion.div
        className="relative"
        variants={pageTransition}
        initial="initial"
        animate="animate"
      >
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
            memberCount={members.length}
          />

          {/* Tab content */}
          <div className="relative min-h-[400px]">
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
                {activeTab === 'activity' && (
                  <ActivityTab workspaceId={workspaceId} />
                )}
                {activeTab === 'members' && (
                  <MembersTab workspaceId={workspaceId} isOwner={isOwner} members={members} />
                )}
                {activeTab === 'settings' && (
                  <SettingsTab workspace={workspace} isOwner={isOwner} />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.div>
      </PageShell>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  ACTIVITY TAB
// ═════════════════════════════════════════════════════════════════════════════

function ActivityTab({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['workspace-activity', workspaceId],
    queryFn: () => workspaceApi.activity(workspaceId),
    enabled: !!workspaceId,
  });

  const activities = data?.data ?? [];

  const iconMap: Record<string, React.ReactNode> = {
    query: <MessageSquare size={16} className="text-accent-2" />,
    document_upload: <UploadCloud size={16} className="text-primary-soft" />,
    workspace_created: <CheckCircle2 size={16} className="text-green" />,
  };

  function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-primary" />
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl glass text-text-dim">
          <Clock size={28} />
        </div>
        <h3 className="text-lg font-semibold text-text">No activity yet</h3>
        <p className="mt-1 text-sm text-text-muted">Upload documents or ask questions to see activity here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {activities.map((entry: ActivityEntry) => (
        <div
          key={entry.id}
          className="flex items-start gap-4 rounded-xl px-4 py-3 transition-colors hover:bg-white/[0.03]"
        >
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5">
            {iconMap[entry.type] || <Clock size={16} className="text-text-dim" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-text truncate">{entry.description}</p>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-text-dim">
              {entry.user_name && <span>{entry.user_name}</span>}
              <span>{timeAgo(entry.timestamp)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  DOCUMENTS TAB (Redesigned)
// ═════════════════════════════════════════════════════════════════════════════

function DocumentsTab({ workspaceId }: { workspaceId: string }) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);

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
    refetchInterval: (query) => {
      const docs = query.state.data?.data;
      if (docs?.some((d) => d.status === 'pending' || d.status === 'processing')) {
        return 3000;
      }
      return false;
    },
  });

  const documents = docList?.data ?? [];

  async function handleUpload(file: File) {
    if (!ALLOWED_MIME_TYPES.includes(file.type) && !file.name.match(/\.(pdf|docx|txt|md|csv|xlsx)$/i)) {
      addToast('Unsupported file type. Allowed: PDF, DOCX, TXT, MD, CSV', 'error');
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    setUploadFileName(file.name);
    const progressInterval = setInterval(() => {
      setUploadProgress((prev) => Math.min(prev + 15, 90));
    }, 500);
    try {
      await documentApi.upload(workspaceId, file);
      clearInterval(progressInterval);
      setUploadProgress(100);
      addToast(`"${file.name}" uploaded successfully`, 'success');
      queryClient.invalidateQueries({ queryKey: ['documents', workspaceId] });
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
      const msg = err instanceof Error ? err.message : 'Upload failed';
      addToast(msg, 'error');
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    handleUpload(file);
    e.target.value = '';
  }

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

  const deleteMutation = useMutation({
    mutationFn: (docId: string) => documentApi.delete(workspaceId, docId),
    onSuccess: () => {
      addToast('Document deleted', 'success');
      queryClient.invalidateQueries({ queryKey: ['documents', workspaceId] });
      setDeleteConfirm(null);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to delete document';
      addToast(msg, 'error');
    },
  });

  // Loading
  if (isLoading) {
    return (
      <motion.div
        className="space-y-3"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        <div className="flex items-center justify-between">
          <Skeleton height={20} width={120} />
          <Skeleton height={36} width={130} className="rounded-lg" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <motion.div key={i} variants={staggerItem}>
            <Skeleton height={64} width="100%" className="rounded-xl" />
          </motion.div>
        ))}
      </motion.div>
    );
  }

  // Error
  if (isError) {
    return (
      <motion.div
        className="flex flex-col items-center justify-center py-16 text-center"
        variants={fadeIn}
        initial="initial"
        animate="animate"
      >
        <motion.div
          className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red/15 text-red"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', damping: 15 }}
        >
          <AlertTriangle size={24} />
        </motion.div>
        <h3 className="text-base font-semibold text-text">Failed to load documents</h3>
        <p className="mt-1 text-sm text-text-muted max-w-sm">
          {error instanceof Error ? error.message : 'Something went wrong loading your documents.'}
        </p>
        <Button variant="secondary" className="mt-5" onClick={() => refetch()}>
          Try again
        </Button>
      </motion.div>
    );
  }

  // Empty
  if (documents.length === 0 && !uploading) {
    return (
      <motion.div variants={fadeIn} initial="initial" animate="animate">
        {/* Drop zone */}
        <motion.div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative mb-6 cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-all duration-300 ${
            dragOver
              ? 'border-primary bg-primary/10 shadow-lg shadow-primary/20'
              : 'border-border/60 hover:border-primary/40 hover:bg-white/[0.02]'
          }`}
          whileHover={{ scale: 1.003 }}
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
            accept=".pdf,.docx,.txt,.md,.csv,.xlsx"
            className="hidden"
            onChange={handleFileChange}
            aria-label="Upload document"
          />
        </motion.div>

        <EmptyState
          icon={<FileText size={28} />}
          title="No documents yet"
          description="Upload PDF, DOCX, TXT, MD, or CSV files to start querying your data."
          action={
            <Button onClick={() => fileInputRef.current?.click()}>
              <Upload size={16} />
              Upload document
            </Button>
          }
        />
      </motion.div>
    );
  }

  // Documents list
  return (
    <motion.div variants={fadeIn} initial="initial" animate="animate">
      {/* Drop zone compact */}
      <motion.div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative mb-5 cursor-pointer rounded-xl border-2 border-dashed p-5 text-center transition-all duration-300 ${
          dragOver
            ? 'border-primary bg-primary/10 shadow-lg shadow-primary/20'
            : 'border-border/40 hover:border-primary/30 hover:bg-white/[0.01]'
        }`}
        whileHover={{ scale: 1.003 }}
        animate={dragOver ? { scale: 1.01 } : { scale: 1 }}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="flex items-center justify-center gap-3">
          <motion.div
            animate={dragOver ? { y: -3, scale: 1.1 } : { y: 0, scale: 1 }}
            transition={{ type: 'spring', damping: 15 }}
          >
            <UploadCloud size={20} className="text-primary" />
          </motion.div>
          <p className="text-sm text-text-muted">
            {dragOver ? 'Drop file to upload' : 'Drop files or click to add more documents'}
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.txt,.md,.csv,.xlsx"
          className="hidden"
          onChange={handleFileChange}
          aria-label="Upload document"
        />
      </motion.div>

      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-text-muted">
          <span className="text-text font-medium">{documents.length}</span>{' '}
          {documents.length === 1 ? 'document' : 'documents'}
        </p>
        <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          <Upload size={14} />
          Upload
        </Button>
      </div>

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
              <DocumentRow doc={doc} onDelete={() => setDeleteConfirm(doc.id)} />
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>

      {/* Delete confirmation */}
      <AnimatePresence>
        {deleteConfirm && (
          <Modal open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete document">
            <motion.div
              initial={{ opacity: 0.99, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <div className="flex items-start gap-3 rounded-xl border border-red/20 bg-red/8 p-4">
                <AlertTriangle size={20} className="shrink-0 mt-0.5 text-red" />
                <div className="text-sm text-text">
                  <p className="font-medium text-red">Are you sure?</p>
                  <p className="mt-1 text-text-muted">
                    This will permanently delete this document and all associated
                    data. This action cannot be undone.
                  </p>
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>
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

// ─── Document Row (Redesigned) ───────────────────────────────────────────────
function DocumentRow({ doc, onDelete }: { doc: Document; onDelete: () => void }) {
  const isProcessing = doc.status === 'pending' || doc.status === 'processing';

  return (
    <motion.div
      className="group flex items-center gap-4 rounded-xl border border-border/40 bg-white/[0.02] p-3 lg:p-4 transition-all duration-200 hover:bg-white/[0.04] hover:border-border/70 hover:shadow-lg hover:shadow-black/5"
      whileHover={{ y: -1 }}
      transition={{ duration: 0.2 }}
    >
      {/* Icon */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/10 to-accent/10 text-text-dim">
        {isProcessing ? (
          <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}>
            <FileText size={18} />
          </motion.div>
        ) : (
          <FileText size={18} />
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text">
          {doc.original_filename}
        </p>
        <div className="flex flex-wrap items-center gap-2.5 text-xs text-text-dim mt-0.5">
          <span>{formatFileSize(doc.file_size)}</span>
          {doc.page_count != null && (
            <>
              <span className="w-1 h-1 rounded-full bg-text-dim/30" />
              <span>{doc.page_count} pages</span>
            </>
          )}
          <span className="w-1 h-1 rounded-full bg-text-dim/30" />
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
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-dim opacity-0 group-hover:opacity-100 transition-all hover:bg-red/15 hover:text-red"
        aria-label={`Delete ${doc.original_filename}`}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
      >
        <Trash2 size={15} />
      </motion.button>
    </motion.div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  MEMBERS TAB (Redesigned — Professional Cards)
// ═════════════════════════════════════════════════════════════════════════════

function MembersTab({
  workspaceId,
  isOwner,
  members,
}: {
  workspaceId: string;
  isOwner: boolean;
  members: WorkspaceMember[];
}) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [newUserId, setNewUserId] = useState('');
  const [newRole, setNewRole] = useState('editor');
  const [addError, setAddError] = useState('');
  const [actionMenuOpen, setActionMenuOpen] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Close action menu on outside click
  const menuRef = useRef<HTMLDivElement>(null);

  const addMemberMutation = useMutation({
    mutationFn: (data: { user_id: string; role?: string }) =>
      workspaceApi.addMember(workspaceId, data),
    onSuccess: () => {
      addToast('Member added', 'success');
      queryClient.invalidateQueries({ queryKey: ['workspace-members', workspaceId] });
      handleAddClose();
    },
    onError: (err: unknown) => {
      setAddError(err instanceof Error ? err.message : 'Failed to add member');
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => workspaceApi.removeMember(workspaceId, userId),
    onSuccess: () => {
      addToast('Member removed', 'success');
      queryClient.invalidateQueries({ queryKey: ['workspace-members', workspaceId] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to remove member';
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
    addMemberMutation.mutate({ user_id: newUserId.trim(), role: newRole });
  }

  function handleCopyUserId(userId: string) {
    navigator.clipboard.writeText(userId).catch(() => {});
    setCopiedId(userId);
    setTimeout(() => setCopiedId(null), 2000);
  }

  const memberGradient = (username: string) => {
    const pairs = [
      'from-primary to-accent',
      'from-accent to-accent-2',
      'from-primary to-gold',
      'from-gold to-accent-2',
      'from-accent-2 to-primary',
    ];
    const idx = username.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % pairs.length;
    return pairs[idx];
  };

  // Loading skeleton
  if (members.length === 0 && !addOpen) {
    return (
      <motion.div variants={fadeIn} initial="initial" animate="animate">
        {/* Header with invite button */}
        <div className="mb-5 flex items-center justify-between">
          <p className="text-sm text-text-muted">
            <span className="text-text font-medium">0</span> members
          </p>
          {isOwner && (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <UserPlus size={14} />
              Invite Member
            </Button>
          )}
        </div>

        <EmptyState
          icon={<Users size={28} />}
          title="No members yet"
          description="Invite team members to collaborate on this workspace."
          action={
            isOwner ? (
              <Button onClick={() => setAddOpen(true)}>
                <UserPlus size={16} />
                Invite Member
              </Button>
            ) : undefined
          }
        />

        {/* Add member modal */}
        <AddMemberModal
          addOpen={addOpen}
          addError={addError}
          newUserId={newUserId}
          setNewUserId={setNewUserId}
          newRole={newRole}
          setNewRole={setNewRole}
          addMemberMutation={addMemberMutation}
          handleAddSubmit={handleAddSubmit}
          handleAddClose={handleAddClose}
        />
      </motion.div>
    );
  }

  return (
    <motion.div variants={fadeIn} initial="initial" animate="animate">
      {/* Section header */}
      <div className="mb-5 flex items-center justify-between">
        <p className="text-sm text-text-muted">
          <span className="text-text font-medium">{members.length}</span>{' '}
          {members.length === 1 ? 'member' : 'members'}
        </p>
        {isOwner && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <UserPlus size={14} />
            Invite Member
          </Button>
        )}
      </div>

      {/* Members grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <AnimatePresence mode="popLayout">
          {members.map((member) => {
            const isSelf = member.user_id === user?.id;
            const canRemove = isOwner && !isSelf && member.role !== 'owner';
            const isMenuOpen = actionMenuOpen === member.id;

            return (
              <motion.div
                key={member.id}
                layout
                initial={{ opacity: 0.99, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] as const }}
              >
                <div className="group relative overflow-hidden rounded-xl border border-border/40 bg-gradient-to-br from-white/[0.03] to-transparent p-4 transition-all duration-200 hover:border-border/70 hover:shadow-lg hover:shadow-black/5">
                  {/* Subtle gradient accent line */}
                  <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />

                  <div className="flex items-start gap-3.5">
                    {/* Avatar */}
                    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${memberGradient(member.username)} text-white text-sm font-bold shadow-md`}>
                      {member.username.charAt(0).toUpperCase()}
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="truncate text-sm font-semibold text-text">
                          {member.username}
                          {isSelf && (
                            <span className="ml-1.5 text-[10px] font-normal text-text-dim">(you)</span>
                          )}
                        </p>
                        <Badge color={roleBadgeColor(member.role as string)} className="text-[9px] px-1.5 py-0.5 uppercase tracking-wider">
                          {member.role}
                        </Badge>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-text-muted">{member.email}</p>
                      <p className="mt-1.5 text-[10px] text-text-dim flex items-center gap-1">
                        <Calendar size={10} />
                        Joined {formatJoinDate(member.joined_at)}
                      </p>
                    </div>

                    {/* Actions */}
                    {canRemove && (
                      <div className="relative shrink-0">
                        <motion.button
                          type="button"
                          onClick={() => setActionMenuOpen(isMenuOpen ? null : member.id)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim opacity-0 group-hover:opacity-100 transition-all hover:bg-white/10 hover:text-text"
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          aria-label="Member actions"
                        >
                          <MoreHorizontal size={15} />
                        </motion.button>

                        <AnimatePresence>
                          {isMenuOpen && (
                            <>
                              <motion.div
                                className="fixed inset-0 z-30"
                                onClick={() => setActionMenuOpen(null)}
                              />
                              <motion.div
                                ref={menuRef}
                                initial={{ opacity: 0.99, scale: 0.95, y: -4 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                                transition={{ duration: 0.15 }}
                                className="absolute right-0 top-10 z-40 min-w-[160px] overflow-hidden rounded-xl border border-border/50 bg-card shadow-2xl shadow-black/30 backdrop-blur-xl"
                              >
                                <div className="py-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      handleCopyUserId(member.user_id);
                                      setActionMenuOpen(null);
                                    }}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text-muted hover:bg-white/5 hover:text-text transition-colors"
                                  >
                                    {copiedId === member.user_id ? (
                                      <Check size={13} className="text-green" />
                                    ) : (
                                      <Copy size={13} />
                                    )}
                                    {copiedId === member.user_id ? 'Copied!' : 'Copy User ID'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      removeMemberMutation.mutate(member.user_id);
                                      setActionMenuOpen(null);
                                    }}
                                    disabled={removeMemberMutation.isPending}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red/80 hover:bg-red/10 hover:text-red transition-colors"
                                  >
                                    <X size={13} />
                                    Remove member
                                  </button>
                                </div>
                              </motion.div>
                            </>
                          )}
                        </AnimatePresence>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Add member modal */}
      <AddMemberModal
        addOpen={addOpen}
        addError={addError}
        newUserId={newUserId}
        setNewUserId={setNewUserId}
        newRole={newRole}
        setNewRole={setNewRole}
        addMemberMutation={addMemberMutation}
        handleAddSubmit={handleAddSubmit}
        handleAddClose={handleAddClose}
      />
    </motion.div>
  );
}

// ─── Add Member Modal ────────────────────────────────────────────────────────
function AddMemberModal({
  addOpen,
  addError,
  newUserId,
  setNewUserId,
  newRole,
  setNewRole,
  addMemberMutation,
  handleAddSubmit,
  handleAddClose,
}: {
  addOpen: boolean;
  addError: string;
  newUserId: string;
  setNewUserId: (v: string) => void;
  newRole: string;
  setNewRole: (v: string) => void;
  addMemberMutation: { isPending: boolean };
  handleAddSubmit: (e: FormEvent) => void;
  handleAddClose: () => void;
}) {
  return (
    <AnimatePresence>
      {addOpen && (
        <Modal open={addOpen} onClose={handleAddClose} title="Invite member">
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
                    <div className="rounded-lg border border-red/30 bg-red/10 px-4 py-3 text-sm text-red" role="alert">
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
                <Button type="button" variant="secondary" onClick={handleAddClose}>
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

  const updateMutation = useMutation({
    mutationFn: (data: { name?: string; description?: string }) =>
      workspaceApi.update(workspace.id, data),
    onSuccess: (updated) => {
      addToast('Workspace updated', 'success');
      queryClient.setQueryData(['workspace', workspace.id], updated);
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to update workspace';
      addToast(msg, 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => workspaceApi.delete(workspace.id),
    onSuccess: () => {
      addToast('Workspace deleted', 'success');
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      navigate('/workspaces', { replace: true });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to delete workspace';
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
          <SettingsIcon size={32} className="mx-auto mb-4 text-text-dim" />
          <p className="text-sm text-text-muted">
            Only the workspace owner can access settings.
          </p>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="max-w-2xl space-y-8"
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
          className="text-base font-semibold text-text mb-4 flex items-center gap-2"
          variants={staggerItem}
        >
          <SettingsIcon size={16} className="text-text-muted" />
          General
        </motion.h3>
        <motion.form
          onSubmit={handleUpdateSubmit}
          className="space-y-4 rounded-xl border border-border/40 bg-white/[0.02] p-5"
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
          <Button type="submit" loading={updateMutation.isPending}>
            Save changes
          </Button>
        </motion.form>
      </motion.div>

      {/* Danger zone */}
      <motion.div
        className="rounded-xl border border-red/20 bg-red/[0.02] p-5"
        variants={staggerItem}
      >
        <motion.h3
          className="text-base font-semibold text-red mb-3 flex items-center gap-2"
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
        <Button
          variant="danger"
          onClick={() => setDeleteConfirmOpen(true)}
        >
          <Trash2 size={16} />
          Delete workspace
        </Button>
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
              <div className="flex items-start gap-3 rounded-lg border border-red/30 bg-red/10 p-4">
                <AlertTriangle size={20} className="shrink-0 mt-0.5 text-red" />
                <div className="text-sm text-text">
                  <p className="font-medium text-red">Warning</p>
                  <p className="mt-1 text-text-muted">
                    This will permanently delete{' '}
                    <strong className="text-text">{workspace.name}</strong> and all
                    associated data. This action cannot be undone.
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="secondary" onClick={() => setDeleteConfirmOpen(false)}>
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
