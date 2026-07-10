import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { FolderOpen, Plus, FileText, Clock } from 'lucide-react';
import { Button, Card, Input, Modal } from '../components/ui';
import { staggerContainer, staggerItem, pageTransition } from '../components/motion';
import { useToast } from '../components/toast-context';
import { PageHeader, PageShell, StateBlock } from '../components/PageWrappers';
import { collectionApi } from '../api/client';

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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [collections, setCollections] = useState<CollectionItem[]>([]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  const loadCollections = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const result = await collectionApi.list('default');
      setCollections((result.data || []) as CollectionItem[]);
    } catch (err) {
      setCollections([]);
      setLoadError(err instanceof Error ? err.message : 'Failed to load collections.');
    } finally {
      setLoading(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void loadCollections();
  }, [loadCollections]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreateLoading(true);
    try {
      const col = await collectionApi.create('default', {
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

  return (
    <motion.div variants={pageTransition} initial="initial" animate="animate">
      <PageShell>
      {/* Header */}
      <motion.div variants={staggerItem}>
        <PageHeader
          title="Collections"
          description="Organize documents into collections."
          actions={(
            <Button size="sm" onClick={() => setCreateModalOpen(true)}>
              <Plus size={14} />
              New Collection
            </Button>
          )}
        />
      </motion.div>

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
        {loading ? (
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
