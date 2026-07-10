import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Users,
  FolderOpen,
  FileText,
  MessageSquare,
  Star,
  Shield,
  Activity,
  BarChart3,
  RefreshCw,
  Search,
  Filter,
  AlertTriangle,
  Lock,
  ChevronDown,
  ChevronUp,
  Play,
  Clock,
  Database,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import {
  Button,
  Card,
  Badge,
  Tabs,
  LoadingSpinner,
  Skeleton,
  EmptyState,
  useToast,
  staggerContainer,
  staggerItem,
  fadeIn,
  pageTransition,
  fadeInScale,
} from '../components/ui';
import { PageHeader, PageShell, StateBlock } from '../components/PageWrappers';
import { adminApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { AdminStats, AuditLogEntry } from '../api/types';
import { getSafeLabel, getTrustBadgeColor, getTrustColorVar, getTrustStatusLabel } from '../utils/relevance';

// ─── Local types ──────────────────────────────────────────────────────────────

interface EvaluationMetrics {
  faithfulness: number;
  answer_relevance: number;
  context_precision: number;
  context_recall: number;
  updated_at?: string;
}

interface ActionFilterOption {
  value: string;
  label: string;
}

interface QueriesOverTimePoint {
  month: string;
  queries: number;
}

interface TrustScoreBucket {
  range: string;
  count: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACTION_FILTERS: ActionFilterOption[] = [
  { value: '', label: 'All actions' },
  { value: 'create', label: 'Create' },
  { value: 'read', label: 'Read' },
  { value: 'update', label: 'Update' },
  { value: 'delete', label: 'Delete' },
  { value: 'login', label: 'Login' },
  { value: 'logout', label: 'Logout' },
  { value: 'export', label: 'Export' },
];

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function evalScoreColor(value: number): string {
  if (value >= 0.8) return 'var(--color-green)';
  if (value >= 0.6) return 'var(--color-orange)';
  return 'var(--color-red)';
}

function useCountUp(end: number, duration = 1200): number {
  const [count, setCount] = useState(0);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    let startTime: number | null = null;
    const animate = (time: number) => {
      if (startTime === null) startTime = time;
      const elapsed = time - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * end));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      }
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [end, duration]);

  return count;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Full-screen access denied gate */
function AccessDenied() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <motion.div
        className="flex flex-col items-center text-center max-w-md"
        variants={fadeInScale}
        initial="initial"
        animate="animate"
      >
        <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-2xl glass border border-red/20">
          <Lock size={36} className="text-red" />
        </div>
        <h2 className="text-2xl font-bold text-text">Access Denied</h2>
        <p className="mt-2 text-sm text-text-muted">
          You do not have the required permissions to view this page. Only
          administrators can access the dashboard.
        </p>
        <Badge color="red" className="mt-4">Admin only</Badge>
      </motion.div>
    </div>
  );
}

/** Big metric card with gradient background */
function StatCard({
  icon,
  label,
  value,
  gradient,
  trend,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  gradient: string;
  trend?: { direction: 'up' | 'down'; percent: number };
}) {
  const animated = useCountUp(value);

  return (
    <motion.div
      variants={staggerItem}
      className={`relative overflow-hidden rounded-xl border border-border/60 p-5 lg:p-6 ${gradient}`}
    >
      {/* Ambient glow */}
      <div className="pointer-events-none absolute -inset-1 bg-white/[0.04] blur-2xl" />
      <div className="relative z-10 flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-white/70">
            {label}
          </p>
          <p className="mt-1.5 text-3xl font-bold text-white tabular-nums">
            {animated.toLocaleString()}
          </p>
          {trend && (
            <div className="mt-2 flex items-center gap-1 text-xs font-medium">
              {trend.direction === 'up' ? (
                <TrendingUp size={14} className="text-green" />
              ) : (
                <TrendingDown size={14} className="text-red" />
              )}
              <span
                className={
                  trend.direction === 'up' ? 'text-green' : 'text-red'
                }
              >
                {trend.percent}%
              </span>
              <span className="text-white/50">vs last month</span>
            </div>
          )}
        </div>
        <div className="z-10 flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm">
          {icon}
        </div>
      </div>
      {/* Decorative circles */}
      <div className="pointer-events-none absolute -bottom-6 -right-6 h-24 w-24 rounded-full bg-white/5" />
      <div className="pointer-events-none absolute -top-8 -left-8 h-16 w-16 rounded-full bg-white/[0.03]" />
    </motion.div>
  );
}

/** Smaller secondary stat card */
function SecondaryStatCard({
  icon,
  label,
  value,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string | number;
  children?: React.ReactNode;
}) {
  return (
    <motion.div variants={staggerItem}>
      <Card className="flex items-center gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg glass text-primary-soft">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-text-muted truncate">{label}</p>
          {children ?? (
            <p className="text-xl font-bold text-text tabular-nums">{value}</p>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

/** Star rating display */
function StarRating({ rating, max = 5 }: { rating: number; max?: number }) {
  const full = Math.floor(rating);
  const fraction = rating - full;
  const empty = max - full - (fraction > 0 ? 1 : 0);

  return (
    <div className="flex items-center gap-0.5" aria-label={`Rating: ${rating.toFixed(1)} out of ${max}`}>
      {Array.from({ length: full }).map((_, i) => (
        <Star
          key={`full-${i}`}
          size={16}
          className="text-gold fill-gold"
        />
      ))}
      {fraction > 0 && (
        <span className="relative">
          <Star size={16} className="text-text-dim" />
          <span
            className="absolute inset-0 overflow-hidden"
            style={{ width: `${fraction * 100}%` }}
          >
            <Star size={16} className="text-gold fill-gold" />
          </span>
        </span>
      )}
      {Array.from({ length: empty }).map((_, i) => (
        <Star key={`empty-${i}`} size={16} className="text-text-dim" />
      ))}
    </div>
  );
}

/** Chart loading skeleton */
function ChartSkeleton() {
  return (
    <div className="h-64 flex items-center justify-center">
      <div className="w-full space-y-3 px-4">
        <Skeleton height={14} width="30%" className="mb-6" />
        <Skeleton height={160} width="100%" />
      </div>
    </div>
  );
}

/** Charts section connected to real API data */
function ChartsSection({
  queriesData,
  queriesLoading,
  queriesError,
  trustData,
  trustLoading,
  trustError,
  onRetryQueries,
  onRetryTrust,
}: {
  queriesData: QueriesOverTimePoint[] | undefined;
  queriesLoading: boolean;
  queriesError: boolean;
  trustData: TrustScoreBucket[] | undefined;
  trustLoading: boolean;
  trustError: boolean;
  onRetryQueries: () => void;
  onRetryTrust: () => void;
}) {
  return (
    <motion.div
      className="grid gap-4 lg:grid-cols-2"
      variants={staggerContainer}
      initial="initial"
      animate="animate"
    >
      {/* Line chart */}
      <motion.div variants={staggerItem}>
        <Card>
          <div className="mb-4 flex items-center gap-2">
            <Activity size={18} className="text-primary-soft" />
            <h3 className="text-sm font-semibold text-text">Queries over time</h3>
          </div>
          {queriesLoading ? (
            <ChartSkeleton />
          ) : queriesError ? (
            <div className="flex h-64 flex-col items-center justify-center text-center">
              <AlertTriangle size={20} className="text-red mb-2" />
              <p className="text-xs text-text-muted mb-3">Failed to load chart data</p>
              <Button variant="secondary" size="sm" onClick={onRetryQueries}>
                <RefreshCw size={14} />
                Retry
              </Button>
            </div>
          ) : !queriesData || queriesData.length === 0 ? (
            <div className="h-64 flex items-center justify-center">
              <EmptyState
                icon={<Activity size={20} />}
                title="No data yet"
                description="Queries over time will appear here once users start submitting queries."
              />
            </div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={queriesData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2b3548" />
                  <XAxis dataKey="month" stroke="#6b7888" fontSize={12} />
                  <YAxis stroke="#6b7888" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(27, 34, 48, 0.85)',
                      backdropFilter: 'blur(8px)',
                      border: '1px solid rgba(100, 120, 170, 0.15)',
                      borderRadius: '8px',
                      color: '#e6edf3',
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="queries"
                    stroke="#7c5cff"
                    strokeWidth={2}
                    dot={{ fill: '#7c5cff', r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </motion.div>

      {/* Bar chart */}
      <motion.div variants={staggerItem}>
        <Card>
          <div className="mb-4 flex items-center gap-2">
            <BarChart3 size={18} className="text-accent" />
            <h3 className="text-sm font-semibold text-text">
              Trust score distribution
            </h3>
          </div>
          {trustLoading ? (
            <ChartSkeleton />
          ) : trustError ? (
            <div className="flex h-64 flex-col items-center justify-center text-center">
              <AlertTriangle size={20} className="text-red mb-2" />
              <p className="text-xs text-text-muted mb-3">Failed to load chart data</p>
              <Button variant="secondary" size="sm" onClick={onRetryTrust}>
                <RefreshCw size={14} />
                Retry
              </Button>
            </div>
          ) : !trustData || trustData.length === 0 ? (
            <div className="h-64 flex items-center justify-center">
              <EmptyState
                icon={<BarChart3 size={20} />}
                title="No data yet"
                description="Trust score distribution will appear here once queries have been scored."
              />
            </div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trustData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2b3548" />
                  <XAxis dataKey="range" stroke="#6b7888" fontSize={12} />
                  <YAxis stroke="#6b7888" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(27, 34, 48, 0.85)',
                      backdropFilter: 'blur(8px)',
                      border: '1px solid rgba(100, 120, 170, 0.15)',
                      borderRadius: '8px',
                      color: '#e6edf3',
                    }}
                  />
                  <Bar
                    dataKey="count"
                    fill="#2dd4bf"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </motion.div>
    </motion.div>
  );
}

/** Audit logs table tab */
function AuditLogsTab({
  logs,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  page,
  totalPages,
  total,
  actionFilter,
  onActionFilterChange,
  onPageChange,
}: {
  logs: AuditLogEntry[];
  isLoading: boolean;
  isError: boolean;
  errorMessage: string;
  onRetry: () => void;
  page: number;
  totalPages: number;
  total: number;
  actionFilter: string;
  onActionFilterChange: (v: string) => void;
  onPageChange: (p: number) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  if (isLoading) {
    return (
      <motion.div
        className="py-8"
        variants={fadeIn}
        initial="initial"
        animate="animate"
      >
        <LoadingSpinner text="Loading audit logs..." />
      </motion.div>
    );
  }

  if (isError) {
    return (
      <motion.div
        className="flex flex-col items-center py-12 text-center"
        variants={fadeIn}
        initial="initial"
        animate="animate"
      >
        <AlertTriangle size={24} className="text-red mb-3" />
        <p className="text-sm text-text-muted">{errorMessage}</p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw size={14} />
          Retry
        </Button>
      </motion.div>
    );
  }

  if (logs.length === 0) {
    return (
      <motion.div
        variants={fadeIn}
        initial="initial"
        animate="animate"
      >
        <EmptyState
          icon={<Search size={24} />}
          title="No audit logs found"
          description={
            actionFilter
              ? `No logs with action "${actionFilter}". Try a different filter.`
              : 'No audit logs recorded yet.'
          }
        />
      </motion.div>
    );
  }

  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
    >
      {/* Filter row */}
      <motion.div className="mb-4 flex items-center gap-3" variants={staggerItem}>
        <div className="relative">
          <Filter
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-dim"
          />
          <select
            value={actionFilter}
            onChange={(e) => {
              onActionFilterChange(e.target.value);
              onPageChange(1);
            }}
            className="w-44 appearance-none rounded-lg border border-border bg-bg-soft/80 backdrop-blur-sm px-3 py-2 pl-9 pr-8 text-sm text-text transition-colors focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
            aria-label="Filter by action type"
          >
            {ACTION_FILTERS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-dim"
          />
        </div>
        <p className="text-xs text-text-muted">
          {total} log{total !== 1 ? 's' : ''}
        </p>
      </motion.div>

      {/* Table */}
      <motion.div
        className="overflow-x-auto rounded-lg border border-border glass"
        variants={staggerItem}
      >
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-card-2/80">
              <th className="px-4 py-3 font-medium text-text-muted w-10" />
              <th className="px-4 py-3 font-medium text-text-muted">Timestamp</th>
              <th className="px-4 py-3 font-medium text-text-muted">User ID</th>
              <th className="px-4 py-3 font-medium text-text-muted">Action</th>
              <th className="px-4 py-3 font-medium text-text-muted">Resource</th>
              <th className="px-4 py-3 font-medium text-text-muted">Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((entry, idx) => {
              const isExpanded = expandedId === entry.id;
              return (
                <motion.tr
                  key={entry.id}
                  variants={staggerItem}
                  className="border-b border-border last:border-b-0 transition-colors hover:bg-card-2/50"
                  initial="initial"
                  animate="animate"
                  custom={idx}
                >
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleExpand(entry.id)}
                      className="flex items-center justify-center text-text-dim hover:text-text transition-colors"
                      aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? (
                        <ChevronUp size={16} />
                      ) : (
                        <ChevronDown size={16} />
                      )}
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-text tabular-nums">
                    {formatTimestamp(entry.created_at)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-text-muted">
                    {entry.user_id.length > 12
                      ? `${entry.user_id.slice(0, 12)}...`
                      : entry.user_id}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      color={
                        entry.action === 'delete'
                          ? 'red'
                          : entry.action === 'create'
                            ? 'green'
                            : entry.action === 'update'
                              ? 'orange'
                              : 'blue'
                      }
                    >
                      {entry.action}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-text-muted">
                      {entry.resource_type}
                    </span>
                    {entry.resource_id && (
                      <span className="ml-1 font-mono text-xs text-text-dim">
                        #{entry.resource_id.slice(0, 8)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-dim text-xs max-w-[200px] truncate">
                    {entry.details
                      ? JSON.stringify(entry.details).slice(0, 60)
                      : '—'}
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </motion.div>

      {/* Expanded detail row — rendered outside table but follows last entry */}
      <AnimatePresence>
        {expandedId && (() => {
          const entry = logs.find((e) => e.id === expandedId);
          if (!entry?.details) return null;
          return (
            <motion.div
              key="expanded-detail"
              className="mt-2 rounded-lg border border-primary/20 glass p-4"
              variants={fadeInScale}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <div className="mb-2 flex items-center gap-2">
                <Shield size={14} className="text-primary-soft" />
                <span className="text-xs font-medium text-text-muted">
                  Full details
                </span>
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
        <motion.div
          className="mt-4 flex items-center justify-between"
          variants={staggerItem}
        >
          <p className="text-xs text-text-muted">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              Next
            </Button>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

/** Evaluation metrics tab */
function EvaluationTab({
  metrics,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  isRunning,
  onRunEvaluation,
}: {
  metrics: EvaluationMetrics | undefined;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string;
  onRetry: () => void;
  isRunning: boolean;
  onRunEvaluation: () => void;
}) {
  if (isLoading) {
    return (
      <motion.div
        className="py-8"
        variants={fadeIn}
        initial="initial"
        animate="animate"
      >
        <LoadingSpinner text="Loading evaluation metrics..." />
      </motion.div>
    );
  }

  if (isError) {
    return (
      <motion.div
        className="flex flex-col items-center py-12 text-center"
        variants={fadeIn}
        initial="initial"
        animate="animate"
      >
        <AlertTriangle size={24} className="text-red mb-3" />
        <p className="text-sm text-text-muted">{errorMessage}</p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw size={14} />
          Retry
        </Button>
      </motion.div>
    );
  }

  if (!metrics) {
    return (
      <motion.div
        variants={fadeIn}
        initial="initial"
        animate="animate"
      >
        <EmptyState
          icon={<BarChart3 size={24} />}
          title="No evaluation data"
          description="Run an evaluation to see RAGAS metrics for your system."
          action={
            <Button onClick={onRunEvaluation} loading={isRunning}>
              <Play size={16} />
              Run Evaluation
            </Button>
          }
        />
      </motion.div>
    );
  }

  const scoreEntries: { label: string; value: number; key: string }[] = [
    { label: 'Faithfulness', value: metrics.faithfulness, key: 'faithfulness' },
    { label: 'Answer Relevance', value: metrics.answer_relevance, key: 'answer_relevance' },
    { label: 'Context Precision', value: metrics.context_precision, key: 'context_precision' },
    { label: 'Context Recall', value: metrics.context_recall, key: 'context_recall' },
  ];

  return (
    <motion.div
      className="space-y-6"
      variants={staggerContainer}
      initial="initial"
      animate="animate"
    >
      {/* Header */}
      <motion.div className="flex items-center justify-between" variants={staggerItem}>
        <div>
          <h4 className="text-sm font-semibold text-text">RAGAS Evaluation Metrics</h4>
          {metrics.updated_at && (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted">
              <Clock size={12} />
              Last updated: {formatTimestamp(metrics.updated_at)}
            </p>
          )}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={onRunEvaluation}
          loading={isRunning}
        >
          <Play size={14} />
          Run Evaluation
        </Button>
      </motion.div>

      {/* Score cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {scoreEntries.map((entry) => {
          const pct = Math.round(entry.value * 100);
          return (
            <motion.div key={entry.key} variants={staggerItem}>
              <Card>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-text">
                    {entry.label}
                  </span>
                  <motion.span
                    className="text-lg font-bold tabular-nums"
                    style={{ color: evalScoreColor(entry.value) }}
                    initial={{ opacity: 0.99, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4, delay: 0.2, ease: [0.16, 1, 0.3, 1] as const }}
                  >
                    {pct}%
                  </motion.span>
                </div>
                {/* Custom progress bar */}
                <div
                  className="h-2.5 w-full overflow-hidden rounded-full bg-card-2"
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${entry.label}: ${pct}%`}
                >
                  <motion.div
                    className="h-full rounded-full"
                    initial={{ width: '0%' }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.8, delay: 0.3, ease: [0.16, 1, 0.3, 1] as const }}
                    style={{
                      background: `linear-gradient(90deg, ${evalScoreColor(entry.value)}, ${
                        entry.value >= 0.8
                          ? 'var(--color-accent)'
                          : entry.value >= 0.6
                            ? 'var(--color-gold)'
                            : 'var(--color-red)'
                      })`,
                    }}
                  />
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ─── Background ambient blobs ─────────────────────────────────────────────────

function AmbientBlobs() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-primary/5 blur-[120px]" />
      <div className="absolute top-1/3 -right-40 h-[400px] w-[400px] rounded-full bg-accent/5 blur-[100px]" />
      <div className="absolute -bottom-40 left-1/3 h-[450px] w-[450px] rounded-full bg-accent-2/5 blur-[110px]" />
      <div className="absolute top-2/3 left-1/4 h-[300px] w-[300px] rounded-full bg-gold/5 blur-[90px]" />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { addToast } = useToast();

  // Tab state
  const [activeTab, setActiveTab] = useState('audit-logs');

  // Audit log pagination + filter
  const [logPage, setLogPage] = useState(1);
  const [logActionFilter, setLogActionFilter] = useState('');
  const PAGE_SIZE = 20;

  // ─── Queries ──────────────────────────────────────────────────────────────

  const statsQuery = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => adminApi.stats(),
  });

  const logsQuery = useQuery({
    queryKey: ['admin', 'logs', logPage, logActionFilter],
    queryFn: () =>
      adminApi.logs({
        page: logPage,
        page_size: PAGE_SIZE,
        ...(logActionFilter ? { action: logActionFilter } : {}),
      }),
  });

  const evalQuery = useQuery({
    queryKey: ['admin', 'evaluation'],
    queryFn: () => adminApi.evaluation<EvaluationMetrics>(),
  });

  const queriesOverTimeQuery = useQuery({
    queryKey: ['admin', 'queries-over-time'],
    queryFn: () => adminApi.getQueriesOverTime(),
  });

  const trustDistributionQuery = useQuery({
    queryKey: ['admin', 'trust-distribution'],
    queryFn: () => adminApi.getTrustScoreDistribution(),
  });

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const runEvalMutation = useMutation({
    mutationFn: () => adminApi.runEvaluation<EvaluationMetrics>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'evaluation'] });
      addToast('Evaluation completed successfully', 'success');
    },
    onError: (err: Error) => {
      addToast(err.message || 'Evaluation failed', 'error');
    },
  });

  // ─── Admin gate ────────────────────────────────────────────────────────────

  if (!user || user.role !== 'admin') {
    return <AccessDenied />;
  }

  // ─── Loading state (initial) ───────────────────────────────────────────────

  if (statsQuery.isLoading) {
    return (
      <motion.div variants={pageTransition} initial="initial" animate="animate">
        <PageShell>
          <PageHeader title="Admin Dashboard" description="System overview and management." />
          <StateBlock role="status">Loading dashboard…</StateBlock>
        </PageShell>
      </motion.div>
    );
  }

  // ─── Error state (stats) ──────────────────────────────────────────────────

  if (statsQuery.isError) {
    return (
      <motion.div variants={pageTransition} initial="initial" animate="animate">
        <PageShell>
          <PageHeader title="Admin Dashboard" description="System overview and management." />
          <StateBlock tone="danger" role="alert" className="space-y-3">
            <p>{statsQuery.error instanceof Error ? statsQuery.error.message : 'Failed to load dashboard.'}</p>
            <Button variant="secondary" size="sm" onClick={() => statsQuery.refetch()}>
              <RefreshCw size={16} />
              Try again
            </Button>
          </StateBlock>
        </PageShell>
      </motion.div>
    );
  }

  // ─── Success ───────────────────────────────────────────────────────────────

  const stats = statsQuery.data as AdminStats;
  const logsData = logsQuery.data;
  const logs = logsData?.data ?? [];
  const totalLogs = logsData?.meta?.total ?? 0;
  const totalLogPages = Math.max(1, Math.ceil(totalLogs / PAGE_SIZE));

  const queriesData = queriesOverTimeQuery.data as QueriesOverTimePoint[] | undefined;
  const trustData = trustDistributionQuery.data as TrustScoreBucket[] | undefined;

  return (
    <>
      <AmbientBlobs />
      <motion.div
        className="relative z-0"
        variants={pageTransition}
        initial="initial"
        animate="animate"
      >
        <PageShell className="space-y-6">
        {/* ── Page header ───────────────────────────────────────────────────── */}
        <motion.div
          variants={fadeIn}
          initial="initial"
          animate="animate"
        >
          <PageHeader
            title="Admin Dashboard"
            description="System overview and management"
            actions={(
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  statsQuery.refetch();
                  addToast('Dashboard refreshed', 'info');
                }}
              >
                <RefreshCw size={16} />
                Refresh
              </Button>
            )}
          />
        </motion.div>

        {/* ── Overview stat cards ───────────────────────────────────────────── */}
        <motion.div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          variants={staggerContainer}
          initial="initial"
          animate="animate"
        >
          <StatCard
            icon={<Users size={22} className="text-white" />}
            label="Total Users"
            value={stats.total_users}
            gradient="bg-gradient-to-br from-primary/80 to-primary-dark/80"
            trend={{ direction: 'up', percent: 12 }}
          />
          <StatCard
            icon={<FolderOpen size={22} className="text-white" />}
            label="Total Workspaces"
            value={stats.total_workspaces}
            gradient="bg-gradient-to-br from-accent/80 to-accent/60"
            trend={{ direction: 'up', percent: 8 }}
          />
          <StatCard
            icon={<FileText size={22} className="text-white" />}
            label="Total Documents"
            value={stats.total_documents}
            gradient="bg-gradient-to-br from-accent-2/80 to-accent-2/60"
            trend={{ direction: 'up', percent: 15 }}
          />
          <StatCard
            icon={<MessageSquare size={22} className="text-white" />}
            label="Total Queries"
            value={stats.total_queries}
            gradient="bg-gradient-to-br from-gold/70 to-gold/50"
            trend={{ direction: 'up', percent: 23 }}
          />
        </motion.div>

        {/* ── Secondary stat cards ──────────────────────────────────────────── */}
        <motion.div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          variants={staggerContainer}
          initial="initial"
          animate="animate"
        >
          {/* Avg Trust Score */}
          <SecondaryStatCard
            icon={<Shield size={20} />}
            label="Avg Trust Score"
          >
            <div className="flex items-center gap-2">
              <span
                className="text-xl font-bold tabular-nums"
                style={{ color: getTrustColorVar(stats.avg_trust_score) }}
              >
                {stats.avg_trust_score != null
                  ? stats.avg_trust_score.toFixed(2)
                  : 'N/A'}
              </span>
              <Badge color={stats.avg_trust_score == null ? 'gray' : getTrustBadgeColor(stats.avg_trust_score)}>
                {getSafeLabel(
                  stats.avg_trust_score == null
                    ? 'Unknown'
                    : getTrustStatusLabel(stats.avg_trust_score),
                )}
              </Badge>
            </div>
          </SecondaryStatCard>

          {/* Avg Rating */}
          <SecondaryStatCard
            icon={<Star size={20} />}
            label="Avg Rating"
          >
            <div className="flex items-center gap-2">
              {stats.avg_rating != null ? (
                <>
                  <span className="text-xl font-bold text-text tabular-nums">
                    {stats.avg_rating.toFixed(1)}
                  </span>
                  <StarRating rating={stats.avg_rating} />
                </>
              ) : (
                <span className="text-sm text-text-dim">No ratings yet</span>
              )}
            </div>
          </SecondaryStatCard>

          {/* Total Feedback */}
          <SecondaryStatCard
            icon={<MessageSquare size={20} />}
            label="Total Feedback"
            value={stats.total_feedback.toLocaleString()}
          />

          {/* Total Chunks */}
          <SecondaryStatCard
            icon={<Database size={20} />}
            label="Total Chunks Indexed"
            value={stats.total_chunks.toLocaleString()}
          />
        </motion.div>

        {/* ── Charts ─────────────────────────────────────────────────────────── */}
        <ChartsSection
          queriesData={queriesData}
          queriesLoading={queriesOverTimeQuery.isLoading}
          queriesError={queriesOverTimeQuery.isError}
          trustData={trustData}
          trustLoading={trustDistributionQuery.isLoading}
          trustError={trustDistributionQuery.isError}
          onRetryQueries={() => queriesOverTimeQuery.refetch()}
          onRetryTrust={() => trustDistributionQuery.refetch()}
        />

        {/* ── Tabs: Audit Logs / Evaluation ──────────────────────────────────── */}
        <motion.div variants={fadeIn} initial="initial" animate="animate">
          <Card className="p-0 overflow-hidden">
            <Tabs
              tabs={[
                { id: 'audit-logs', label: 'Audit Logs', icon: <Activity size={16} /> },
                { id: 'evaluation', label: 'Evaluation', icon: <BarChart3 size={16} /> },
              ]}
              activeTab={activeTab}
              onChange={setActiveTab}
              className="px-4 pt-2"
            />
            <div className="p-4 lg:p-6">
              <AnimatePresence mode="wait">
                {activeTab === 'audit-logs' && (
                  <motion.div
                    key="audit-logs"
                    variants={pageTransition}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                  >
                    <AuditLogsTab
                      logs={logs}
                      isLoading={logsQuery.isLoading}
                      isError={logsQuery.isError}
                      errorMessage={
                        logsQuery.error instanceof Error
                          ? logsQuery.error.message
                          : 'Failed to load logs'
                      }
                      onRetry={() => logsQuery.refetch()}
                      page={logPage}
                      totalPages={totalLogPages}
                      total={totalLogs}
                      actionFilter={logActionFilter}
                      onActionFilterChange={setLogActionFilter}
                      onPageChange={setLogPage}
                    />
                  </motion.div>
                )}
                {activeTab === 'evaluation' && (
                  <motion.div
                    key="evaluation"
                    variants={pageTransition}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                  >
                    <EvaluationTab
                      metrics={evalQuery.data}
                      isLoading={evalQuery.isLoading}
                      isError={evalQuery.isError}
                      errorMessage={
                        evalQuery.error instanceof Error
                          ? evalQuery.error.message
                          : 'Failed to load evaluation'
                      }
                      onRetry={() => evalQuery.refetch()}
                      isRunning={runEvalMutation.isPending}
                      onRunEvaluation={() => runEvalMutation.mutate()}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </Card>
        </motion.div>
        </PageShell>
      </motion.div>
    </>
  );
}
