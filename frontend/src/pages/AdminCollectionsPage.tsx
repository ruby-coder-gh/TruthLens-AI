import { useState, useEffect, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FolderOpen, Plus, FileText, Clock, X } from 'lucide-react';
import { Button, Card, Badge, Input, Modal, useToast, staggerContainer, staggerItem, pageTransition } from '../components/ui';
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
  const [collections, setCollections] = useState<CollectionItem[]>([]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const result = await collectionApi.list('default');
        setCollections((result.data || []) as CollectionItem[]);
      } catch {
        setCollections([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
    <motion.div
      className="space-y-5"
      variants={pageTransition}
      initial="initial"
      animate="animate"
    >
      {/* Header */}
      <motion.div variants={staggerItem} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Collections</h1>
          <p className="text-sm text-text-muted mt-1">Organize documents into collections.</p>
        </div>
        <Button size="sm" onClick={() => setCreateModalOpen(true)}>
          <Plus size={14} />
          New Collection
        </Button>
      </motion.div>

      {/* Collection Grid */}
      <motion.div
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        {loading ? (
          <div className="col-span-full flex justify-center py-12">
            <div className="flex items-center gap-2 text-text-muted text-sm">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Loading collections...
            </div>
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
    </motion.div>
  );
}
