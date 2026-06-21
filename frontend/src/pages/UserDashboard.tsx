import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MessageSquare, FileText, Settings, Search, Plus, Sparkles, Clock, Shield, TrendingUp, ArrowRight } from 'lucide-react';
import { Button, Card, Badge, LoadingSpinner, EmptyState, useToast, staggerContainer, staggerItem, pageTransition } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import type { QuerySummary } from '../api/types';

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
  { label: 'View History', path: '/chat-history', icon: Clock, color: 'from-accent-2 to-accent-2' },
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
      <motion.div variants={staggerItem} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text">
            {getGreeting()}, {user?.username || 'User'} <Sparkles size={20} className="inline text-accent" />
          </h1>
          <p className="text-sm text-text-muted mt-1">Here&apos;s what&apos;s happening with your workspace.</p>
        </div>
        <Link to="/workspaces">
          <Button size="md" className="whitespace-nowrap">
            <Plus size={16} />
            New Chat
          </Button>
        </Link>
      </motion.div>

      {/* Quick Stats */}
      <motion.div
        className="grid gap-4 sm:grid-cols-3"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        <motion.div variants={staggerItem}>
          <Card>
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg glass text-primary-soft">
                <FileText size={20} />
              </div>
              <div>
                <p className="text-sm text-text-muted">Documents Available</p>
                <p className="text-xl font-bold text-text tabular-nums">{MOCK_STATS.totalDocs}</p>
              </div>
            </div>
          </Card>
        </motion.div>
        <motion.div variants={staggerItem}>
          <Card>
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg glass text-accent">
                <MessageSquare size={20} />
              </div>
              <div>
                <p className="text-sm text-text-muted">Recent Queries</p>
                <p className="text-xl font-bold text-text tabular-nums">{MOCK_STATS.recentQueries}</p>
              </div>
            </div>
          </Card>
        </motion.div>
        <motion.div variants={staggerItem}>
          <Card>
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg glass text-accent-2">
                <Shield size={20} />
              </div>
              <div>
                <p className="text-sm text-text-muted">Avg Trust Score</p>
                <div className="flex items-center gap-2">
                  <span className={`text-xl font-bold tabular-nums ${trustScoreColor(MOCK_STATS.avgTrustScore)}`}>
                    {MOCK_STATS.avgTrustScore.toFixed(2)}
                  </span>
                  <Badge color={trustScoreBadgeColor(MOCK_STATS.avgTrustScore)}>Good</Badge>
                </div>
              </div>
            </div>
          </Card>
        </motion.div>
      </motion.div>

      {/* Quick Actions */}
      <motion.div variants={staggerItem}>
        <h2 className="text-base font-semibold text-text mb-3">Quick Actions</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <Link key={action.label} to={action.path}>
                <motion.div
                  whileHover={{ y: -4, scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="glass rounded-2xl p-5 transition-all duration-200 hover:shadow-lg hover:shadow-primary/5 cursor-pointer group"
                >
                  <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br ${action.color}/20 text-${action.color === 'from-gold' ? 'gold' : action.color === 'from-accent' ? 'accent' : action.color === 'from-accent-2' ? 'accent-2' : 'primary-soft'}`}>
                    <Icon size={18} />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-medium text-text">{action.label}</span>
                    <ArrowRight size={14} className="text-text-muted group-hover:text-primary-soft transition-colors" />
                  </div>
                </motion.div>
              </Link>
            );
          })}
        </div>
      </motion.div>

      {/* Recent Chats */}
      <motion.div variants={staggerItem}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-text">Recent Chats</h2>
          <Link to="/chat-history" className="text-xs text-primary-soft hover:text-primary transition-colors">
            View all
          </Link>
        </div>

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
                initial={{ opacity: 0.99, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.3 }}
              >
                <Link to={`/chat/${chat.id}`}>
                  <Card hover className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-text truncate">{chat.query_text}</p>
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="flex items-center gap-1 text-xs text-text-dim">
                            <Clock size={11} />
                            {formatTimestamp(chat.created_at)}
                          </span>
                          {chat.model_used && (
                            <span className="text-xs text-text-dim">{chat.model_used}</span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0">
                        {chat.trust_score !== undefined && (
                          <Badge color={trustScoreBadgeColor(chat.trust_score)}>
                            {chat.trust_score.toFixed(2)}
                          </Badge>
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
