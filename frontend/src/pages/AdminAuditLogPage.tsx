import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardList, Search, Filter, RefreshCw, ChevronDown, ChevronUp, Shield, Clock,
} from 'lucide-react';
import { Button, Badge, Input, EmptyState } from '../components/ui';
import { pageTransition, staggerContainer, staggerItem } from '../components/motion';
import { PageHeader, PageShell, StateBlock } from '../components/PageWrappers';
import { adminApi } from '../api/client';

// Backend audit-log actions are exact-match dotted strings like `user.login`,
// `document.delete`, etc. — bare words (`login`, `delete`, ...) never match
// anything the API records, so every filter previously returned 0 rows.
const ACTION_FILTERS = [
  { value: '', label: 'All actions' },
  { value: 'user.login', label: 'User login' },
  { value: 'user.logout', label: 'User logout' },
  { value: 'user.register', label: 'User register' },
  { value: 'user.invite', label: 'User invite' },
  { value: 'user.role_update', label: 'User role update' },
  { value: 'user.status_update', label: 'User status update' },
  { value: 'user.deactivate', label: 'User deactivate' },
  { value: 'user.delete', label: 'User delete' },
  { value: 'user.password_change', label: 'Password change' },
  { value: 'user.password_reset', label: 'Password reset' },
  { value: 'workspace.create', label: 'Workspace create' },
  { value: 'workspace.delete', label: 'Workspace delete' },
  { value: 'workspace.add_member', label: 'Workspace add member' },
  { value: 'workspace.remove_member', label: 'Workspace remove member' },
  { value: 'document.upload', label: 'Document upload' },
  { value: 'document.delete', label: 'Document delete' },
  { value: 'document.reindex', label: 'Document reindex' },
  { value: 'collection.create', label: 'Collection create' },
  { value: 'collection.delete', label: 'Collection delete' },
];

const PAGE_SIZE = 10;

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function actionBadgeColor(action: string): 'green' | 'orange' | 'red' | 'blue' | 'gray' {
  if (action.endsWith('.delete') || action.endsWith('.deactivate')) return 'red';
  if (action.endsWith('.create') || action.endsWith('.upload') || action.endsWith('.register') || action.endsWith('.invite')) return 'green';
  if (action.endsWith('.update') || action.endsWith('.reindex') || action.endsWith('.add_member') || action.endsWith('.remove_member')) return 'orange';
  if (action.endsWith('.login') || action.endsWith('.logout')) return 'blue';
  return 'gray';
}

export default function AdminAuditLogPage() {
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const logsQuery = useQuery({
    queryKey: ['admin', 'logs', page, actionFilter, search],
    queryFn: () => adminApi.logs({
      page,
      page_size: PAGE_SIZE,
      ...(actionFilter ? { action: actionFilter } : {}),
      ...(search ? { q: search } : {}),
    }),
    placeholderData: (prev) => prev,
  });

  const logs = logsQuery.data?.data ?? [];
  const total = logsQuery.data?.meta?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  function handleRetry() {
    logsQuery.refetch();
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    setPage(1);
  }

  function handleActionFilterChange(value: string) {
    setActionFilter(value);
    setPage(1);
  }

  return (
    <motion.div variants={pageTransition} initial="initial" animate="animate">
      <PageShell>
      {/* Header */}
      <motion.div variants={{ initial: { opacity: 0.99, y: 6 }, animate: { opacity: 1, y: 0, transition: { duration: 0.3 } } }}>
        <PageHeader
          title="Audit Log"
          description="Track all system activity and changes."
        />
      </motion.div>

      {/* Filters */}
      <motion.div
        className="flex flex-col sm:flex-row gap-3"
        variants={{ initial: { opacity: 0.99, y: 6 }, animate: { opacity: 1, y: 0, transition: { duration: 0.3, delay: 0.05 } } }}
      >
        <div className="flex-1 max-w-md">
          <Input
            placeholder="Search by user, action, resource..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            icon={<Search size={16} />}
          />
        </div>
        <div className="relative">
          <Filter size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" />
          <select
            value={actionFilter}
            onChange={(e) => handleActionFilterChange(e.target.value)}
            className="w-40 appearance-none rounded-lg border border-border bg-bg-soft/80 backdrop-blur-sm px-3 py-2.5 pl-9 pr-8 text-sm text-text transition-colors focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
            aria-label="Filter by action type"
          >
            {ACTION_FILTERS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-dim" />
        </div>
        {logsQuery.isFetching && (
          <div className="flex items-center">
            <RefreshCw size={14} className="animate-spin text-primary" />
          </div>
        )}
      </motion.div>

      {/* Table */}
      {logsQuery.isLoading ? (
        <StateBlock role="status">Loading audit logs…</StateBlock>
      ) : logsQuery.isError ? (
        <StateBlock tone="danger" role="alert" className="space-y-3">
          <p>{(logsQuery.error as Error)?.message ?? 'Failed to load audit logs.'}</p>
          <Button variant="secondary" size="sm" onClick={handleRetry}>
            <RefreshCw size={14} />
            Retry
          </Button>
        </StateBlock>
      ) : logs.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={24} />}
          title="No audit logs found"
          description={search || actionFilter ? 'Try different filters.' : 'No activity recorded yet.'}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border glass">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-card-2/80">
                  <th className="px-4 py-3 w-10" />
                  <th className="px-4 py-3 font-medium text-text-muted">Timestamp</th>
                  <th className="px-4 py-3 font-medium text-text-muted">User</th>
                  <th className="px-4 py-3 font-medium text-text-muted">Action</th>
                  <th className="px-4 py-3 font-medium text-text-muted">Resource</th>
                  <th className="px-4 py-3 font-medium text-text-muted">Details</th>
                </tr>
              </thead>
              <motion.tbody
                variants={staggerContainer}
                initial="initial"
                animate="animate"
              >
                <AnimatePresence mode="popLayout">
                  {logs.map((entry) => {
                    const isExpanded = expandedId === entry.id;
                    return (
                      <motion.tr
                        key={entry.id}
                        layout
                        variants={staggerItem}
                        initial="initial"
                        animate="animate"
                        exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }}
                        className="border-b border-border last:border-b-0 transition-colors hover:bg-card-2/50"
                      >
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => toggleExpand(entry.id)}
                            className="flex items-center justify-center text-text-dim hover:text-text transition-colors"
                            aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </button>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-text tabular-nums text-xs">
                          <span className="flex items-center gap-1">
                            <Clock size={11} />
                            {formatTimestamp(entry.created_at)}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-text-muted">
                          {entry.user_id.length > 16 ? `${entry.user_id.slice(0, 16)}...` : entry.user_id}
                        </td>
                        <td className="px-4 py-3">
                          <Badge color={actionBadgeColor(entry.action)}>{entry.action}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-text-muted text-xs">{entry.resource_type}</span>
                          <span className="ml-1 font-mono text-[10px] text-text-dim">#{entry.resource_id.slice(0, 8)}</span>
                        </td>
                        <td className="px-4 py-3 text-text-dim text-xs max-w-[200px] truncate">
                          {entry.details ? JSON.stringify(entry.details).slice(0, 60) : '—'}
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </motion.tbody>
            </table>
          </div>

          {/* Expanded row */}
          <AnimatePresence>
            {expandedId && (() => {
              const entry = logs.find((e) => e.id === expandedId);
              if (!entry?.details) return null;
              return (
                <motion.div
                  key="expanded-detail"
                  initial={{ opacity: 0.99, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="rounded-xl border border-primary/20 glass p-4"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Shield size={14} className="text-primary-soft" />
                    <span className="text-xs font-medium text-text-muted">Full details</span>
                  </div>
                  <pre className="overflow-x-auto text-xs text-text leading-relaxed whitespace-pre-wrap font-mono">
                    {JSON.stringify(entry.details, null, 2)}
                  </pre>
                </motion.div>
              );
            })()}
          </AnimatePresence>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-text-muted">
                Page {page} of {totalPages} ({total} total)
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      </PageShell>
    </motion.div>
  );
}
