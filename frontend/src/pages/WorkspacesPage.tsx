import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, FolderKanban, Users, FileText, Shield, Sparkles } from 'lucide-react';
import {
  Button,
  Input,
  TextArea,
  Card,
  Badge,
  Modal,
  EmptyState,
  LoadingSpinner,
  Skeleton,
  useToast,
  staggerContainer,
  staggerItem,
  fadeIn,
  pageTransition,
  fadeInScale,
} from '../components/ui';
import { workspaceApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { Workspace } from '../api/types';

export default function WorkspacesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);

  // ─── Fetch workspaces ──────────────────────────────────────────────────────
  const {
    data: workspaceList,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => workspaceApi.list(),
  });

  // ─── Create workspace mutation ─────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      workspaceApi.create(data),
    onSuccess: (created: Workspace) => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      setCreateOpen(false);
      addToast('Workspace created', 'success');
      navigate(`/workspaces/${created.id}`);
    },
  });

  // ─── Create form state ────────────────────────────────────────────────────
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [createError, setCreateError] = useState('');

  function handleCreateSubmit() {
    setCreateError('');
    if (!newName.trim()) {
      setCreateError('Workspace name is required');
      return;
    }
    createMutation.mutate(
      { name: newName.trim(), description: newDescription.trim() || undefined },
      {
        onError: (err: unknown) => {
          setCreateError(
            err instanceof Error ? err.message : 'Failed to create workspace',
          );
        },
      },
    );
  }

  function handleCreateClose() {
    setCreateOpen(false);
    setNewName('');
    setNewDescription('');
    setCreateError('');
  }

  // ─── Role badge helper ─────────────────────────────────────────────────────
  function roleBadgeColor(role: string) {
    switch (role) {
      case 'owner':
        return 'purple' as const;
      case 'admin':
        return 'blue' as const;
      case 'editor':
        return 'green' as const;
      default:
        return 'gray' as const;
    }
  }

  // ─── Loading state ─────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <motion.div
        variants={pageTransition}
        initial="initial"
        animate="animate"
        exit="exit"
        className="relative space-y-6"
      >
        {/* Ambient blobs */}
        <div className="ambient-blob ambient-blob-1" aria-hidden="true" />
        <div className="ambient-blob ambient-blob-2" aria-hidden="true" />
        <div className="ambient-blob ambient-blob-3" aria-hidden="true" />

        {/* Skeleton header */}
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton height={36} width={200} />
            <Skeleton height={16} width={140} />
          </div>
          <Skeleton height={44} width={160} className="rounded-xl" />
        </div>

        {/* Skeleton grid */}
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="glass rounded-2xl p-5 lg:p-6 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <Skeleton height={22} width="65%" />
                <Skeleton height={22} width={56} className="rounded-lg" />
              </div>
              <Skeleton height={14} width="100%" className="mt-2" />
              <Skeleton height={14} width="50%" />
              <div className="flex gap-4 pt-2">
                <Skeleton height={14} width={70} />
                <Skeleton height={14} width={70} />
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    );
  }

  // ─── Error state ───────────────────────────────────────────────────────────
  if (isError) {
    return (
      <motion.div
        variants={pageTransition}
        initial="initial"
        animate="animate"
        exit="exit"
        className="relative"
      >
        {/* Ambient blobs */}
        <div className="ambient-blob ambient-blob-1" aria-hidden="true" />
        <div className="ambient-blob ambient-blob-2" aria-hidden="true" />
        <div className="ambient-blob ambient-blob-3" aria-hidden="true" />

        <div className="flex flex-col items-center justify-center py-20 text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', damping: 15, stiffness: 200 }}
            className="mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-red/15 text-red"
          >
            <Shield size={32} />
          </motion.div>
          <motion.h3
            variants={fadeIn}
            initial="initial"
            animate="animate"
            className="text-lg font-semibold text-text"
          >
            Failed to load workspaces
          </motion.h3>
          <motion.p
            variants={fadeIn}
            initial="initial"
            animate="animate"
            className="mt-2 text-sm text-text-muted max-w-sm"
          >
            {error instanceof Error ? error.message : 'Something went wrong'}
          </motion.p>
          <motion.div
            variants={fadeIn}
            initial="initial"
            animate="animate"
            className="mt-6"
          >
            <Button variant="secondary" onClick={() => refetch()}>
              Try again
            </Button>
          </motion.div>
        </div>
      </motion.div>
    );
  }

  const workspaces = workspaceList?.data ?? [];

  // ─── Empty state ───────────────────────────────────────────────────────────
  if (workspaces.length === 0) {
    return (
      <motion.div
        variants={pageTransition}
        initial="initial"
        animate="animate"
        exit="exit"
        className="relative"
      >
        {/* Ambient blobs */}
        <div className="ambient-blob ambient-blob-1" aria-hidden="true" />
        <div className="ambient-blob ambient-blob-2" aria-hidden="true" />
        <div className="ambient-blob ambient-blob-3" aria-hidden="true" />

        <EmptyState
          icon={
            <motion.div
              animate={{
                rotate: [0, 5, -5, 0],
                scale: [1, 1.05, 1],
              }}
              transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
            >
              <FolderKanban size={32} />
            </motion.div>
          }
          title="No workspaces yet"
          description="Create your first workspace to start organizing documents and queries."
          action={
            <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus size={18} />
                Create workspace
              </Button>
            </motion.div>
          }
        />
        <CreateWorkspaceModal />
      </motion.div>
    );
  }

  // ─── Main content ──────────────────────────────────────────────────────────
  return (
    <motion.div
      variants={pageTransition}
      initial="initial"
      animate="animate"
      exit="exit"
      className="relative space-y-8"
    >
      {/* Ambient blobs */}
      <div className="ambient-blob ambient-blob-1" aria-hidden="true" />
      <div className="ambient-blob ambient-blob-2" aria-hidden="true" />
      <div className="ambient-blob ambient-blob-3" aria-hidden="true" />

      {/* ── Animated Page Header ── */}
      <motion.div
        variants={fadeInScale}
        initial="initial"
        animate="animate"
        className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-center gap-4">
          <motion.div
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', damping: 12, stiffness: 180, delay: 0.1 }}
            className="flex h-14 w-14 items-center justify-center rounded-2xl glass border border-primary/20 shadow-lg shadow-primary/10"
          >
            <Sparkles size={26} className="text-primary-soft" />
          </motion.div>
          <div>
            <motion.h1
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
              className="text-2xl font-bold gradient-text sm:text-3xl"
            >
              Workspaces
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.25 }}
              className="mt-1 text-sm text-text-muted"
            >
              {workspaces.length} workspace{workspaces.length !== 1 ? 's' : ''}{' '}
              &middot; organize your investigations
            </motion.p>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
        >
          <Button onClick={() => setCreateOpen(true)} size="lg">
            <Plus size={20} />
            New workspace
          </Button>
        </motion.div>
      </motion.div>

      {/* Separator */}
      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.6, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="h-px origin-left bg-gradient-to-r from-primary/40 via-accent/20 to-transparent"
      />

      {/* ── Workspace Grid ── */}
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="animate"
        className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
      >
        {workspaces.map((ws, idx) => {
          // Determine current user's role
          const isOwner = ws.owner_id === user?.id;
          const role = isOwner ? 'owner' : 'member';
          return (
            <motion.div
              key={ws.id}
              variants={staggerItem}
              custom={idx}
              whileHover={{ y: -6, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="group relative cursor-pointer"
              onClick={() => navigate(`/workspaces/${ws.id}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate(`/workspaces/${ws.id}`);
                }
              }}
              aria-label={`Open workspace ${ws.name}`}
            >
              {/* Gradient border glow on hover */}
              <div className="absolute -inset-[1px] rounded-2xl bg-gradient-to-br from-primary/40 via-accent/20 to-accent-2/40 opacity-0 blur-sm transition-opacity duration-500 group-hover:opacity-100" />

              <Card
                className="relative h-full border border-glass-border bg-card backdrop-blur-xl transition-all duration-300 group-hover:border-primary/30 group-hover:shadow-xl group-hover:shadow-primary/10"
              >
                {/* Top accent line */}
                <div className="absolute inset-x-0 top-0 h-[2px] rounded-t-2xl bg-gradient-to-r from-primary/50 via-accent/30 to-accent-2/50 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <motion.div
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: 0.1, duration: 0.3 }}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary-soft"
                    >
                      <FolderKanban size={18} />
                    </motion.div>
                    <h3 className="font-semibold text-text truncate text-base">
                      {ws.name}
                    </h3>
                  </div>
                  <Badge color={roleBadgeColor(role)} className="shrink-0">
                    {role}
                  </Badge>
                </div>

                <p className="mt-3 text-sm text-text-muted line-clamp-2 leading-relaxed">
                  {ws.description || (
                    <span className="italic text-text-dim">No description</span>
                  )}
                </p>

                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2, duration: 0.3 }}
                  className="mt-5 flex items-center gap-5 border-t border-border/50 pt-4 text-xs text-text-dim"
                >
                  <span className="flex items-center gap-1.5 transition-colors group-hover:text-text-muted">
                    <Users size={14} className="text-accent/70" />
                    {ws.member_count || 1} member{(ws.member_count || 1) !== 1 ? 's' : ''}
                  </span>
                  <span className="flex items-center gap-1.5 transition-colors group-hover:text-text-muted">
                    <FileText size={14} className="text-accent-2/70" />
                    {ws.document_count || 0} document{(ws.document_count || 0) !== 1 ? 's' : ''}
                  </span>
                </motion.div>
              </Card>
            </motion.div>
          );
        })}
      </motion.div>

      {/* ── Create Workspace Modal ── */}
      <CreateWorkspaceModal />
    </motion.div>
  );

  // ─── Inline modal component ───────────────────────────────────────────────
  function CreateWorkspaceModal() {
    return (
      <Modal
        open={createOpen}
        onClose={handleCreateClose}
        title="Create workspace"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleCreateSubmit();
          }}
          className="space-y-5"
        >
          <AnimatePresence>
            {createError && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div
                  className="rounded-lg border border-red/30 bg-red/10 px-4 py-3 text-sm text-red"
                  role="alert"
                >
                  {createError}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <Input
            label="Workspace name"
            placeholder="My workspace"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
          />
          <TextArea
            label="Description (optional)"
            placeholder="What is this workspace for?"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            rows={3}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={handleCreateClose}
            >
              Cancel
            </Button>
            <Button type="submit" loading={createMutation.isPending}>
              <Plus size={18} />
              Create
            </Button>
          </div>
        </form>
      </Modal>
    );
  }
}
