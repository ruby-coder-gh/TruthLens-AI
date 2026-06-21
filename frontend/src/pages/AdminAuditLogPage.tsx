import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardList, Search, Filter, AlertTriangle, RefreshCw, ChevronDown, ChevronUp, Shield, Clock,
} from 'lucide-react';
import { Button, Card, Badge, Input, LoadingSpinner, EmptyState, useToast, pageTransition } from '../components/ui';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface AuditEntry {
  id: string;
  user_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  details?: Record<string, unknown>;
  ip_address?: string;
  created_at: string;
}

// ─── Mock Data ─────────────────────────────────────────────────────────────────

const MOCK_LOGS: AuditEntry[] = Array.from({ length: 45 }, (_, i) => ({
  id: `log-${i + 1}`,
  user_id: i % 3 === 0 ? 'user-alice' : i % 3 === 1 ? 'user-bob' : 'user-carol',
  action: ['create', 'read', 'update', 'delete', 'login', 'logout', 'export'][i % 7],
  resource_type: ['document', 'workspace', 'user', 'query', 'collection'][i % 5],
  resource_id: `res-${(i + 1) * 7}`,
  details: i % 3 === 0 ? { reason: 'User initiated action', metadata: { browser: 'Chrome', ip: '192.168.1.100' } } : undefined,
  ip_address: `192.168.1.${(i % 254) + 1}`,
  created_at: new Date(Date.now() - i * 3600000).toISOString(),
}));

const ACTION_FILTERS = [
  { value: '', label: 'All actions' },
  { value: 'create', label: 'Create' },
  { value: 'read', label: 'Read' },
  { value: 'update', label: 'Update' },
  { value: 'delete', label: 'Delete' },
  { value: 'login', label: 'Login' },
  { value: 'logout', label: 'Logout' },
  { value: 'export', label: 'Export' },
];

const PAGE_SIZE = 10;

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function actionBadgeColor(action: string): 'green' | 'orange' | 'red' | 'blue' | 'gray' {
  switch (action) {
    case 'delete': return 'red';
    case 'create': return 'green';
    case 'update': return 'orange';
    case 'login': case 'logout': return 'blue';
    default: return 'gray';
  }
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function AdminAuditLogPage() {
  const { addToast } = useToast();
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError('');
    const timer = setTimeout(() => {
      // Simulate occasional error
      if (Math.random() < 0.05) {
        setError('Failed to load audit logs');
        setLoading(false);
        return;
      }
      setLogs(MOCK_LOGS);
      setLoading(false);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  const filtered = logs.filter((entry) => {
    const matchAction = actionFilter ? entry.action === actionFilter : true;
    const matchSearch = search
      ? entry.user_id.toLowerCase().includes(search.toLowerCase()) ||
        entry.action.toLowerCase().includes(search.toLowerCase()) ||
        entry.resource_type.toLowerCase().includes(search.toLowerCase()) ||
        entry.resource_id.toLowerCase().includes(search.toLowerCase())
      : true;
    return matchAction && matchSearch;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginatedLogs = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  function handleRetry() {
    setLoading(true);
    setError('');
    setTimeout(() => {
      setLogs(MOCK_LOGS);
      setLoading(false);
    }, 500);
  }

  return (
    <motion.div
      className="space-y-5"
      variants={pageTransition}
      initial="initial"
      animate="animate"
    >
      {/* Header */}
      <motion.div
        variants={{ initial: { opacity: 0.99, y: 6 }, animate: { opacity: 1, y: 0, transition: { duration: 0.3 } } }}
      >
        <h1 className="text-2xl font-bold text-text">Audit Log</h1>
        <p className="text-sm text-text-muted mt-1">Track all system activity and changes.</p>
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
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            icon={<Search size={16} />}
          />
        </div>
        <div className="relative">
          <Filter size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" />
          <select
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
            className="w-40 appearance-none rounded-lg border border-border bg-bg-soft/80 backdrop-blur-sm px-3 py-2.5 pl-9 pr-8 text-sm text-text transition-colors focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
            aria-label="Filter by action type"
          >
            {ACTION_FILTERS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-dim" />
        </div>
      </motion.div>

      {/* Table */}
      {loading ? (
        <LoadingSpinner text="Loading audit logs..." />
      ) : error ? (
        <div className="flex flex-col items-center py-12 text-center">
          <AlertTriangle size={24} className="text-red mb-3" />
          <p className="text-sm text-text-muted">{error}</p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={handleRetry}>
            <RefreshCw size={14} />
            Retry
          </Button>
        </div>
      ) : paginatedLogs.length === 0 ? (
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
              <tbody>
                {paginatedLogs.map((entry) => {
                  const isExpanded = expandedId === entry.id;
                  return (
                    <tr
                      key={entry.id}
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
                    </tr>
                  );
                })}
              </tbody>
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
                Page {page} of {totalPages} ({filtered.length} total)
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
    </motion.div>
  );
}
