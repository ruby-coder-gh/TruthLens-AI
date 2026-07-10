import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
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
  Cell,
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Clock3,
  MessageSquare,
  Shield,
  TrendingUp,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Tabs,
  pageTransition,
  staggerContainer,
  staggerItem,
} from '../components/ui';
import { PageHeader, PageShell, StateBlock } from '../components/PageWrappers';
import { adminApi } from '../api/client';

type FlaggedAnswer = {
  id: string;
  query: string;
  score: number;
  date: string;
  workspace?: string;
  user?: string;
};

type QueriesOverTimePoint = {
  label: string;
  queries: number;
};

type TrustDistributionPoint = {
  range: string;
  count: number;
  fill: string;
};

type QualityMetric = {
  label: string;
  value: number;
  color: string;
};

const DISTRIBUTION_COLORS = ['#f87171', '#fb923c', '#fbbf24', '#2dd4bf', '#34d399'];
const QUALITY_COLORS = ['#34d399', '#2dd4bf', '#38bdf8', '#2d6bff'];

function toFiniteNumber(value: unknown, fallback = 0): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clampUnit(value: unknown): number {
  const num = toFiniteNumber(value, 0);
  if (num < 0) return 0;
  if (num > 1) return 1;
  return num;
}

function formatDateTime(value: unknown): string {
  if (value === null || value === undefined) return '—';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function formatDayLabel(value: unknown, index: number): string {
  if (value === null || value === undefined) return `#${index + 1}`;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function extractData<T>(resp: unknown): T[] {
  if (Array.isArray(resp)) return resp as T[];
  if (resp && typeof resp === 'object' && 'data' in resp) {
    return ((resp as { data?: unknown }).data as T[]) || [];
  }
  return [];
}

function formatPercent(value: number | null): string {
  if (value === null) return '—';
  return `${Math.round(value * 100)}%`;
}

function tooltipNumber(value: number | string | readonly (number | string)[] | undefined): number {
  const normalized = Array.isArray(value) ? value[0] : value;
  return Number(normalized ?? 0);
}

function isLowTrustBucket(range: string): boolean {
  const parts = range.split('-');
  if (parts.length !== 2) return false;
  const upper = toFiniteNumber(parts[1], NaN);
  return Number.isFinite(upper) && upper <= 50;
}

function getRiskMeta(score: number): { label: string; badgeColor: 'red' | 'orange' | 'gray'; barColor: string } {
  if (score < 0.25) {
    return { label: 'Critical', badgeColor: 'red', barColor: '#f87171' };
  }
  if (score < 0.4) {
    return { label: 'Elevated', badgeColor: 'orange', barColor: '#fb923c' };
  }
  return { label: 'Review', badgeColor: 'gray', barColor: '#9db0d4' };
}

function getQualityBand(value: number): { label: string; badgeColor: 'green' | 'blue' | 'orange' | 'red' } {
  if (value >= 0.85) return { label: 'Excellent', badgeColor: 'green' };
  if (value >= 0.7) return { label: 'Healthy', badgeColor: 'blue' };
  if (value >= 0.5) return { label: 'Needs Work', badgeColor: 'orange' };
  return { label: 'Critical', badgeColor: 'red' };
}

export default function AdminAnalyticsPage() {
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [flaggedAnswers, setFlaggedAnswers] = useState<FlaggedAnswer[]>([]);
  const [queriesOverTimeData, setQueriesOverTimeData] = useState<QueriesOverTimePoint[]>([]);
  const [trustScoreDistributionData, setTrustScoreDistributionData] = useState<TrustDistributionPoint[]>([]);
  const [metrics, setMetrics] = useState<QualityMetric[]>([]);
  const [latestEvalAt, setLatestEvalAt] = useState('—');

  const loadAnalytics = useCallback(async (silentRefresh: boolean) => {
    if (silentRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const [flaggedData, queriesData, trustData, evalData] = await Promise.all([
        adminApi.getFlaggedAnswers(),
        adminApi.getQueriesOverTime(),
        adminApi.getTrustScoreDistribution(),
        adminApi.getEvalHistory(),
      ]) as [unknown, unknown, unknown, unknown];

      const flaggedRaw = extractData<Record<string, unknown>>(flaggedData);
      const normalizedFlagged = flaggedRaw.map((item, idx) => ({
        id: String(item.id ?? `flagged-${idx}`),
        query: String(item.query ?? item.query_text ?? 'Untitled query'),
        score: toFiniteNumber(item.score ?? item.trust_score, 0),
        date: formatDateTime(item.date ?? item.created_at),
        workspace: item.workspace_name ? String(item.workspace_name) : undefined,
        user: item.user_name ? String(item.user_name) : undefined,
      }));
      setFlaggedAnswers(normalizedFlagged);

      const queriesRaw = extractData<Record<string, unknown>>(queriesData);
      const normalizedQueries = queriesRaw.map((item, idx) => ({
        label: formatDayLabel(item.label ?? item.month ?? item.date, idx),
        queries: Math.max(0, toFiniteNumber(item.queries ?? item.query_count, 0)),
      }));
      setQueriesOverTimeData(normalizedQueries);

      const trustRaw = extractData<Record<string, unknown>>(trustData);
      const normalizedTrust = trustRaw.map((item, idx) => ({
        range: String(item.range ?? item.bucket ?? `Bucket ${idx + 1}`),
        count: Math.max(0, toFiniteNumber(item.count, 0)),
        fill: DISTRIBUTION_COLORS[idx] || DISTRIBUTION_COLORS[DISTRIBUTION_COLORS.length - 1],
      }));
      setTrustScoreDistributionData(normalizedTrust);

      const evalRaw = extractData<Record<string, unknown>>(evalData);
      let normalizedMetrics: QualityMetric[] = [];
      let latestRun = '—';

      if (evalRaw.length > 0) {
        const latest = evalRaw[0];
        latestRun = formatDateTime(latest.run_at);

        if (
          'faithfulness' in latest ||
          'context_precision' in latest ||
          'context_recall' in latest ||
          'answer_relevance' in latest
        ) {
          normalizedMetrics = [
            { label: 'Faithfulness', value: clampUnit(latest.faithfulness), color: '#34d399' },
            { label: 'Context Precision', value: clampUnit(latest.context_precision), color: '#2dd4bf' },
            { label: 'Context Recall', value: clampUnit(latest.context_recall), color: '#38bdf8' },
            { label: 'Answer Relevance', value: clampUnit(latest.answer_relevance), color: '#2d6bff' },
          ];
        } else {
          normalizedMetrics = evalRaw
            .map((item, idx) => ({
              label: String(item.label ?? `Metric ${idx + 1}`),
              value: clampUnit(item.value),
              color: QUALITY_COLORS[idx] || QUALITY_COLORS[QUALITY_COLORS.length - 1],
            }))
            .slice(0, 4);
        }
      }

      setMetrics(normalizedMetrics);
      setLatestEvalAt(latestRun);
    } catch {
      setError('Unable to load analytics right now.');
      setFlaggedAnswers([]);
      setQueriesOverTimeData([]);
      setTrustScoreDistributionData([]);
      setMetrics([]);
      setLatestEvalAt('—');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void loadAnalytics(false);
  }, [loadAnalytics]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const totalQueries = useMemo(
    () => queriesOverTimeData.reduce((sum, point) => sum + point.queries, 0),
    [queriesOverTimeData],
  );
  const averageQuality = useMemo(() => {
    if (metrics.length === 0) return null;
    const total = metrics.reduce((sum, metric) => sum + metric.value, 0);
    return total / metrics.length;
  }, [metrics]);
  const peakQueryPoint = useMemo(() => {
    if (queriesOverTimeData.length === 0) return null;
    return queriesOverTimeData.reduce((max, current) => (current.queries > max.queries ? current : max));
  }, [queriesOverTimeData]);
  const trustSampleSize = useMemo(
    () => trustScoreDistributionData.reduce((sum, bucket) => sum + bucket.count, 0),
    [trustScoreDistributionData],
  );
  const lowTrustCount = useMemo(
    () => trustScoreDistributionData.reduce((sum, bucket) => (isLowTrustBucket(bucket.range) ? sum + bucket.count : sum), 0),
    [trustScoreDistributionData],
  );
  const lowTrustRatio = trustSampleSize > 0 ? lowTrustCount / trustSampleSize : null;

  const tabs = [
    { id: 'overview', label: 'Overview', icon: <BarChart3 size={14} /> },
    { id: 'ragas', label: 'RAGAS Metrics', icon: <Shield size={14} /> },
  ];
  const overviewCards = [
    {
      label: 'Total Queries (30d)',
      value: totalQueries.toLocaleString(),
      icon: MessageSquare,
      tone: 'text-primary-soft',
      detail: peakQueryPoint ? `Peak: ${peakQueryPoint.queries} on ${peakQueryPoint.label}` : 'Trend data is still loading.',
    },
    {
      label: 'Flagged Answers',
      value: flaggedAnswers.length.toString(),
      icon: AlertTriangle,
      tone: 'text-red',
      detail: lowTrustRatio !== null ? `Low-trust share: ${formatPercent(lowTrustRatio)}` : 'No trust distribution yet.',
    },
    {
      label: 'Avg Quality Score',
      value: formatPercent(averageQuality),
      icon: Shield,
      tone: 'text-green',
      detail: averageQuality !== null ? getQualityBand(averageQuality).label : 'Run an evaluation to populate this score.',
    },
    {
      label: 'Latest Eval Run',
      value: latestEvalAt,
      icon: Clock3,
      tone: 'text-accent',
      detail: metrics.length > 0 ? `${metrics.length} quality metrics captured` : 'No evaluation history recorded.',
    },
  ] as const;

  if (loading) {
    return (
      <motion.div variants={pageTransition} initial="initial" animate="animate">
        <PageShell>
          <PageHeader title="Analytics" description="Monitor demand, trust risk, and answer quality." />
          <StateBlock role="status">Loading analytics…</StateBlock>
        </PageShell>
      </motion.div>
    );
  }

  return (
    <motion.div variants={pageTransition} initial="initial" animate="animate">
      <PageShell>
      <motion.div
        variants={staggerItem}
        className="flex flex-wrap items-start justify-between gap-3"
      >
        <PageHeader
          title="Analytics"
          description="Monitor demand, trust risk, and answer quality from a single control surface."
          className="flex-1"
          actions={(
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { void loadAnalytics(true); }}
              loading={refreshing}
            >
              Refresh Data
            </Button>
          )}
        />
      </motion.div>

      {error ? (
        <StateBlock tone="danger" role="alert">{error}</StateBlock>
      ) : null}

      <motion.div className="flex flex-wrap gap-2" variants={staggerItem}>
        <Badge color="gray">30-day query window</Badge>
        <Badge color={lowTrustRatio !== null && lowTrustRatio > 0.2 ? 'orange' : 'green'}>
          Low-trust share: {formatPercent(lowTrustRatio)}
        </Badge>
        <Badge color={metrics.length > 0 ? 'green' : 'gray'}>
          {metrics.length > 0 ? 'Evaluation data synced' : 'Evaluation pending'}
        </Badge>
      </motion.div>

      <motion.div
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        {overviewCards.map((card) => {
          const Icon = card.icon;
          return (
            <motion.div key={card.label} variants={staggerItem}>
              <Card className="relative h-full overflow-hidden p-4">
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.04] to-transparent" />
                <div className="relative flex items-start gap-3">
                  <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl glass ${card.tone}`}>
                    <Icon size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-[0.08em] text-text-muted">{card.label}</p>
                    <p className="truncate text-lg font-bold text-text tabular-nums">{card.value}</p>
                    <p className="mt-1 text-xs text-text-dim">{card.detail}</p>
                  </div>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </motion.div>

      <motion.div
        className="grid gap-4 xl:grid-cols-2"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        <motion.div variants={staggerItem} className="min-w-0">
          <Card className="h-full p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Activity size={16} className="text-primary-soft" />
                <h3 className="text-sm font-semibold text-text">Queries Over Time</h3>
              </div>
              <span className="text-xs text-text-dim">Last 30 days</span>
            </div>
            <div className="h-64 min-w-0">
              {queriesOverTimeData.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-text-dim">No query trend data yet.</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%" minWidth={260} minHeight={220}>
                  <LineChart data={queriesOverTimeData} margin={{ top: 8, right: 10, left: -14, bottom: 0 }}>
                    <defs>
                      <linearGradient id="queriesLineGradient" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#4f8dff" />
                        <stop offset="100%" stopColor="#2d6bff" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(108, 131, 175, 0.24)" />
                    <XAxis dataKey="label" stroke="#7f96bf" fontSize={12} tickMargin={8} />
                    <YAxis stroke="#7f96bf" fontSize={12} tickMargin={8} allowDecimals={false} />
                    <Tooltip
                      formatter={(value: number | string | readonly (number | string)[] | undefined) => [tooltipNumber(value).toLocaleString(), 'Queries']}
                      contentStyle={{
                        backgroundColor: 'rgba(19, 26, 39, 0.96)',
                        backdropFilter: 'blur(8px)',
                        border: '1px solid rgba(117, 150, 207, 0.22)',
                        borderRadius: '12px',
                        color: '#eaf0ff',
                      }}
                      labelStyle={{ color: '#9db0d4' }}
                      itemStyle={{ color: '#eaf0ff' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="queries"
                      stroke="url(#queriesLineGradient)"
                      strokeWidth={3}
                      dot={{ fill: '#2d6bff', r: 3.5, strokeWidth: 0 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
            <p className="mt-3 text-xs text-text-dim">
              {peakQueryPoint ? `Highest daily volume was ${peakQueryPoint.queries} queries on ${peakQueryPoint.label}.` : 'No trend insight yet.'}
            </p>
          </Card>
        </motion.div>

        <motion.div variants={staggerItem} className="min-w-0">
          <Card className="h-full p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <BarChart3 size={16} className="text-accent" />
                <h3 className="text-sm font-semibold text-text">Trust Score Distribution</h3>
              </div>
              <span className="text-xs text-text-dim">Bucketed</span>
            </div>
            <div className="h-64 min-w-0">
              {trustScoreDistributionData.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-text-dim">No distribution data yet.</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%" minWidth={260} minHeight={220}>
                  <BarChart data={trustScoreDistributionData} margin={{ top: 8, right: 10, left: -14, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(108, 131, 175, 0.24)" />
                    <XAxis dataKey="range" stroke="#7f96bf" fontSize={12} tickMargin={8} />
                    <YAxis stroke="#7f96bf" fontSize={12} tickMargin={8} allowDecimals={false} />
                    <Tooltip
                      formatter={(value: number | string | readonly (number | string)[] | undefined) => [tooltipNumber(value).toLocaleString(), 'Queries']}
                      contentStyle={{
                        backgroundColor: 'rgba(19, 26, 39, 0.96)',
                        backdropFilter: 'blur(8px)',
                        border: '1px solid rgba(117, 150, 207, 0.22)',
                        borderRadius: '12px',
                        color: '#eaf0ff',
                      }}
                      labelStyle={{ color: '#9db0d4' }}
                      itemStyle={{ color: '#eaf0ff' }}
                    />
                    <Bar dataKey="count" radius={[8, 8, 0, 0]} maxBarSize={56}>
                      {trustScoreDistributionData.map((entry) => (
                        <Cell key={`${entry.range}-${entry.fill}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <p className="mt-3 text-xs text-text-dim">
              {lowTrustRatio !== null ? `${formatPercent(lowTrustRatio)} of scored answers currently fall below 50 trust.` : 'No trust breakdown available yet.'}
            </p>
          </Card>
        </motion.div>
      </motion.div>

      <motion.div variants={staggerItem}>
        <Card className="overflow-hidden p-0">
          <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} className="px-4 pt-2" />
          <div className="p-5 lg:p-6">
            {activeTab === 'ragas' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {metrics.length === 0 ? (
                  <div className="col-span-full rounded-2xl border border-border/60 bg-card-2/40 p-6 text-center">
                    <p className="text-sm font-semibold text-text">No evaluation history available yet.</p>
                    <p className="mt-1 text-xs text-text-dim">
                      Run an evaluation from the admin panel to populate RAGAS metrics and quality trend tracking.
                    </p>
                    <div className="mt-4">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => { void loadAnalytics(true); }}
                        loading={refreshing}
                      >
                        Check Again
                      </Button>
                    </div>
                  </div>
                ) : (
                  metrics.map((metric) => {
                    const percent = Math.round(metric.value * 100);
                    const qualityBand = getQualityBand(metric.value);
                    return (
                      <Card key={metric.label} className="relative overflow-hidden p-4">
                        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.035] to-transparent" />
                        <div className="relative mb-3 flex items-center justify-between gap-3">
                          <span className="text-sm font-medium text-text">{metric.label}</span>
                          <Badge color={qualityBand.badgeColor}>{qualityBand.label}</Badge>
                        </div>
                        <div className="relative mb-2 flex items-baseline justify-between">
                          <span className="text-2xl font-bold tabular-nums" style={{ color: metric.color }}>{percent}%</span>
                          <span className="text-xs text-text-dim">target: 85%+</span>
                        </div>
                        <div
                          className="h-2.5 w-full overflow-hidden rounded-full bg-card-2"
                          role="progressbar"
                          aria-valuenow={percent}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${metric.label}: ${percent}%`}
                        >
                          <div
                            className="h-full rounded-full transition-all duration-700 ease-out"
                            style={{ width: `${percent}%`, background: `linear-gradient(90deg, ${metric.color}, ${metric.color}88)` }}
                          />
                        </div>
                      </Card>
                    );
                  })
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
                    <AlertTriangle size={14} className="text-red" />
                    Low Trust Answers
                  </h3>
                  <Badge color={flaggedAnswers.length > 0 ? 'orange' : 'green'}>
                    {flaggedAnswers.length} flagged
                  </Badge>
                </div>
                {flaggedAnswers.length === 0 ? (
                  <p className="rounded-xl border border-border/60 bg-card-2/35 py-4 text-center text-sm text-text-dim">
                    No low-trust answers currently flagged.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {flaggedAnswers.map((item) => {
                      const risk = getRiskMeta(item.score);
                      return (
                        <div key={item.id} className="rounded-xl border border-border/60 bg-card-2/45 p-3.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge color={risk.badgeColor}>{risk.label}</Badge>
                            <span className="text-xs text-text-dim">{item.date}</span>
                            {item.workspace && <Badge color="gray">{item.workspace}</Badge>}
                            {item.user && <Badge color="gray">{item.user}</Badge>}
                          </div>
                          <p className="mt-2 text-sm leading-relaxed text-text break-words">&ldquo;{item.query}&rdquo;</p>
                          <div className="mt-3 flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-card/70">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${Math.round(item.score * 100)}%`, backgroundColor: risk.barColor }}
                              />
                            </div>
                            <span className="text-sm font-semibold tabular-nums" style={{ color: risk.barColor }}>
                              {Math.round(item.score * 100)}%
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-1 text-xs text-text-dim">
                            <TrendingUp size={12} />
                            Trust score
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      </motion.div>
      </PageShell>
    </motion.div>
  );
}
