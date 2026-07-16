import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  MessageSquare,
  Plus,
  FolderOpen,
  FileText,
  ArrowRight,
  AlertTriangle,
} from 'lucide-react';
import { Button, LoadingSpinner, EmptyState } from '../components/ui';
import { fadeIn } from '../components/motion';
import { PageHeader, PageShell, StateBlock } from '../components/PageWrappers';
import { workspaceApi } from '../api/client';

export default function ChatNewPage() {
  const navigate = useNavigate();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => workspaceApi.list(),
  });

  const workspaces = data?.data ?? [];

  // Loading
  if (isLoading) {
    return <LoadingSpinner text="Loading workspaces..." />;
  }

  // Error
  if (isError) {
    return (
      <div className="-mx-4 lg:-mx-6 px-4 lg:px-8 xl:px-12">
        <motion.div variants={fadeIn} initial="initial" animate="animate" className="mx-auto max-w-3xl py-6">
          <PageShell>
            <PageHeader
              title="New Chat"
              description="Select workspace to start asking questions."
            />
            <StateBlock tone="danger" role="alert" className="flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{error instanceof Error ? error.message : 'Could not connect to server'}</span>
            </StateBlock>
            <div>
              <Button variant="secondary" onClick={() => refetch()}>
                Try again
              </Button>
            </div>
          </PageShell>
        </motion.div>
      </div>
    );
  }

  // Empty — no workspaces
  if (workspaces.length === 0) {
    return (
      <div className="-mx-4 lg:-mx-6 px-4 lg:px-8 xl:px-12">
        <motion.div variants={fadeIn} initial="initial" animate="animate" className="mx-auto max-w-3xl py-6">
          <PageShell>
            <PageHeader
              title="New Chat"
              description="Select workspace to start asking questions."
            />
            <EmptyState
              icon={<FolderOpen size={32} />}
              title="No workspaces yet"
              description="Create a workspace to start organizing documents and asking questions."
              action={
                <Button onClick={() => navigate('/workspaces')}>
                  <Plus size={16} />
                  Create Workspace
                </Button>
              }
            />
          </PageShell>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="-mx-4 lg:-mx-6 px-4 lg:px-8 xl:px-12">
      <motion.div
        initial={{ opacity: 0.99 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="mx-auto max-w-3xl space-y-6 py-6"
      >
      <PageShell className="space-y-6">
      <PageHeader
        title="New Chat"
        description="Select a workspace to start asking questions"
      />

      {/* Workspace list */}
      <div className="space-y-3">
        {workspaces.map((ws, i) => (
          <motion.button
            key={ws.id}
            initial={{ opacity: 0.99, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.04 }}
            type="button"
            onClick={() => navigate(`/workspaces/${ws.id}/chat`)}
            className="w-full text-left glass rounded-xl border border-glass-border p-5 transition-all duration-200 hover:border-primary/30 hover:shadow-[0_0_30px_rgba(232,193,90,0.06)] group"
          >
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 shrink-0">
                <MessageSquare size={22} className="text-primary-soft" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-text truncate group-hover:text-primary-soft transition-colors">
                  {ws.name}
                </h3>
                {ws.description && (
                  <p className="text-sm text-text-muted truncate mt-0.5">{ws.description}</p>
                )}
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="flex items-center gap-1 text-xs text-text-dim">
                    <FileText size={12} />
                    {ws.document_count ?? 0} documents
                  </span>
                  <span className="flex items-center gap-1 text-xs text-text-dim">
                    <FolderOpen size={12} />
                    {ws.member_count ?? 1} members
                  </span>
                </div>
              </div>
              <ArrowRight size={18} className="shrink-0 text-text-dim group-hover:text-primary-soft group-hover:translate-x-1 transition-all" />
            </div>
          </motion.button>
        ))}
      </div>

      {/* Create workspace */}
      <div className="text-center pt-2">
        <Button variant="ghost" onClick={() => navigate('/workspaces')}>
          <Plus size={15} />
          Create new workspace
        </Button>
      </div>
      </PageShell>
      </motion.div>
    </div>
  );
}
