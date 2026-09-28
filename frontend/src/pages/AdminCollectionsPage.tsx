import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { FolderOpen, Plus, FileText, Clock, Pencil, Trash2, AlertTriangle, X } from 'lucide-react';
import { Button, Card, Input, Modal, Select } from '../components/ui';
import { staggerContainer, staggerItem, pageTransition } from '../components/motion';
import { useToast } from '../components/toast-context';
import { PageHeader, PageShell, StateBlock } from '../components/PageWrappers';
import { collectionApi, documentApi, workspaceApi } from '../api/client';
import type { Document, Workspace } from '../api/types';

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

  // BUG-18: edit/delete.
  const [editTarget, setEditTarget] = useState<CollectionItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CollectionItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // BUG-18: add/remove documents. `docsList` is every document in the
  // workspace; membership is `doc.collection_id === docsTarget.id`.
  const [docsTarget, setDocsTarget] = useState<CollectionItem | null>(null);
  const [docsList, setDocsList] = useState<Document[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState('');
  const [docActionId, setDocActionId] = useState<string | null>(null);

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

  function openEdit(col: CollectionItem) {
    setEditTarget(col);
    setEditName(col.name);
    setEditDesc(col.description ?? '');
  }

  async function handleEditSave(e: FormEvent) {
    e.preventDefault();
    if (!editTarget || !editName.trim() || !workspaceId) return;
    setEditLoading(true);
    try {
      const updated = await collectionApi.update(workspaceId, editTarget.id, {
        name: editName.trim(),
        description: editDesc.trim(),
      }) as CollectionItem;
      setCollections((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setEditTarget(null);
      addToast(`Collection "${updated.name}" updated`, 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to update collection', 'error');
    } finally {
      setEditLoading(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget || !workspaceId) return;
    setDeleteLoading(true);
    try {
      await collectionApi.delete(workspaceId, deleteTarget.id);
      setCollections((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      addToast(`Collection "${deleteTarget.name}" deleted`, 'success');
      setDeleteTarget(null);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete collection', 'error');
    } finally {
      setDeleteLoading(false);
    }
  }

  async function openDocs(col: CollectionItem) {
    setDocsTarget(col);
    if (!workspaceId) return;
    setDocsLoading(true);
    setDocsError('');
    try {
      const result = await documentApi.list(workspaceId);
      setDocsList(result.data || []);
    } catch (err) {
      setDocsList([]);
      setDocsError(err instanceof Error ? err.message : 'Failed to load documents.');
    } finally {
      setDocsLoading(false);
    }
  }

  async function handleAddDoc(doc: Document) {
    if (!docsTarget || !workspaceId) return;
    const previousCollectionId = doc.collection_id;
    setDocActionId(doc.id);
    try {
      await collectionApi.addDocuments(workspaceId, docsTarget.id, [doc.id]);
      setDocsList((prev) => prev.map((d) => (d.id === doc.id ? { ...d, collection_id: docsTarget.id } : d)));
      setCollections((prev) => prev.map((c) => {
        if (c.id === docsTarget.id) return { ...c, document_count: c.document_count + 1 };
        if (c.id === previousCollectionId) return { ...c, document_count: Math.max(0, c.document_count - 1) };
        return c;
      }));
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to add document', 'error');
    } finally {
      setDocActionId(null);
    }
  }

  async function handleRemoveDoc(doc: Document) {
    if (!docsTarget || !workspaceId) return;
    setDocActionId(doc.id);
    try {
      await collectionApi.removeDocument(workspaceId, docsTarget.id, doc.id);
      setDocsList((prev) => prev.map((d) => (d.id === doc.id ? { ...d, collection_id: null } : d)));
      setCollections((prev) => prev.map((c) => (
        c.id === docsTarget.id ? { ...c, document_count: Math.max(0, c.document_count - 1) } : c
      )));
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to remove document', 'error');
    } finally {
      setDocActionId(null);
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
            <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-panel border border-border bg-card-2 text-text-dim">
              <FolderOpen size={28} />
            </div>
            <h3 className="text-xl font-semibold text-text">No collections</h3>
            <p className="mt-2 text-sm text-text-muted">Create your first collection to organize documents.</p>
          </div>
        ) : (
          collections.map((col) => (
            <motion.div key={col.id} variants={staggerItem}>
              <Card className="p-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-primary/25 bg-primary/10 text-primary-soft">
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
                    <div className="flex items-center gap-2 mt-3">
                      <Button size="sm" variant="secondary" onClick={() => void openDocs(col)}>
                        <FileText size={12} />
                        Documents
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => openEdit(col)}>
                        <Pencil size={12} />
                        Edit
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => setDeleteTarget(col)}>
                        <Trash2 size={12} />
                        Delete
                      </Button>
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
            <label htmlFor="col-desc" className="block text-[12.5px] font-medium text-text-muted">Description (optional)</label>
            <textarea
              id="col-desc"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Brief description of this collection"
              className="glass-input w-full rounded-control px-3 py-2.5 text-sm text-text placeholder:text-text-dim focus:outline-none resize-y min-h-[60px]"
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

      {/* Edit Modal */}
      <Modal open={editTarget !== null} onClose={() => setEditTarget(null)} title="Edit Collection">
        <form onSubmit={handleEditSave} className="space-y-4">
          <Input
            label="Collection name"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            required
          />
          <div className="space-y-1.5">
            <label htmlFor="col-edit-desc" className="block text-[12.5px] font-medium text-text-muted">Description (optional)</label>
            <textarea
              id="col-edit-desc"
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              className="glass-input w-full rounded-control px-3 py-2.5 text-sm text-text placeholder:text-text-dim focus:outline-none resize-y min-h-[60px]"
            />
          </div>
          <div className="flex gap-3">
            <Button type="submit" loading={editLoading} size="sm">
              Save
            </Button>
            <Button variant="secondary" size="sm" type="button" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation */}
      <Modal open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Delete Collection">
        {deleteTarget ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-card border border-red/30 bg-red/10 p-4">
              <AlertTriangle size={20} className="text-red shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red">Delete this collection?</p>
                <p className="text-xs text-text-muted mt-1">
                  Documents in <strong className="text-text">{deleteTarget.name}</strong> are not deleted, only unlinked from the collection.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="danger" size="sm" loading={deleteLoading} onClick={() => void handleDelete()}>
                <Trash2 size={14} />
                Delete
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Manage documents (BUG-18) */}
      <Modal
        open={docsTarget !== null}
        onClose={() => setDocsTarget(null)}
        title={docsTarget ? `Manage documents — ${docsTarget.name}` : 'Manage documents'}
      >
        {docsLoading ? (
          <StateBlock role="status">Loading documents…</StateBlock>
        ) : docsError ? (
          <StateBlock tone="danger" role="alert">{docsError}</StateBlock>
        ) : docsList.length === 0 ? (
          <p className="text-sm text-text-muted">No documents in this workspace yet.</p>
        ) : (
          <ul className="max-h-96 space-y-2 overflow-y-auto">
            {docsList.map((doc) => {
              const inThisCollection = docsTarget !== null && doc.collection_id === docsTarget.id;
              const busy = docActionId === doc.id;
              return (
                <li
                  key={doc.id}
                  className="flex items-center justify-between gap-3 rounded-control border border-border bg-card-2 px-3 py-2"
                >
                  <span className="min-w-0 truncate text-sm text-text">{doc.original_filename}</span>
                  {inThisCollection ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busy}
                      onClick={() => void handleRemoveDoc(doc)}
                    >
                      <X size={12} />
                      Remove
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busy}
                      onClick={() => void handleAddDoc(doc)}
                    >
                      <Plus size={12} />
                      Add
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Modal>
      </PageShell>
    </motion.div>
  );
}
