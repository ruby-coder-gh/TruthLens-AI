import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
} from '../components/ui';
import { adminApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { AdminStats, AuditLogEntry } from '../api/types';

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

// ─── Chart mock data ──────────────────────────────────────────────────────────

const queriesOverTimeData = [
  { month: 'Jan', queries: 420 },
  { month: 'Feb', queries: 580 },
  { month: 'Mar', queries: 490 },
  { month: 'Apr', queries: 720 },
  { month: 'May', queries: 640 },
  { month: 'Jun', queries: 890 },
];

const trustScoreDistributionData = [
  { range: '0–0.2', count: 12 },
  { range: '0.2–0.4', count: 28 },
  { range: '0.4–0.6', count: 45 },
  { range: '0.6–0.8', count: 72 },
  { range: '0.8–1.0', count: 93 },
];

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

function trustScoreColor(score: number | undefined): string {
  if (score === undefined || score === null) return 'var(--color-text-dim)';
  if (score >= 0.75) return 'var(--color-green)';
  if (score >= 0.5) return 'var(--color-orange)';
  return 'var(--color-red)';
}

function trustScoreBadgeColor(score: number | undefined): 'green' | 'orange' | 'red' | 'gray' {
  if (score === undefined || score === null) return 'gray';
  if (score >= 0.75) return 'green';
  if (score >= 0.5) return 'orange';
  return 'red';
}

function evalScoreColor(value: number): string {
  if (value >= 0.8) return 'var(--color-green)';
  if (value >= 0.6) return 'var(--color-orange)';
  return 'var(--color-red)';
}

function countUp(end: number, duration = 1200): number {
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
      <div className="flex flex-col items-center text-center max-w-md">
        <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-red/10 border border-red/20">
          <Lock size={36} className="text-red" />
        </div>
        <h2 className="text-2xl font-bold text-text">Access Denied</h2>
        <p className="mt-2 text-sm text-text-muted">
          You do not have the required permissions to view this page. Only
          administrators can access the dashboard.
        </p>
        <Badge color="red" className="mt-4">Admin only</Badge>
      </div>
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
  const animated = countUp(value);

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-border/60 p-5 lg:p-6 ${gradient}`}
    >
      <div className="flex items-start justify-between">
        <div className="z-10">
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
      {/* Decorative circle */}
      <div className="absolute -bottom-6 -right-6 h-24 w-24 rounded-full bg-white/5" />
    </div>
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
    <Card className="flex items-center gap-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-card-2 text-primary-soft">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-text-muted truncate">{label}</p>
        {children ?? (
          <p className="text-xl font-bold text-text tabular-nums">{value}</p>
        )}
      </div>
    </Card>
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

/** Loading skeleton grid */
function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Overview skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-border bg-card p-5 lg:p-6"
          >
            <Skeleton height={14} width="50%" className="mb-3" />
            <Skeleton height={36} width="60%" className="mb-2" />
            <Skeleton height={12} width="40%" />
          </div>
        ))}
      </div>
      {/* Secondary skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-border bg-card p-5 lg:p-6"
          >
            <Skeleton height={14} width="40%" className="mb-2" />
            <Skeleton height={24} width="30%" />
          </div>
        ))}
      </div>
      {/* Charts skeleton */}
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-border bg-card p-5 lg:p-6"
          >
            <Skeleton height={20} width="40%" className="mb-4" />
            <Skeleton height={200} width="100%" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Error banner with retry */
function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center py-20 text-center animate-fadeIn"
      role="alert"
    >
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red/15 text-red">
        <AlertTriangle size={28} />
      </div>
      <h3 className="text-lg font-semibold text-text">Failed to load dashboard</h3>
      <p className="mt-1 max-w-md text-sm text-text-muted">{message}</p>
      <Button variant="secondary" className="mt-6" onClick={onRetry}>
        <RefreshCw size={16} />
        Try again
      </Button>
    </div>
  );
}

/** Charts section with mock data overlay */
function ChartsSection() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Line chart */}
      <Card className="relative">
        <div className="mb-4 flex items-center gap-2">
          <Activity size={18} className="text-primary-soft" />
          <h3 className="text-sm font-semibold text-text">Queries over time</h3>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={queriesOverTimeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2b3548" />
              <XAxis dataKey="month" stroke="#6b7888" fontSize={12} />
              <YAxis stroke="#6b7888" fontSize={12} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1b2230',
                  border: '1px solid #2b3548',
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
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-card/60 backdrop-blur-[2px]">
          <Badge color="gray" className="px-3 py-1 text-xs">
            Coming soon with real data
          </Badge>
        </div>
      </Card>

      {/* Bar chart */}
      <Card className="relative">
        <div className="mb-4 flex items-center gap-2">
          <BarChart3 size={18} className="text-accent" />
          <h3 className="text-sm font-semibold text-text">
            Trust score distribution
          </h3>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trustScoreDistributionData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2b3548" />
              <XAxis dataKey="range" stroke="#6b7888" fontSize={12} />
              <YAxis stroke="#6b7888" fontSize={12} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1b2230',
                  border: '1px solid #2b3548',
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
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-card/60 backdrop-blur-[2px]">
          <Badge color="gray" className="px-3 py-1 text-xs">
            Coming soon with real data
          </Badge>
        </div>
      </Card>
    </div>
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
      <div className="py-8">
        <LoadingSpinner text="Loading audit logs..." />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <AlertTriangle size={24} className="text-red mb-3" />
        <p className="text-sm text-text-muted">{errorMessage}</p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw size={14} />
          Retry
        </Button>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <EmptyState
        icon={<Search size={24} />}
        title="No audit logs found"
        description={
          actionFilter
            ? `No logs with action "${actionFilter}". Try a different filter.`
            : 'No audit logs recorded yet.'
        }
      />
    );
  }

  return (
    <div>
      {/* Filter row */}
      <div className="mb-4 flex items-center gap-3">
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
            className="w-44 appearance-none rounded-lg border border-border bg-bg-soft px-3 py-2 pl-9 pr-8 text-sm text-text transition-colors focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
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
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-card-2">
              <th className="px-4 py-3 font-medium text-text-muted w-10" />
              <th className="px-4 py-3 font-medium text-text-muted">Timestamp</th>
              <th className="px-4 py-3 font-medium text-text-muted">User ID</th>
              <th className="px-4 py-3 font-medium text-text-muted">Action</th>
              <th className="px-4 py-3 font-medium text-text-muted">Resource</th>
              <th className="px-4 py-3 font-medium text-text-muted">Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((entry) => {
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Expanded detail row — rendered outside table but follows last entry */}
      {expandedId && (() => {
        const entry = logs.find((e) => e.id === expandedId);
        if (!entry?.details) return null;
        return (
          <div className="mt-2 rounded-lg border border-primary/20 bg-card-2 p-4 animate-fadeIn">
            <div className="mb-2 flex items-center gap-2">
              <Shield size={14} className="text-primary-soft" />
              <span className="text-xs font-medium text-text-muted">
                Full details
              </span>
            </div>
            <pre className="overflow-x-auto text-xs text-text leading-relaxed whitespace-pre-wrap font-mono">
              {JSON.stringify(entry.details, null, 2)}
            </pre>
          </div>
        );
      })()}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
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
        </div>
      )}
    </div>
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
      <div className="py-8">
        <LoadingSpinner text="Loading evaluation metrics..." />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <AlertTriangle size={24} className="text-red mb-3" />
        <p className="text-sm text-text-muted">{errorMessage}</p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw size={14} />
          Retry
        </Button>
      </div>
    );
  }

  if (!metrics) {
    return (
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
    );
  }

  const scoreEntries: { label: string; value: number; key: string }[] = [
    { label: 'Faithfulness', value: metrics.faithfulness, key: 'faithfulness' },
    { label: 'Answer Relevance', value: metrics.answer_relevance, key: 'answer_relevance' },
    { label: 'Context Precision', value: metrics.context_precision, key: 'context_precision' },
    { label: 'Context Recall', value: metrics.context_recall, key: 'context_recall' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
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
      </div>

      {/* Score cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {scoreEntries.map((entry) => {
          const pct = Math.round(entry.value * 100);
          return (
            <Card key={entry.key}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-text">
                  {entry.label}
                </span>
                <span
                  className="text-lg font-bold tabular-nums"
                  style={{ color: evalScoreColor(entry.value) }}
                >
                  {pct}%
                </span>
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
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{
                    width: `${pct}%`,
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
          );
        })}
      </div>
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
    return <LoadingSkeleton />;
  }

  // ─── Error state (stats) ──────────────────────────────────────────────────

  if (statsQuery.isError) {
    return (
      <ErrorBanner
        message={
          statsQuery.error instanceof Error
            ? statsQuery.error.message
            : 'An unexpected error occurred'
        }
        onRetry={() => statsQuery.refetch()}
      />
    );
  }

  // ─── Success ───────────────────────────────────────────────────────────────

  const stats = statsQuery.data as AdminStats;
  const logsData = logsQuery.data;
  const logs = logsData?.data ?? [];
  const totalLogs = logsData?.meta?.total ?? 0;
  const totalLogPages = Math.max(1, Math.ceil(totalLogs / PAGE_SIZE));

  return (
    <div className="animate-fadeIn space-y-6">
      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Admin Dashboard</h1>
          <p className="text-sm text-text-muted">
            System overview and management
          </p>
        </div>
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
      </div>

      {/* ── Overview stat cards ───────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
      </div>

      {/* ── Secondary stat cards ──────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Avg Trust Score */}
        <SecondaryStatCard
          icon={<Shield size={20} />}
          label="Avg Trust Score"
        >
          <div className="flex items-center gap-2">
            <span
              className="text-xl font-bold tabular-nums"
              style={{ color: trustScoreColor(stats.avg_trust_score) }}
            >
              {stats.avg_trust_score !== undefined
                ? stats.avg_trust_score.toFixed(2)
                : 'N/A'}
            </span>
            {stats.avg_trust_score !== undefined && (
              <Badge color={trustScoreBadgeColor(stats.avg_trust_score)}>
                {stats.avg_trust_score >= 0.75
                  ? 'Good'
                  : stats.avg_trust_score >= 0.5
                    ? 'Fair'
                    : 'Poor'}
              </Badge>
            )}
          </div>
        </SecondaryStatCard>

        {/* Avg Rating */}
        <SecondaryStatCard
          icon={<Star size={20} />}
          label="Avg Rating"
        >
          <div className="flex items-center gap-2">
            {stats.avg_rating !== undefined ? (
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
      </div>

      {/* ── Charts ─────────────────────────────────────────────────────────── */}
      <ChartsSection />

      {/* ── Tabs: Audit Logs / Evaluation ──────────────────────────────────── */}
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
          {activeTab === 'audit-logs' && (
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
          )}
          {activeTab === 'evaluation' && (
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
          )}
        </div>
      </Card>
    </div>
  );
}
