import { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { Badge, Button, EmptyState, Modal, Select, type BadgeColor } from '../components/ui';
import { pageTransition, staggerContainer, staggerItem } from '../components/motion';
import { useToast } from '../components/toast-context';
import { PageHeader, PageShell, StateBlock } from '../components/PageWrappers';
import { adminApi } from '../api/client';
import type { GoldenApprovalStatus, GoldenCategory, GoldenEntryResponse } from '../api/types';

// ─── Constants ──────────────────────────────────────────────────────────────

const GOLDEN_KEY = ['admin', 'golden'];

type StatusFilter = GoldenApprovalStatus | 'all';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'all', label: 'All' },
];

const STATUS_COLOR: Record<GoldenApprovalStatus, BadgeColor> = {
  pending: 'orange',
  approved: 'green',
};

const CATEGORY_COLOR: Record<GoldenCategory, BadgeColor> = {
  answerable: 'green',
  unanswerable: 'orange',
  ambiguous: 'purple',
};

// Mirrors the difficulty scale offered in the review-queue promote modal.
const DIFFICULTY_LABEL: Record<number, string> = {
  1: '1 — Easy',
  2: '2 — Moderate',
  3: '3 — Hard',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Row text and `aria-label`s both need a short form — a raw question can run
 *  to a paragraph, which would blow out the table layout and make button
 *  names unusably long for screen readers. */
function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function AdminGoldenPage() {
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [deleteTarget, setDeleteTarget] = useState<GoldenEntryResponse | null>(null);

  // ── Data ──────────────────────────────────────────────────────────────────
  const goldenQuery = useQuery({
    queryKey: [...GOLDEN_KEY, 'list', statusFilter],
    queryFn: () => adminApi.golden.list({
      source: 'promoted',
      ...(statusFilter === 'all' ? {} : { status: statusFilter }),
    }),
  });

  const entries = goldenQuery.data?.data ?? [];

  // The approval backlog, so it stays visible while the admin is looking at the
  // `approved` or `all` filter. Sourced from `?source=promoted&status=pending`
  // per the backend contract — `meta.promoted_count` counts pending *and*
  // approved rows, so it is not a substitute.
  const pendingCountQuery = useQuery({
    queryKey: [...GOLDEN_KEY, 'pending-count'],
    queryFn: () => adminApi.golden.list({ source: 'promoted', status: 'pending', page_size: 1 }),
    select: (response) => response.meta.total,
  });
  const pendingCount = pendingCountQuery.data ?? 0;

  const invalidateGolden = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: GOLDEN_KEY });
  }, [queryClient]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const approveMutation = useMutation({
    mutationFn: (entry: GoldenEntryResponse) => adminApi.golden.approve(entry.id),
    onSuccess: () => {
      invalidateGolden();
      addToast('Golden entry approved.', 'success');
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (entry: GoldenEntryResponse) => adminApi.golden.remove(entry.id),
    onSuccess: () => {
      setDeleteTarget(null);
      invalidateGolden();
      addToast('Golden entry rejected and removed.', 'success');
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <motion.div variants={pageTransition} initial="initial" animate="animate">
      <PageShell>
        <motion.div variants={staggerItem}>
          <PageHeader
            title="Golden set approvals"
            description="Editor-promoted answers wait here for an admin to approve before they can gate prompt promotion."
            actions={pendingCountQuery.isSuccess ? (
              <Badge color={pendingCount > 0 ? 'orange' : 'gray'}>
                {pendingCount === 1 ? '1 awaiting approval' : `${pendingCount} awaiting approval`}
              </Badge>
            ) : null}
          />
        </motion.div>

        <motion.div variants={staggerItem} className="flex flex-wrap items-end gap-3">
          <div className="w-full max-w-xs">
            <Select
              label="Status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              options={STATUS_OPTIONS}
            />
          </div>
          {/* An editor promoting a new answer is the common reason this list
              goes stale between polls. */}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void goldenQuery.refetch()}
            loading={goldenQuery.isFetching}
          >
            <RefreshCw size={14} aria-hidden="true" />
            Refresh
          </Button>
        </motion.div>

        {goldenQuery.isPending ? (
          <StateBlock role="status">Loading golden-set entries…</StateBlock>
        ) : goldenQuery.isError ? (
          <StateBlock tone="danger" role="alert" className="space-y-3">
            <p>{errorMessage(goldenQuery.error)}</p>
            <Button variant="secondary" size="sm" onClick={() => void goldenQuery.refetch()}>
              Retry
            </Button>
          </StateBlock>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<Sparkles size={24} />}
            title={statusFilter === 'pending' ? 'Nothing awaiting approval' : 'No golden entries'}
            description={statusFilter === 'pending'
              ? 'No editor-promoted answers are waiting on an admin decision.'
              : 'No promoted entries match this filter.'}
          />
        ) : (
          <div className="overflow-x-auto rounded-card border border-border bg-solid shadow-e1">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-card-2">
                  <th scope="col" className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-dim">Question</th>
                  <th scope="col" className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-dim">Category</th>
                  <th scope="col" className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-dim">Difficulty</th>
                  <th scope="col" className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-dim">Source workspace</th>
                  <th scope="col" className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-dim">Created</th>
                  <th scope="col" className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-dim">Status</th>
                  <th scope="col" className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-text-dim">Actions</th>
                </tr>
              </thead>
              <motion.tbody variants={staggerContainer} initial="initial" animate="animate">
                {entries.map((entry) => {
                  const shortQuestion = truncate(entry.question, 40);
                  const approving = approveMutation.isPending && approveMutation.variables?.id === entry.id;

                  return (
                    <motion.tr
                      key={entry.id}
                      variants={staggerItem}
                      className="border-b border-border-light transition-colors last:border-b-0 hover:bg-card-2"
                    >
                      <td className="max-w-xs px-4 py-3 text-text" title={entry.question}>
                        {truncate(entry.question, 90)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge color={CATEGORY_COLOR[entry.category]}>{entry.category}</Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-text-muted">
                        {DIFFICULTY_LABEL[entry.difficulty] ?? entry.difficulty}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-text-dim">
                        {entry.workspace_id ?? '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-text-dim">
                        {formatDate(entry.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge color={STATUS_COLOR[entry.status]}>{entry.status}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {entry.status === 'pending' ? (
                            <Button
                              size="sm"
                              aria-label={`Approve ${shortQuestion}`}
                              loading={approving}
                              onClick={() => approveMutation.mutate(entry)}
                            >
                              <CheckCircle2 size={13} />
                              Approve
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="danger"
                            aria-label={`Delete ${shortQuestion}`}
                            onClick={() => setDeleteTarget(entry)}
                          >
                            <Trash2 size={13} />
                            Delete
                          </Button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </motion.tbody>
            </table>
          </div>
        )}

        {/* ── Delete / reject confirmation ─────────────────────────────── */}
        <Modal open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Delete golden entry">
          {deleteTarget ? (
            <div className="space-y-4">
              <p className="text-sm text-text-muted">
                Delete “{truncate(deleteTarget.question, 140)}” from the golden set? This rejects the
                promotion — the reviewed answer stays in its workspace but no longer counts toward the
                global golden set.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => setDeleteTarget(null)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  loading={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(deleteTarget)}
                >
                  <Trash2 size={14} />
                  Delete entry
                </Button>
              </div>
            </div>
          ) : null}
        </Modal>
      </PageShell>
    </motion.div>
  );
}
