import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  DollarSign,
  Download,
  MessageSquare,
  Play,
  Shield,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { Badge, Button, Card, EmptyState, Tabs } from '../components/ui';
import { pageTransition, staggerContainer, staggerItem } from '../components/motion';
import { PageHeader, PageShell, StateBlock } from '../components/PageWrappers';
import { useToast } from '../components/toast-context';
import { adminApi } from '../api/client';
import { downloadBlob } from '../utils/download';
import { startOfDayIso, endOfDayIso } from '../utils/dates';
import { toneColor, tooltipStyles, trustBucketColor, useChartPalette } from '../utils/chartTheme';
import type {
  EvalRunNotes,
  EvalRunResponse,
  EvalThresholds,
  GoldenListResponse,
  ModelPricingRate,
  PricingSource,
  UsageGroupBy,
  UsageRow,
  UsageTotals,
} from '../api/types';

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
};

type QualityMetric = {
  key: string;
  label: string;
  value: number | null;
};

const CATEGORY_LABELS: Record<string, string> = {
  answerable: 'Answerable',
  unanswerable: 'Unanswerable',
  ambiguous: 'Ambiguous',
};

const CATEGORY_ORDER = ['answerable', 'unanswerable', 'ambiguous'];

const CATEGORY_METRIC_LABELS: Record<string, string> = {
  faithfulness: 'Faithfulness',
  trust: 'Trust',
  context_precision: 'Ctx. Precision',
  context_recall: 'Ctx. Recall',
  answer_relevance: 'Relevance',
  refusal_accuracy: 'Refusal Acc.',
};

const EVAL_POLL_INTERVAL_MS = 15_000;
const EVAL_POLL_MAX_TRIES = 4;

const USAGE_GROUP_BY_OPTIONS: Array<{ value: UsageGroupBy; label: string }> = [
  { value: 'user', label: 'User' },
  { value: 'workspace', label: 'Workspace' },
  { value: 'model', label: 'Model' },
];

type UsageSortKey = 'queries' | 'tokens' | 'cost';

const USAGE_SORT_COLUMNS: Array<{ key: UsageSortKey; label: string }> = [
  { key: 'queries', label: 'Queries' },
  { key: 'tokens', label: 'Tokens' },
  { key: 'cost', label: 'Est. Cost' },
];

const ZERO_USAGE_TOTALS: UsageTotals = {
  queries: 0,
  output_tokens: 0,
  prompt_tokens: 0,
  avg_latency_ms: 0,
  cache_hits: 0,
  est_cost_usd: 0,
};

function isoDateDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function usageSortValue(row: UsageRow | UsageTotals, key: UsageSortKey): number {
  if (key === 'queries') return row.queries;
  if (key === 'tokens') return row.output_tokens + row.prompt_tokens;
  return row.est_cost_usd;
}

function formatUsd(value: number): string {
  // A non-zero cost that rounds to $0.0000 at 4 decimal places (e.g. a
  // handful of tokens against a fractional-cent rate) reads as free, which
  // is misleading — show a "less than" floor instead. Exactly $0 stays $0.
  if (value > 0 && value < 0.0001) return '<$0.0001';
  return `$${value.toFixed(4)}`;
}

function formatPricingCaption(
  pricing: Record<string, ModelPricingRate>,
  pricingSource: PricingSource,
): string {
  const entries = Object.entries(pricing);
  if (pricingSource === 'none' || entries.length === 0) {
    return 'Estimated — no pricing configured for any model; costs shown as $0.';
  }
  const parts = entries.map(
    ([model, rate]) => `${model} $${rate.input_per_1k}/1K in · $${rate.output_per_1k}/1K out`,
  );
  return `Estimated — rates: ${parts.join(', ')}.`;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

/** Clamp a possibly-null metric to [0,1], preserving null/undefined so the UI
 * can distinguish "not computed" from "computed as 0". */
function clampUnitOrNull(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
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

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

/** Parse the `notes` JSON blob on an eval run. Guards against absent/invalid
 * JSON (older rows, or a backend that hasn't populated it yet) — returns
 * `null` rather than throwing so the rest of the page renders normally. */
function parseEvalNotes(notes: string | null | undefined): EvalRunNotes | null {
  if (!notes) return null;
  try {
    const parsed: unknown = JSON.parse(notes);
    if (parsed && typeof parsed === 'object') return parsed as EvalRunNotes;
    return null;
  } catch {
    return null;
  }
}

function shortGoldenSetVersion(version: string | null | undefined): string | null {
  if (!version) return null;
  return version.length > 12 ? version.slice(0, 12) : version;
}

type ThresholdCheck = { pass: boolean; threshold: number } | null;

function checkThreshold(value: number | null | undefined, threshold: number | null | undefined): ThresholdCheck {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (threshold === null || threshold === undefined || !Number.isFinite(threshold)) return null;
  return { pass: value >= threshold, threshold };
}

function thresholdForMetric(key: string, thresholds: EvalThresholds | undefined): number | null | undefined {
  if (!thresholds) return undefined;
  switch (key) {
    case 'faithfulness':
      return thresholds.min_faithfulness;
    case 'context_precision':
      return thresholds.min_context_precision;
    case 'refusal_accuracy':
      return thresholds.refusal_accuracy_min;
    default:
      return undefined;
  }
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

/** `badgeColor` drives the meter fill through `toneColor()`; `inkClass` is the
 *  text-safe token for the percentage beside it — a mark colour is never text. */
function getRiskMeta(score: number): {
  label: string;
  badgeColor: 'red' | 'orange' | 'gray';
  inkClass: string;
} {
  if (score < 0.25) {
    return { label: 'Critical', badgeColor: 'red', inkClass: 'text-red' };
  }
  if (score < 0.4) {
    return { label: 'Elevated', badgeColor: 'orange', inkClass: 'text-orange' };
  }
  return { label: 'Review', badgeColor: 'gray', inkClass: 'text-text-muted' };
}

function getQualityBand(value: number): { label: string; badgeColor: 'green' | 'blue' | 'orange' | 'red' } {
  if (value >= 0.85) return { label: 'Excellent', badgeColor: 'green' };
  if (value >= 0.7) return { label: 'Healthy', badgeColor: 'blue' };
  if (value >= 0.5) return { label: 'Needs Work', badgeColor: 'orange' };
  return { label: 'Critical', badgeColor: 'red' };
}

export default function AdminAnalyticsPage() {
  // Recharts takes literal colour props, so the design tokens have to be
  // resolved off <html> at runtime; this re-reads on every theme flip.
  const chart = useChartPalette();
  const chartTooltip = useMemo(() => tooltipStyles(chart), [chart]);

  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [flaggedAnswers, setFlaggedAnswers] = useState<FlaggedAnswer[]>([]);
  const [queriesOverTimeData, setQueriesOverTimeData] = useState<QueriesOverTimePoint[]>([]);
  const [trustScoreDistributionData, setTrustScoreDistributionData] = useState<TrustDistributionPoint[]>([]);
  const [metrics, setMetrics] = useState<QualityMetric[]>([]);
  const [latestEvalAt, setLatestEvalAt] = useState('—');
  const [latestEvalRun, setLatestEvalRun] = useState<EvalRunResponse | null>(null);
  const [evalRunCount, setEvalRunCount] = useState(0);
  const [ragasUnavailable, setRagasUnavailable] = useState(false);
  // F7b — golden-set inventory. Fetched separately from the analytics bundle so a
  // 404/403 here never blanks the whole page; the line is simply omitted.
  const [goldenMeta, setGoldenMeta] = useState<GoldenListResponse['meta'] | null>(null);

  const { addToast } = useToast();
  const [runningEval, setRunningEval] = useState(false);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAttemptsRef = useRef(0);

  // ── Usage & cost reporting (`usage` tab) ──────────────────────────────────
  const [usageGroupBy, setUsageGroupBy] = useState<UsageGroupBy>('model');
  const [usageDateFrom, setUsageDateFrom] = useState(() => isoDateDaysAgo(30));
  const [usageDateTo, setUsageDateTo] = useState(() => isoDateDaysAgo(0));
  const [usageRows, setUsageRows] = useState<UsageRow[]>([]);
  const [usageTotals, setUsageTotals] = useState<UsageTotals>(ZERO_USAGE_TOTALS);
  const [usagePricing, setUsagePricing] = useState<Record<string, ModelPricingRate>>({});
  const [usagePricingSource, setUsagePricingSource] = useState<PricingSource>('none');
  const [usageLoading, setUsageLoading] = useState(true);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usageExporting, setUsageExporting] = useState(false);
  const [usageSortKey, setUsageSortKey] = useState<UsageSortKey>('queries');
  const [usageSortDir, setUsageSortDir] = useState<'asc' | 'desc'>('desc');

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
      }));
      setTrustScoreDistributionData(normalizedTrust);

      const evalRaw = extractData<EvalRunResponse>(evalData);
      let normalizedMetrics: QualityMetric[] = [];
      let latestRun = '—';
      let latest: EvalRunResponse | null = null;

      if (evalRaw.length > 0) {
        latest = evalRaw[0];
        latestRun = formatDateTime(latest.run_at);

        // Nulls (e.g. context_precision/context_recall when the `ragas`
        // package isn't installed server-side) are preserved as `null` so the
        // UI can render "—" instead of a misleading 0%-filled bar.
        normalizedMetrics = [
          { key: 'faithfulness', label: 'Faithfulness', value: clampUnitOrNull(latest.faithfulness) },
          { key: 'context_precision', label: 'Context Precision', value: clampUnitOrNull(latest.context_precision) },
          { key: 'context_recall', label: 'Context Recall', value: clampUnitOrNull(latest.context_recall) },
          { key: 'answer_relevance', label: 'Answer Relevance', value: clampUnitOrNull(latest.answer_relevance) },
          { key: 'refusal_accuracy', label: 'Refusal Accuracy', value: clampUnitOrNull(latest.refusal_accuracy) },
        ];
      }

      setMetrics(normalizedMetrics);
      setLatestEvalAt(latestRun);
      setLatestEvalRun(latest);
      setEvalRunCount(evalRaw.length);
      setRagasUnavailable(latest !== null && latest.context_precision === null && latest.context_recall === null);
    } catch {
      setError('Unable to load analytics right now.');
      setFlaggedAnswers([]);
      setQueriesOverTimeData([]);
      setTrustScoreDistributionData([]);
      setMetrics([]);
      setLatestEvalAt('—');
      setLatestEvalRun(null);
      setEvalRunCount(0);
      setRagasUnavailable(false);
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

  // Guards against rapid group-by/date switching: only the response for the
  // most recently issued request is allowed to update state. Without this, a
  // slower-resolving earlier request (e.g. "user") can resolve after a
  // faster later one (e.g. "model") and clobber the table with stale rows.
  const usageRequestIdRef = useRef(0);

  const loadUsage = useCallback(async () => {
    const requestId = usageRequestIdRef.current + 1;
    usageRequestIdRef.current = requestId;
    const isStale = () => usageRequestIdRef.current !== requestId;

    setUsageLoading(true);
    setUsageError(null);

    try {
      const [usageData, pricingData] = await Promise.all([
        adminApi.getUsage({
          group_by: usageGroupBy,
          date_from: startOfDayIso(usageDateFrom),
          date_to: endOfDayIso(usageDateTo),
        }),
        adminApi.getUsagePricing(),
      ]);
      if (isStale()) return;

      const rowsRaw = extractData<Record<string, unknown>>(usageData?.rows);
      const normalizedRows: UsageRow[] = rowsRaw.map((item, idx) => ({
        key: String(item.key ?? `row-${idx}`),
        label: String(item.label ?? item.key ?? 'Unknown'),
        queries: toFiniteNumber(item.queries, 0),
        output_tokens: toFiniteNumber(item.output_tokens, 0),
        prompt_tokens: toFiniteNumber(item.prompt_tokens, 0),
        avg_latency_ms: toFiniteNumber(item.avg_latency_ms, 0),
        cache_hits: toFiniteNumber(item.cache_hits, 0),
        est_cost_usd: toFiniteNumber(item.est_cost_usd, 0),
      }));
      setUsageRows(normalizedRows);

      const totalsRaw = (usageData?.totals ?? {}) as unknown as Record<string, unknown>;
      setUsageTotals({
        queries: toFiniteNumber(totalsRaw.queries, 0),
        output_tokens: toFiniteNumber(totalsRaw.output_tokens, 0),
        prompt_tokens: toFiniteNumber(totalsRaw.prompt_tokens, 0),
        avg_latency_ms: toFiniteNumber(totalsRaw.avg_latency_ms, 0),
        cache_hits: toFiniteNumber(totalsRaw.cache_hits, 0),
        est_cost_usd: toFiniteNumber(totalsRaw.est_cost_usd, 0),
      });

      setUsagePricingSource(usageData?.pricing_source ?? 'none');
      setUsagePricing(pricingData?.pricing ?? {});
    } catch {
      if (isStale()) return;
      setUsageError('Unable to load the usage report right now.');
      setUsageRows([]);
      setUsageTotals(ZERO_USAGE_TOTALS);
    } finally {
      if (!isStale()) {
        setUsageLoading(false);
      }
    }
  }, [usageGroupBy, usageDateFrom, usageDateTo]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleExportUsage = useCallback(async () => {
    setUsageExporting(true);
    try {
      const { blob, filename } = await adminApi.exportUsage({
        group_by: usageGroupBy,
        date_from: startOfDayIso(usageDateFrom),
        date_to: endOfDayIso(usageDateTo),
      });
      downloadBlob(blob, filename);
      addToast('Usage report exported.', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to export usage report.', 'error');
    } finally {
      setUsageExporting(false);
    }
  }, [usageGroupBy, usageDateFrom, usageDateTo, addToast]);

  const handleUsageSort = useCallback((key: UsageSortKey) => {
    setUsageSortKey((prevKey) => {
      if (prevKey !== key) {
        setUsageSortDir('desc');
      } else {
        setUsageSortDir((prevDir) => (prevDir === 'desc' ? 'asc' : 'desc'));
      }
      return key;
    });
  }, []);

  const totalQueries = useMemo(
    () => queriesOverTimeData.reduce((sum, point) => sum + point.queries, 0),
    [queriesOverTimeData],
  );
  const scoredMetrics = useMemo(
    () => metrics.filter((metric): metric is QualityMetric & { value: number } => metric.value !== null),
    [metrics],
  );
  const averageQuality = useMemo(() => {
    if (scoredMetrics.length === 0) return null;
    const total = scoredMetrics.reduce((sum, metric) => sum + metric.value, 0);
    return total / scoredMetrics.length;
  }, [scoredMetrics]);
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

  const evalNotes = useMemo(() => parseEvalNotes(latestEvalRun?.notes), [latestEvalRun]);
  const goldenSetVersion = shortGoldenSetVersion(latestEvalRun?.golden_set_version);
  const thresholds = evalNotes?.thresholds;
  const categoryRows = useMemo(() => {
    const perCategory = evalNotes?.per_category;
    if (!perCategory) return [];
    const seen = new Set<string>();
    const ordered = [...CATEGORY_ORDER, ...Object.keys(perCategory)].filter((key) => {
      if (seen.has(key) || !perCategory[key]) return false;
      seen.add(key);
      return true;
    });
    return ordered.map((key) => ({ key, label: CATEGORY_LABELS[key] ?? key, data: perCategory[key]! }));
  }, [evalNotes]);

  const sortedUsageRows = useMemo(() => {
    const sorted = [...usageRows];
    sorted.sort((a, b) => {
      const diff = usageSortValue(a, usageSortKey) - usageSortValue(b, usageSortKey);
      return usageSortDir === 'asc' ? diff : -diff;
    });
    return sorted;
  }, [usageRows, usageSortKey, usageSortDir]);

  const usageGroupByLabel = USAGE_GROUP_BY_OPTIONS.find((opt) => opt.value === usageGroupBy)?.label ?? 'Group';
  const usagePricingCaption = useMemo(
    () => formatPricingCaption(usagePricing, usagePricingSource),
    [usagePricing, usagePricingSource],
  );

  // ── Run evaluation (async, queued) ────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
    pollAttemptsRef.current = 0;
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const pollForResults = useCallback(() => {
    const baselineCount = evalRunCount;
    const attempt = () => {
      pollAttemptsRef.current += 1;
      void (async () => {
        try {
          const history = await adminApi.getEvalHistory();
          const rows = extractData<EvalRunResponse>(history);
          if (rows.length > baselineCount) {
            stopPolling();
            await loadAnalytics(true);
            addToast('New evaluation results are in.', 'success');
            return;
          }
        } catch {
          // Ignore transient poll errors — the user can always hit Refresh.
        }
        if (pollAttemptsRef.current < EVAL_POLL_MAX_TRIES) {
          pollTimeoutRef.current = setTimeout(attempt, EVAL_POLL_INTERVAL_MS);
        } else {
          stopPolling();
        }
      })();
    };
    pollTimeoutRef.current = setTimeout(attempt, EVAL_POLL_INTERVAL_MS);
  }, [evalRunCount, stopPolling, loadAnalytics, addToast]);

  const handleRunEvaluation = useCallback(async () => {
    if (runningEval) return;
    setRunningEval(true);
    stopPolling();
    try {
      await adminApi.runEvaluation();
      addToast('Evaluation queued — a golden-set run can take a few minutes. Refresh to see results.', 'info');
      pollForResults();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to queue evaluation.', 'error');
    } finally {
      setRunningEval(false);
    }
  }, [runningEval, stopPolling, addToast, pollForResults]);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getGolden({ source: 'promoted', page_size: 1 })
      .then((response) => {
        if (!cancelled) setGoldenMeta(response.meta);
      })
      .catch(() => {
        if (!cancelled) setGoldenMeta(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const tabs = [
    { id: 'overview', label: 'Overview', icon: <BarChart3 size={14} /> },
    { id: 'ragas', label: 'RAGAS Metrics', icon: <Shield size={14} /> },
    { id: 'usage', label: 'Usage & Cost', icon: <DollarSign size={14} /> },
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
      detail: scoredMetrics.length > 0 ? `${scoredMetrics.length} quality metrics captured` : 'No evaluation history recorded.',
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
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { void loadAnalytics(true); }}
                loading={refreshing}
              >
                Refresh Data
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => { void handleRunEvaluation(); }}
                loading={runningEval}
                disabled={runningEval}
              >
                <Play size={14} />
                Run Evaluation
              </Button>
            </div>
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
          const isLatestEvalCard = card.label === 'Latest Eval Run';
          return (
            <motion.div key={card.label} variants={staggerItem}>
              <Card className="relative h-full overflow-hidden p-4">
                <div className="relative flex items-start gap-3">
                  <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl glass ${card.tone}`}>
                    <Icon size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-[0.08em] text-text-muted">{card.label}</p>
                    <p className="truncate text-lg font-bold text-text tabular-nums">{card.value}</p>
                    <p className="mt-1 text-xs text-text-dim">{card.detail}</p>
                    {isLatestEvalCard && goldenSetVersion ? (
                      <p className="mt-1 truncate font-mono text-[11px] text-text-dim">
                        golden set · {goldenSetVersion}
                      </p>
                    ) : null}
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
                    {/* Solid hairline grid, recessive; the accent carries the one series. */}
                    <CartesianGrid stroke={chart.grid} vertical={false} />
                    <XAxis dataKey="label" stroke={chart.axis} tick={{ fill: chart.axisText, fontSize: 12 }} tickMargin={8} />
                    <YAxis stroke={chart.axis} tick={{ fill: chart.axisText, fontSize: 12 }} tickMargin={8} allowDecimals={false} />
                    <Tooltip
                      formatter={(value: number | string | readonly (number | string)[] | undefined) => [tooltipNumber(value).toLocaleString(), 'Queries']}
                      contentStyle={chartTooltip.contentStyle}
                      labelStyle={chartTooltip.labelStyle}
                      itemStyle={chartTooltip.itemStyle}
                      cursor={{ stroke: chart.axis, strokeWidth: 1 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="queries"
                      stroke={chart.accent}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      dot={false}
                      // 2px surface ring so the hovered marker stays legible
                      // where it crosses the line.
                      activeDot={{ r: 4, fill: chart.accent, stroke: chart.surface, strokeWidth: 2 }}
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
                    <CartesianGrid stroke={chart.grid} vertical={false} />
                    <XAxis dataKey="range" stroke={chart.axis} tick={{ fill: chart.axisText, fontSize: 12 }} tickMargin={8} />
                    <YAxis stroke={chart.axis} tick={{ fill: chart.axisText, fontSize: 12 }} tickMargin={8} allowDecimals={false} />
                    <Tooltip
                      formatter={(value: number | string | readonly (number | string)[] | undefined) => [tooltipNumber(value).toLocaleString(), 'Queries']}
                      contentStyle={chartTooltip.contentStyle}
                      labelStyle={chartTooltip.labelStyle}
                      itemStyle={chartTooltip.itemStyle}
                      cursor={{ fill: chart.grid }}
                    />
                    {/* Bucket colour is the trust STATUS (red/amber/green at the
                        same 50/75 thresholds as the badges), and it is purely
                        redundant: the bars are positionally ordered and the
                        x-axis names the range. Capped at 24px per the mark spec. */}
                    <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={24}>
                      {trustScoreDistributionData.map((entry) => (
                        <Cell key={entry.range} fill={trustBucketColor(entry.range, chart)} />
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
              <div className="space-y-5">
                {goldenMeta ? (
                  <p className="text-xs text-text-dim">
                    Golden set: builtin {goldenMeta.builtin_count} / promoted {goldenMeta.promoted_count}
                    {' · version '}
                    <span className="font-mono text-text-muted">{goldenMeta.golden_set_version}</span>
                  </p>
                ) : null}
                {evalRunCount === 0 ? (
                <EmptyState
                  icon={<Shield size={24} />}
                  title="No evaluation runs yet"
                  description="Click Run evaluation to score the golden dataset and populate RAGAS metrics."
                  action={(
                    <Button onClick={() => { void handleRunEvaluation(); }} loading={runningEval} disabled={runningEval}>
                      <Play size={16} />
                      Run evaluation
                    </Button>
                  )}
                />
              ) : (
                <div className="space-y-5">
                  {ragasUnavailable ? (
                    <StateBlock tone="neutral" role="status" className="flex items-center gap-2">
                      <AlertTriangle size={14} className="shrink-0 text-orange" />
                      RAGAS metrics unavailable — install ragas on the server to compute Context Precision and Context Recall.
                    </StateBlock>
                  ) : null}

                  <div className="grid gap-4 sm:grid-cols-2">
                    {metrics.map((metric) => {
                      const value = metric.value;
                      const isNull = value === null;
                      const percent = value === null ? 0 : Math.round(value * 100);
                      const qualityBand = value === null ? null : getQualityBand(value);
                      const thresholdValue = thresholdForMetric(metric.key, thresholds);
                      const check = value === null ? null : checkThreshold(value, thresholdValue);
                      // The meter fill carries severity: a failed threshold wins,
                      // otherwise the quality band. It is never the only signal —
                      // the Pass / Below-threshold badge keeps its icon + word.
                      const meterColor = check && !check.pass
                        ? chart.danger
                        : toneColor(qualityBand?.badgeColor ?? 'gray', chart);
                      return (
                        <Card key={metric.key} className="relative overflow-hidden p-4">
                          <div className="relative mb-3 flex items-center justify-between gap-3">
                            <span className="text-sm font-medium text-text">{metric.label}</span>
                            <div className="flex items-center gap-1.5">
                              {check ? (
                                <Badge color={check.pass ? 'green' : 'red'} className="inline-flex items-center gap-1">
                                  {check.pass ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                                  {check.pass ? 'Pass' : 'Below threshold'}
                                </Badge>
                              ) : null}
                              {qualityBand ? <Badge color={qualityBand.badgeColor}>{qualityBand.label}</Badge> : null}
                            </div>
                          </div>
                          <div className="relative mb-2 flex items-baseline justify-between">
                            {/* Text wears an ink token, never the mark colour —
                                the badge beside it carries the status. */}
                            <span className="text-2xl font-bold tabular-nums text-text">
                              {isNull ? '—' : `${percent}%`}
                            </span>
                            <span className="text-xs text-text-dim">
                              {isNull ? 'n/a' : check ? `threshold: ${Math.round(check.threshold * 100)}%` : 'target: 85%+'}
                            </span>
                          </div>
                          {/* Opaque inset track, not a translucent tint: on the
                              light card a card-2 track put the green/amber fills
                              at 2.97 / 2.87 : 1, under the 3:1 the filled-vs-
                              unfilled boundary needs. The hairline ring is what
                              keeps the 100% reference visible. */}
                          <div
                            className="h-2.5 w-full overflow-hidden rounded-full bg-solid ring-1 ring-inset ring-border-light"
                            role="progressbar"
                            aria-valuenow={isNull ? undefined : percent}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={isNull ? `${metric.label}: not available` : `${metric.label}: ${percent}%`}
                          >
                            {isNull ? null : (
                              <div
                                className="h-full rounded-full transition-all duration-700 ease-out"
                                style={{ width: `${percent}%`, backgroundColor: meterColor }}
                              />
                            )}
                          </div>
                        </Card>
                      );
                    })}
                  </div>

                  {categoryRows.length > 0 ? (
                    <div className="rounded-2xl border border-border/60 bg-card-2/35 p-4">
                      <h4 className="mb-3 text-sm font-semibold text-text">Per-Category Breakdown</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[420px] text-left text-xs">
                          <thead>
                            <tr className="text-text-dim">
                              <th className="pb-2 pr-3 font-medium uppercase tracking-[0.06em]">Category</th>
                              <th className="pb-2 pr-3 font-medium uppercase tracking-[0.06em]">Count</th>
                              {Object.keys(categoryRows[0].data)
                                .filter((key) => key !== 'count')
                                .map((key) => (
                                  <th key={key} className="pb-2 pr-3 font-medium uppercase tracking-[0.06em]">
                                    {CATEGORY_METRIC_LABELS[key] ?? key}
                                  </th>
                                ))}
                            </tr>
                          </thead>
                          <tbody>
                            {categoryRows.map((row) => {
                              const metricKeys = Object.keys(row.data).filter((key) => key !== 'count');
                              return (
                                <tr key={row.key} className="border-t border-border/50">
                                  <td className="py-2 pr-3 font-medium text-text">{row.label}</td>
                                  <td className="py-2 pr-3 tabular-nums text-text-muted">{row.data.count ?? '—'}</td>
                                  {metricKeys.map((key) => (
                                    <td key={key} className="py-2 pr-3 tabular-nums text-text-muted">
                                      {formatPercent(row.data[key] as number | null | undefined)}
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
              </div>
            ) : activeTab === 'usage' ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div
                    className="inline-flex gap-1 rounded-xl glass p-1"
                    role="group"
                    aria-label="Group usage by"
                  >
                    {USAGE_GROUP_BY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setUsageGroupBy(opt.value)}
                        aria-pressed={usageGroupBy === opt.value}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                          usageGroupBy === opt.value
                            ? 'border-primary/30 bg-primary/15 text-primary-soft'
                            : 'border-transparent text-text-muted hover:bg-card-2 hover:text-text'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor="usage-date-from" className="flex items-center gap-1.5 text-xs text-text-muted">
                      From
                      <input
                        id="usage-date-from"
                        type="date"
                        value={usageDateFrom}
                        max={usageDateTo}
                        onChange={(e) => setUsageDateFrom(e.target.value)}
                        className="glass-input rounded-lg px-2 py-1.5 text-xs text-text focus:outline-none"
                      />
                    </label>
                    <label htmlFor="usage-date-to" className="flex items-center gap-1.5 text-xs text-text-muted">
                      To
                      <input
                        id="usage-date-to"
                        type="date"
                        value={usageDateTo}
                        min={usageDateFrom}
                        onChange={(e) => setUsageDateTo(e.target.value)}
                        className="glass-input rounded-lg px-2 py-1.5 text-xs text-text focus:outline-none"
                      />
                    </label>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => { void handleExportUsage(); }}
                      loading={usageExporting}
                      disabled={usageExporting || sortedUsageRows.length === 0}
                    >
                      <Download size={14} />
                      Export CSV
                    </Button>
                  </div>
                </div>

                {usageLoading ? (
                  <StateBlock role="status">Loading usage report…</StateBlock>
                ) : usageError ? (
                  <StateBlock tone="danger" role="alert">{usageError}</StateBlock>
                ) : sortedUsageRows.length === 0 ? (
                  <EmptyState
                    icon={<DollarSign size={24} />}
                    title="No usage recorded"
                    description="No queries were recorded for the selected filters."
                  />
                ) : (
                  <div className="space-y-3">
                    <div className="overflow-x-auto rounded-xl border border-border/60">
                      <table className="w-full min-w-[640px] text-left text-xs">
                        <thead>
                          <tr className="border-b border-border bg-card-2/60 text-text-dim">
                            <th className="px-3 py-2 font-medium uppercase tracking-[0.06em]">{usageGroupByLabel}</th>
                            {USAGE_SORT_COLUMNS.map((col) => (
                              <th
                                key={col.key}
                                scope="col"
                                aria-sort={
                                  usageSortKey === col.key
                                    ? (usageSortDir === 'asc' ? 'ascending' : 'descending')
                                    : 'none'
                                }
                                className="px-3 py-2 font-medium uppercase tracking-[0.06em]"
                              >
                                <button
                                  type="button"
                                  onClick={() => handleUsageSort(col.key)}
                                  className="inline-flex items-center gap-1 hover:text-text"
                                >
                                  {col.label}
                                  {usageSortKey === col.key ? (
                                    usageSortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                                  ) : null}
                                </button>
                              </th>
                            ))}
                            <th className="px-3 py-2 font-medium uppercase tracking-[0.06em]">Avg Latency</th>
                            <th className="px-3 py-2 font-medium uppercase tracking-[0.06em]">Cache Hits</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedUsageRows.map((row) => (
                            <tr key={row.key} className="border-b border-border/50 last:border-b-0">
                              <td className="px-3 py-2 font-medium text-text">{row.label}</td>
                              <td className="px-3 py-2 tabular-nums text-text-muted">{row.queries.toLocaleString()}</td>
                              <td className="px-3 py-2 tabular-nums text-text-muted">
                                {(row.output_tokens + row.prompt_tokens).toLocaleString()}
                              </td>
                              <td className="px-3 py-2 tabular-nums text-text-muted">{formatUsd(row.est_cost_usd)}</td>
                              <td className="px-3 py-2 tabular-nums text-text-muted">{Math.round(row.avg_latency_ms)}ms</td>
                              <td className="px-3 py-2 tabular-nums text-text-muted">{row.cache_hits.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-border bg-card-2/40 font-semibold text-text">
                            <td className="px-3 py-2">Total</td>
                            <td className="px-3 py-2 tabular-nums">{usageTotals.queries.toLocaleString()}</td>
                            <td className="px-3 py-2 tabular-nums">
                              {(usageTotals.output_tokens + usageTotals.prompt_tokens).toLocaleString()}
                            </td>
                            <td className="px-3 py-2 tabular-nums">{formatUsd(usageTotals.est_cost_usd)}</td>
                            <td className="px-3 py-2 tabular-nums">{Math.round(usageTotals.avg_latency_ms)}ms</td>
                            <td className="px-3 py-2 tabular-nums">{usageTotals.cache_hits.toLocaleString()}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    <p className="text-xs text-text-dim">{usagePricingCaption}</p>
                  </div>
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
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-solid ring-1 ring-inset ring-border-light">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${Math.round(item.score * 100)}%`,
                                  backgroundColor: toneColor(risk.badgeColor, chart),
                                }}
                              />
                            </div>
                            <span className={`text-sm font-semibold tabular-nums ${risk.inkClass}`}>
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
