import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import {
  BarChart3, Activity, Shield, AlertTriangle, Users, MessageSquare, TrendingUp, Star,
} from 'lucide-react';
import { Button, Card, Badge, Tabs, LoadingSpinner, staggerContainer, staggerItem, pageTransition } from '../components/ui';
import { adminApi } from '../api/client';

function evalScoreColor(value: number): string {
  if (value >= 0.8) return 'var(--color-green)';
  if (value >= 0.6) return 'var(--color-orange)';
  return 'var(--color-red)';
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function AdminAnalyticsPage() {
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [lowTrustAnswers, setLowTrustAnswers] = useState<Array<{ id: string; query: string; score: number; date: string }>>([]);
  const [queriesOverTimeData, setQueriesOverTimeData] = useState<Array<{ month: string; queries: number }>>([]);
  const [trustScoreDistributionData, setTrustScoreDistributionData] = useState<Array<{ range: string; count: number; fill: string }>>([]);
  const [metrics, setMetrics] = useState<Array<{ label: string; value: number; color: string }>>([]);
  const [usageStats, setUsageStats] = useState<Array<{ label: string; value: string; color: string }>>([]);

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const [flaggedData, queriesData, trustData, evalData] = await Promise.all([
          adminApi.getFlaggedAnswers(),
          adminApi.getQueriesOverTime(),
          adminApi.getTrustScoreDistribution(),
          adminApi.getEvalHistory(),
        ]) as [unknown, unknown, unknown, unknown];

        // Normalize responses that may be { data: [...] } or just [...]
        const extractData = <T,>(resp: unknown): T[] => {
          if (Array.isArray(resp)) return resp as T[];
          if (resp && typeof resp === 'object' && 'data' in resp) return (resp as { data: T[] }).data;
          return [];
        };

        const flaggedArr = extractData<{ id: string; query: string; score: number; date: string }>(flaggedData);
        setLowTrustAnswers(flaggedArr);

        const queriesArr = extractData<{ month: string; queries: number }>(queriesData);
        setQueriesOverTimeData(queriesArr);

        const trustArr = extractData<{ range: string; count: number }>(trustData);
        setTrustScoreDistributionData(
          trustArr.map((item, i) => ({
            ...item,
            fill: ['#f87171', '#fb923c', '#fbbf24', '#2dd4bf', '#34d399'][i] || '#34d399',
          })),
        );

        const evalArr = extractData<{ label: string; value: number }>(evalData);
        setMetrics(
          evalArr.map((item, i) => ({
            ...item,
            color: ['#34d399', '#2dd4bf', '#38bdf8', '#7c5cff'][i] || '#7c5cff',
          })),
        );

        setUsageStats([
          { label: 'Total Queries (30d)', value: queriesArr.length.toString(), color: 'text-primary-soft' },
          { label: 'Active Users (30d)', value: '—', color: 'text-accent' },
          { label: 'Avg Latency', value: '—', color: 'text-accent-2' },
          { label: 'Avg Trust Score', value: '—', color: 'text-green' },
        ]);
      } catch {
        setLowTrustAnswers([]);
        setQueriesOverTimeData([]);
        setTrustScoreDistributionData([]);
        setMetrics([]);
        setUsageStats([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const tabs = [
    { id: 'overview', label: 'Overview', icon: <BarChart3 size={14} /> },
    { id: 'ragas', label: 'RAGAS Metrics', icon: <Shield size={14} /> },
  ];

  if (loading) {
    return (
      <motion.div
        className="space-y-6"
        variants={pageTransition}
        initial="initial"
        animate="animate"
      >
        <LoadingSpinner text="Loading analytics..." />
      </motion.div>
    );
  }

  return (
    <motion.div
      className="space-y-6"
      variants={pageTransition}
      initial="initial"
      animate="animate"
    >
      {/* Header */}
      <motion.div variants={staggerItem}>
        <h1 className="text-2xl font-bold text-text">Analytics</h1>
        <p className="text-sm text-text-muted mt-1">System performance and quality metrics.</p>
      </motion.div>

      {/* Usage Stats Row */}
      <motion.div
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        {usageStats.map((stat, idx) => {
          const icons = [MessageSquare, Users, Activity, Shield];
          const Icon = icons[idx] || MessageSquare;
          return (
            <motion.div key={stat.label} variants={staggerItem}>
              <Card className="p-4">
                <div className="flex items-center gap-3">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg glass ${stat.color}`}>
                    <Icon size={18} />
                  </div>
                  <div>
                    <p className="text-xs text-text-muted">{stat.label}</p>
                    <p className="text-lg font-bold text-text tabular-nums">{stat.value}</p>
                  </div>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </motion.div>

      {/* Charts Row */}
      <motion.div
        className="grid gap-4 lg:grid-cols-2"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        {/* Queries Over Time */}
        <motion.div variants={staggerItem}>
          <Card className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <Activity size={16} className="text-primary-soft" />
              <h3 className="text-sm font-semibold text-text">Queries Over Time</h3>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={queriesOverTimeData}>
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
                  <Line type="monotone" dataKey="queries" stroke="#7c5cff" strokeWidth={2} dot={{ fill: '#7c5cff', r: 4 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </motion.div>

        {/* Trust Score Distribution */}
        <motion.div variants={staggerItem}>
          <Card className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <BarChart3 size={16} className="text-accent" />
              <h3 className="text-sm font-semibold text-text">Trust Score Distribution</h3>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trustScoreDistributionData}>
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
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {trustScoreDistributionData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </motion.div>
      </motion.div>

      {/* Tabs: Overview / RAGAS */}
      <motion.div variants={staggerItem}>
        <Card className="p-0 overflow-hidden">
          <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} className="px-4 pt-2" />
          <div className="p-5 lg:p-6">
            {activeTab === 'ragas' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {metrics.map((metric) => {
                  const pct = Math.round(metric.value * 100);
                  return (
                    <Card key={metric.label} className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-text">{metric.label}</span>
                        <span className="text-lg font-bold tabular-nums" style={{ color: metric.color }}>
                          {pct}%
                        </span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-card-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${metric.label}: ${pct}%`}>
                        <div
                          className="h-full rounded-full transition-all duration-700 ease-out"
                          style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${metric.color}, ${metric.color}88)` }}
                        />
                      </div>
                    </Card>
                  );
                })}
              </div>
            ) : (
              /* Overview tab content: Low trust answers */
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-text flex items-center gap-2">
                  <AlertTriangle size={14} className="text-red" />
                  Low Trust Score Answers
                </h3>
                {lowTrustAnswers.length === 0 ? (
                  <p className="text-sm text-text-muted text-center py-4">No low trust answers flagged.</p>
                ) : (
                  <div className="space-y-2">
                    {lowTrustAnswers.map((item) => (
                      <div key={item.id} className="flex items-start justify-between gap-3 rounded-xl glass p-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-text truncate">&ldquo;{item.query}&rdquo;</p>
                          <p className="text-xs text-text-dim mt-0.5">{item.date}</p>
                        </div>
                        <Badge color="red">
                          {item.score.toFixed(2)}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      </motion.div>
    </motion.div>
  );
}
