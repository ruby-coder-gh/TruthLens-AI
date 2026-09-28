import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, PlayCircle, Radar as RadarIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { Button, Card, EmptyState, Skeleton } from '../ui';
import { fadeIn, staggerContainer, staggerItem } from '../motion';
import { useToast } from '../toast-context';
import { useSourceViewer } from '../../context/SourceViewerContext';
import { radarApi } from '../../api/client';
import type { Contradiction, ContradictionSide, ContradictionStatus, RadarScan, RadarState } from '../../api/types';
import ConflictCard from './ConflictCard';

const FILTERS: { id: ContradictionStatus; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'dismissed', label: 'Dismissed' },
  { id: 'resolved', label: 'Resolved' },
];

const ACTIVE_STATUSES: RadarScan['status'][] = ['queued', 'running'];

/** Radar-sweep progress card. The rotation is a plain CSS animation
 * (`.animate-spin-slow`), so the global `prefers-reduced-motion` rule in
 * index.css (`animation-duration: 0.01ms !important`) freezes it for free —
 * no matchMedia plumbing needed here. */
function ScanProgress({ scan }: { scan: RadarScan }) {
  return (
    <Card className="flex items-center gap-4">
      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full border border-primary/25" aria-hidden="true">
        <div
          className="absolute inset-0 animate-spin-slow"
          style={{ background: 'conic-gradient(from 0deg, transparent 0deg, var(--color-primary) 55deg, transparent 130deg)' }}
        />
        <div className="absolute inset-[3px] rounded-full bg-bg" />
      </div>
      <div className="min-w-0 flex-1" aria-live="polite">
        <p className="text-sm font-medium text-text">
          {scan.status === 'queued' ? 'Scan queued…' : 'Scanning for contradictions…'}
        </p>
        <p className="mt-0.5 text-xs tabular-nums text-text-muted">
          {scan.chunks_scanned.toLocaleString()} chunks scanned · {scan.pairs_checked.toLocaleString()} pairs checked · {scan.found} found
        </p>
      </div>
    </Card>
  );
}

export default function RadarPanel({ workspaceId, canModerate }: { workspaceId: string; canModerate: boolean }) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const { open: openSource } = useSourceViewer();
  const [filter, setFilter] = useState<ContradictionStatus>('open');

  const queryKey = ['radar', workspaceId, filter] as const;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: () => radarApi.get(workspaceId, filter),
    enabled: !!workspaceId,
    // Poll only while a scan is actually in flight; react-query stops the
    // interval itself the instant this returns `false` on a later render.
    refetchInterval: (query) => {
      const scan = query.state.data?.latest_scan;
      return scan && ACTIVE_STATUSES.includes(scan.status) ? 2000 : false;
    },
  });

  const scanMutation = useMutation({
    mutationFn: () => radarApi.scan(workspaceId),
    onSuccess: () => {
      addToast('Scan started — this can take a minute on a large workspace.', 'success');
      queryClient.invalidateQueries({ queryKey: ['radar', workspaceId] });
    },
    onError: (err: unknown) => {
      addToast(err instanceof Error ? err.message : 'Could not start a scan.', 'error');
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ContradictionStatus }) =>
      radarApi.setStatus(workspaceId, id, status),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<RadarState>(queryKey);
      queryClient.setQueryData<RadarState>(queryKey, (old) => {
        if (!old) return old;
        const moved = old.contradictions.find((c) => c.id === id);
        if (!moved) return old;
        return {
          ...old,
          contradictions: old.contradictions.filter((c) => c.id !== id),
          counts: {
            ...old.counts,
            [moved.status]: Math.max(0, old.counts[moved.status] - 1),
            [status]: old.counts[status] + 1,
          },
        };
      });
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      addToast(err instanceof Error ? err.message : 'Could not update this contradiction.', 'error');
    },
    onSuccess: (_result, { status }) => {
      addToast(status === 'dismissed' ? 'Contradiction dismissed.' : 'Marked resolved.', 'success');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['radar', workspaceId] });
    },
  });

  function handleView(side: ContradictionSide) {
    openSource({
      workspaceId,
      documentId: side.document_id,
      chunkId: side.chunk_id,
      documentName: side.document_name,
      pageNumber: side.page_number,
    });
  }

  const contradictions: Contradiction[] = data?.contradictions ?? [];
  const counts = data?.counts ?? { open: 0, dismissed: 0, resolved: 0 };
  const latestScan = data?.latest_scan ?? null;
  const scanActive = latestScan != null && ACTIVE_STATUSES.includes(latestScan.status);
  const busyId = statusMutation.isPending ? statusMutation.variables?.id : undefined;

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-5">
      <motion.div variants={staggerItem} className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xl">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text">
            <RadarIcon size={18} className="text-primary-soft" /> Contradiction Radar
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            Scans every chunk against its nearest neighbours in other documents and flags sentences that disagree —
            numbers, dates, or claims that don't line up.
          </p>
        </div>
        {canModerate && (
          <Button size="sm" onClick={() => scanMutation.mutate()} disabled={scanActive} loading={scanMutation.isPending}>
            <PlayCircle size={14} /> Run full scan
          </Button>
        )}
      </motion.div>

      {latestScan && scanActive && (
        <motion.div variants={staggerItem}>
          <ScanProgress scan={latestScan} />
        </motion.div>
      )}

      {latestScan?.status === 'failed' && (
        <motion.div variants={staggerItem}>
          <Card className="flex flex-wrap items-center justify-between gap-3 border-red/30 bg-red/6">
            <div className="flex items-center gap-2 text-sm text-red">
              <AlertTriangle size={16} />
              Last scan failed{latestScan.error ? `: ${latestScan.error}` : '.'}
            </div>
            {canModerate && (
              <Button size="sm" variant="secondary" onClick={() => scanMutation.mutate()} loading={scanMutation.isPending}>
                Retry scan
              </Button>
            )}
          </Card>
        </motion.div>
      )}

      <motion.div variants={staggerItem} role="tablist" aria-label="Filter contradictions" className="inline-flex gap-1 rounded-control glass p-1">
        {FILTERS.map((f) => {
          const isActive = f.id === filter;
          return (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setFilter(f.id)}
              className={clsx(
                'flex h-[30px] items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium transition-colors duration-150',
                isActive ? 'bg-primary/11 font-semibold text-primary-soft' : 'text-text-muted hover:text-text',
              )}
            >
              {f.label}
              <span className="tabular-nums text-text-dim">{counts[f.id]}</span>
            </button>
          );
        })}
      </motion.div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton height={140} className="rounded-card" />
          <Skeleton height={140} className="rounded-card" />
        </div>
      ) : isError ? (
        <EmptyState
          icon={<AlertTriangle size={22} />}
          title="Couldn't load the radar"
          description={error instanceof Error ? error.message : 'Something went wrong fetching contradictions.'}
          action={<Button size="sm" variant="secondary" onClick={() => refetch()}>Try again</Button>}
        />
      ) : contradictions.length === 0 ? (
        <motion.div variants={fadeIn}>
          {latestScan == null ? (
            <EmptyState
              icon={<RadarIcon size={22} />}
              title="No scans yet"
              description={
                canModerate
                  ? 'Run a full scan to check every document in this workspace for contradicting claims.'
                  : 'An editor or owner needs to run the first scan for this workspace.'
              }
              action={
                canModerate ? (
                  <Button size="sm" onClick={() => scanMutation.mutate()} loading={scanMutation.isPending}>
                    <PlayCircle size={14} /> Run full scan
                  </Button>
                ) : undefined
              }
            />
          ) : filter === 'open' && latestScan.status === 'done' ? (
            <EmptyState
              icon={<CheckCircle2 size={22} />}
              title="No contradictions found"
              description={`Checked ${latestScan.chunks_scanned.toLocaleString()} passages across this workspace — nothing disagreed.`}
            />
          ) : (
            <EmptyState
              icon={<RadarIcon size={22} />}
              title={`No ${filter} contradictions`}
              description="Nothing here right now."
            />
          )}
        </motion.div>
      ) : (
        <ul role="list" className="space-y-4">
          {contradictions.map((c) => (
            <ConflictCard
              key={c.id}
              contradiction={c}
              canModerate={canModerate}
              updating={
                busyId === c.id
                  ? (statusMutation.variables?.status === 'dismissed' ? 'dismiss' : 'resolve')
                  : null
              }
              onView={handleView}
              onDismiss={() => statusMutation.mutate({ id: c.id, status: 'dismissed' })}
              onResolve={() => statusMutation.mutate({ id: c.id, status: 'resolved' })}
            />
          ))}
        </ul>
      )}
    </motion.div>
  );
}
