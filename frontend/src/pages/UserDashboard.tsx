import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, useInView } from 'framer-motion';
import { MessageSquare, FileText, Settings, Plus, Sparkles, Clock, Shield, ArrowRight, TrendingUp, Zap } from 'lucide-react';
import { Button, Card, Badge, LoadingSpinner, EmptyState, useToast, staggerContainer, staggerItem, pageTransition } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import type { QuerySummary } from '../api/types';

// ─── Animated Counter ──────────────────────────────────────────────────────────

function AnimatedCounter({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });

  useEffect(() => {
    if (!inView) return;
    let start = 0;
    const duration = 800;
    const step = Math.ceil(value / (duration / 16));
    const timer = setInterval(() => {
      start += step;
      if (start >= value) { setCount(value); clearInterval(timer); }
      else setCount(start);
    }, 16);
    return () => clearInterval(timer);
  }, [inView, value]);

  return <span ref={ref} className="tabular-nums">{count}{suffix}</span>;
}

// ─── Mock Data ─────────────────────────────────────────────────────────────────

const MOCK_STATS = {
  totalDocs: 24,
  recentQueries: 18,
  avgTrustScore: 0.87,
};

const MOCK_RECENT_CHATS: QuerySummary[] = [
  { id: '1', workspace_id: 'w1', query_text: 'What are the key findings in the Q3 report?', trust_score: 0.92, model_used: 'gpt-4', created_at: new Date(Date.now() - 3600000).toISOString() },
  { id: '2', workspace_id: 'w1', query_text: 'Summarize the contractual obligations in section 4.2', trust_score: 0.88, model_used: 'claude-3', created_at: new Date(Date.now() - 7200000).toISOString() },
  { id: '3', workspace_id: 'w1', query_text: 'Compare revenue projections between 2024 and 2025', trust_score: 0.76, model_used: 'gpt-4', created_at: new Date(Date.now() - 86400000).toISOString() },
  { id: '4', workspace_id: 'w1', query_text: 'What compliance risks are identified in the audit?', trust_score: 0.95, model_used: 'claude-3', created_at: new Date(Date.now() - 172800000).toISOString() },
  { id: '5', workspace_id: 'w1', query_text: 'List all stakeholders mentioned in the project charter', trust_score: 0.91, model_used: 'gpt-4', created_at: new Date(Date.now() - 259200000).toISOString() },
];

const QUICK_ACTIONS = [
  { label: 'New Chat', path: '/workspaces', icon: MessageSquare, color: 'from-primary to-primary-soft' },
  { label: 'Browse Documents', path: '/documents', icon: FileText, color: 'from-accent to-accent' },
  { label: 'View History', path: '/chats', icon: Clock, color: 'from-accent-2 to-accent-2' },
  { label: 'Settings', path: '/settings', icon: Settings, color: 'from-gold to-gold' },
];

function trustScoreColor(score: number | undefined): string {
  if (score === undefined) return 'text-text-dim';
  if (score >= 0.75) return 'text-green';
  if (score >= 0.5) return 'text-orange';
  return 'text-red';
}

function trustScoreBadgeColor(score: number | undefined): 'green' | 'orange' | 'red' | 'gray' {
  if (score === undefined) return 'gray';
  if (score >= 0.75) return 'green';
  if (score >= 0.5) return 'orange';
  return 'red';
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function UserDashboard() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [chats, setChats] = useState<QuerySummary[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setChats(MOCK_RECENT_CHATS);
      setLoading(false);
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  return (
    <motion.div
      className="space-y-6"
      variants={pageTransition}
      initial="initial"
      animate="animate"
    >
      {/* Welcome Section */}
      <motion.div
        variants={staggerItem}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      >
        <motion.div
          initial={{ x: -30, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 120, damping: 15, delay: 0.05 }}
        >
          <h1 className="text-2xl font-bold text-text">
            {getGreeting()}, {user?.username || 'User'}{' '}
            <motion.span
              className="inline-block"
              animate={{ rotate: [0, 0, -15, 10, -10, 5, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 4 }}
            >
              <Sparkles size={20} className="inline text-accent" />
            </motion.span>
          </h1>
          <motion.p
            className="text-sm text-text-muted mt-1"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.4 }}
          >
            Here&apos;s what&apos;s happening with your workspace.
          </motion.p>
        </motion.div>
        <motion.div
          initial={{ x: 30, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 120, damping: 15, delay: 0.1 }}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.95 }}
        >
          <Link to="/workspaces">
            <Button size="md" className="whitespace-nowrap">
              <Plus size={16} />
              New Chat
            </Button>
          </Link>
        </motion.div>
      </motion.div>

      {/* Quick Stats */}
      <motion.div
        className="grid gap-4 sm:grid-cols-3"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        <motion.div variants={staggerItem}>
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.1 }}
          >
            <Card>
              <div className="flex items-center gap-4">
                <motion.div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg glass text-primary-soft"
                  animate={{ rotate: [0, 5, 0, -5, 0] }}
                  transition={{ duration: 2, repeat: Infinity, repeatDelay: 5 }}
                >
                  <FileText size={20} />
                </motion.div>
                <div>
                  <p className="text-sm text-text-muted">Documents Available</p>
                  <p className="text-xl font-bold text-text">
                    <AnimatedCounter value={MOCK_STATS.totalDocs} />
                  </p>
                </div>
              </div>
            </Card>
          </motion.div>
        </motion.div>
        <motion.div variants={staggerItem}>
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.2 }}
          >
            <Card>
              <div className="flex items-center gap-4">
                <motion.div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg glass text-accent"
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 2, repeat: Infinity, repeatDelay: 4 }}
                >
                  <MessageSquare size={20} />
                </motion.div>
                <div>
                  <p className="text-sm text-text-muted">Recent Queries</p>
                  <p className="text-xl font-bold text-text">
                    <AnimatedCounter value={MOCK_STATS.recentQueries} />
                  </p>
                </div>
              </div>
            </Card>
          </motion.div>
        </motion.div>
        <motion.div variants={staggerItem}>
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.3 }}
          >
            <Card>
              <div className="flex items-center gap-4">
                <motion.div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg glass text-accent-2"
                  animate={{ rotate: [0, 360] }}
                  transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
                >
                  <Shield size={20} />
                </motion.div>
                <div>
                  <p className="text-sm text-text-muted">Avg Trust Score</p>
                  <div className="flex items-center gap-2">
                    <motion.span
                      className={`text-xl font-bold tabular-nums ${trustScoreColor(MOCK_STATS.avgTrustScore)}`}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.5, type: 'spring' }}
                    >
                      {MOCK_STATS.avgTrustScore.toFixed(2)}
                    </motion.span>
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.7, type: 'spring', stiffness: 300 }}
                    >
                      <Badge color={trustScoreBadgeColor(MOCK_STATS.avgTrustScore)}>Good</Badge>
                    </motion.div>
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>
        </motion.div>
      </motion.div>

      {/* Quick Actions */}
      <motion.div variants={staggerItem}>
        <motion.h2
          className="text-base font-semibold text-text mb-3"
          initial={{ x: -20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 150 }}
        >
          Quick Actions
        </motion.h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_ACTIONS.map((action, i) => {
            const Icon = action.icon;
            return (
              <Link key={action.label} to={action.path}>
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + i * 0.1, type: 'spring', stiffness: 200, damping: 18 }}
                  whileHover={{ y: -6, scale: 1.03, boxShadow: '0 20px 40px rgba(0,0,0,0.12)' }}
                  whileTap={{ scale: 0.95 }}
                  className="glass rounded-2xl p-5 transition-colors duration-200 hover:shadow-lg hover:shadow-primary/10 cursor-pointer group relative overflow-hidden"
                >
                  {/* Hover shine effect */}
                  <motion.div
                    className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none"
                    initial={{ opacity: 0 }}
                    whileHover={{ opacity: 1 }}
                    transition={{ duration: 0.3 }}
                  />
                  <motion.div
                    className={`mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br ${action.color}/20`}
                    whileHover={{ rotate: [0, -10, 10, -5, 0] }}
                    transition={{ duration: 0.5 }}
                  >
                    <Icon size={18} className={action.color.includes('primary') ? 'text-primary-soft' : action.color.includes('accent-2') ? 'text-accent-2' : action.color.includes('gold') ? 'text-gold' : 'text-accent'} />
                  </motion.div>
                  <div className="flex items-center gap-1 relative z-10">
                    <span className="text-sm font-medium text-text">{action.label}</span>
                    <motion.div
                      initial={{ x: 0 }}
                      whileHover={{ x: 4 }}
                      transition={{ type: 'spring', stiffness: 300 }}
                    >
                      <ArrowRight size={14} className="text-text-muted group-hover:text-primary-soft transition-colors" />
                    </motion.div>
                  </div>
                </motion.div>
              </Link>
            );
          })}
        </div>
      </motion.div>

      {/* Recent Chats */}
      <motion.div variants={staggerItem}>
        <motion.div
          className="flex items-center justify-between mb-3"
          initial={{ x: -20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.4, type: 'spring', stiffness: 150 }}
        >
          <h2 className="text-base font-semibold text-text">Recent Chats</h2>
          <Link to="/chats" className="text-xs text-primary-soft hover:text-primary transition-colors">
            View all
          </Link>
        </motion.div>

        {loading ? (
          <LoadingSpinner text="Loading recent chats..." />
        ) : chats.length === 0 ? (
          <EmptyState
            icon={<MessageSquare size={24} />}
            title="No chats yet"
            description="Start a new conversation to see your recent activity here."
            action={
              <Link to="/workspaces">
                <Button size="sm">
                  <MessageSquare size={14} />
                  New Chat
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="space-y-2">
            {chats.map((chat, i) => (
              <motion.div
                key={chat.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.5 + i * 0.06, type: 'spring', stiffness: 180, damping: 20 }}
                whileHover={{ x: 4, transition: { type: 'spring', stiffness: 300 } }}
              >
                <Link to={`/chat/${chat.id}`}>
                  <Card hover className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-text truncate">{chat.query_text}</p>
                        <div className="flex items-center gap-3 mt-1.5">
                          <motion.span
                            className="flex items-center gap-1 text-xs text-text-dim"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.5 + i * 0.06 + 0.15 }}
                          >
                            <Clock size={11} />
                            {formatTimestamp(chat.created_at)}
                          </motion.span>
                          {chat.model_used && (
                            <span className="text-xs text-text-dim">{chat.model_used}</span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0">
                        {chat.trust_score !== undefined && (
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ delay: 0.5 + i * 0.06 + 0.2, type: 'spring', stiffness: 300 }}
                          >
                            <Badge color={trustScoreBadgeColor(chat.trust_score)}>
                              {chat.trust_score.toFixed(2)}
                            </Badge>
                          </motion.div>
                        )}
                      </div>
                    </div>
                  </Card>
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
