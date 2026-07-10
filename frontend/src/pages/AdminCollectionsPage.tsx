import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { FolderOpen, Plus, FileText, Clock } from 'lucide-react';
import { Button, Card, Input, Modal, Select } from '../components/ui';
import { staggerContainer, staggerItem, pageTransition } from '../components/motion';
import { useToast } from '../components/toast-context';
import { PageHeader, PageShell, StateBlock } from '../components/PageWrappers';
import { collectionApi, workspaceApi } from '../api/client';
import type { Workspace } from '../api/types';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface CollectionItem {
  id: string;
  name: string;
  description: string;
  document_count: number;
  created_at: string;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function AdminCollectionsPage() {
  const { addToast } = useToast();

  // Collections are workspace-scoped, so a real workspace id is required
  // before anything can load — previously this hardcoded the literal string
  // 'default', which the backend rejected as an invalid UUID. Resolve the
  // caller's real workspaces first, then let them switch between workspaces
  // if they belong to more than one.
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(true);
  const [workspacesError, setWorkspacesError] = useState('');
  const [workspaceId, setWorkspaceId] = useState<string>('');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [collections, setCollections] = useState<CollectionItem[]>([]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [createLoading, setCreateLoading] = useState(false);

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

  const loadCollections = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setLoadError('');
    try {
      const result = await collectionApi.list(workspaceId);
      setCollections((result.data || []) as CollectionItem[]);
    } catch (err) {
      setCollections([]);
      setLoadError(err instanceof Error ? err.message : 'Failed to load collections.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (workspaceId) void loadCollections();
  }, [workspaceId, loadCollections]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !workspaceId) return;
    setCreateLoading(true);
    try {
      const col = await collectionApi.create(workspaceId, {
        name: newName.trim(),
        description: newDesc.trim(),
      }) as CollectionItem;
      setCollections((prev) => [col, ...prev]);
      setCreateModalOpen(false);
      setNewName('');
      setNewDesc('');
      addToast(`Collection "${col.name}" created`, 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to create collection', 'error');
    } finally {
      setCreateLoading(false);
    }
  }

  const hasWorkspaces = workspaces.length > 0;

  return (
    <motion.div variants={pageTransition} initial="initial" animate="animate">
      <PageShell>
      {/* Header */}
      <motion.div variants={staggerItem}>
        <PageHeader
          title="Collections"
          description="Organize documents into collections."
          actions={(
            <Button size="sm" onClick={() => setCreateModalOpen(true)} disabled={!workspaceId}>
              <Plus size={14} />
              New Collection
            </Button>
          )}
        />
      </motion.div>

      {/* Workspace picker — collections are workspace-scoped, so a real workspace
          must be selected before anything can load or be created. */}
      {workspacesLoading ? (
        <StateBlock role="status">Loading workspaces…</StateBlock>
      ) : workspacesError ? (
        <StateBlock tone="danger" role="alert" className="space-y-3">
          <p>{workspacesError}</p>
          <Button variant="secondary" size="sm" onClick={() => void loadWorkspaces()}>
            Retry
          </Button>
        </StateBlock>
      ) : !hasWorkspaces ? (
        <StateBlock role="alert">
          You don&apos;t belong to any workspace yet. Create a workspace first to organize collections.
        </StateBlock>
      ) : workspaces.length > 1 ? (
        <motion.div variants={staggerItem} className="max-w-xs">
          <Select
            label="Workspace"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            options={workspaces.map((ws) => ({ value: ws.id, label: ws.name }))}
          />
        </motion.div>
      ) : null}

      {loadError ? (
        <StateBlock tone="danger" role="alert" className="space-y-3">
          <p>{loadError}</p>
          <Button variant="secondary" size="sm" onClick={() => void loadCollections()}>
            Retry
          </Button>
        </StateBlock>
      ) : null}

      {/* Collection Grid */}
      <motion.div
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        {!hasWorkspaces ? null : loading ? (
          <div className="col-span-full">
            <StateBlock role="status">Loading collections…</StateBlock>
          </div>
        ) : collections.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-2xl glass text-text-dim">
              <FolderOpen size={28} />
            </div>
            <h3 className="text-xl font-semibold text-text">No collections</h3>
            <p className="mt-2 text-sm text-text-muted">Create your first collection to organize documents.</p>
          </div>
        ) : (
          collections.map((col) => (
            <motion.div key={col.id} variants={staggerItem}>
              <Card hover className="p-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg glass text-primary-soft">
                    <FolderOpen size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-text truncate">{col.name}</h3>
                    {col.description && (
                      <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{col.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2">
                      <span className="flex items-center gap-1 text-xs text-text-dim">
                        <FileText size={11} />
                        {col.document_count} docs
                      </span>
                      <span className="flex items-center gap-1 text-xs text-text-dim">
                        <Clock size={11} />
                        {formatDate(col.created_at)}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))
        )}
      </motion.div>

      {/* Create Modal */}
      <Modal open={createModalOpen} onClose={() => setCreateModalOpen(false)} title="Create Collection">
        <form onSubmit={handleCreate} className="space-y-4">
          <Input
            label="Collection name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g., Financial Reports"
            required
          />
          <div className="space-y-1.5">
            <label htmlFor="col-desc" className="block text-sm font-medium text-text-muted">Description (optional)</label>
            <textarea
              id="col-desc"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Brief description of this collection"
              className="glass-input w-full rounded-xl px-3 py-2.5 text-sm text-text placeholder-text-dim transition-all focus:outline-none resize-y min-h-[60px]"
            />
          </div>
          <div className="flex gap-3">
            <Button type="submit" loading={createLoading} size="sm">
              <Plus size={14} />
              Create
            </Button>
            <Button variant="secondary" size="sm" type="button" onClick={() => setCreateModalOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
      </PageShell>
    </motion.div>
  );
}
