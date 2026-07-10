import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Clock, FileText, MessageSquare, Plus, Settings, Shield } from 'lucide-react';
import { Badge, Button, Card, EmptyState, LoadingSpinner, pageTransition, staggerContainer, staggerItem } from '../components/ui';
import { PageHeader, PageShell } from '../components/PageWrappers';
import { useAuth } from '../context/AuthContext';
import type { QuerySummary } from '../api/types';
import { getTrustBadgeColor, getTrustColorVar, getTrustStatusLabel } from '../utils/relevance';

const MOCK_STATS = {
  totalDocs: 24,
  recentQueries: 18,
  avgTrustScore: 0.87,
};

const MOCK_RECENT_CHATS: QuerySummary[] = [
  { id: '1', workspace_id: 'w1', query_text: 'What are the key findings in the Q3 report?', trust_score: 0.92, model_used: 'gpt-4', created_at: new Date(Date.now() - 3600000).toISOString() },
  { id: '2', workspace_id: 'w1', query_text: 'Summarize the contractual obligations in section 4.2', trust_score: 0.88, model_used: 'claude-3', created_at: new Date(Date.now() - 7200000).toISOString() },
  { id: '3', workspace_id: 'w1', query_text: 'Compare revenue projections between 2024 and 2025', trust_score: 0.76, model_used: 'gpt-4', created_at: new Date(Date.now() - 86400000).toISOString() },
];

const QUICK_ACTIONS = [
  { label: 'New Chat', path: '/workspaces', icon: MessageSquare },
  { label: 'Browse Documents', path: '/documents', icon: FileText },
  { label: 'View History', path: '/chats', icon: Clock },
  { label: 'Settings', path: '/settings', icon: Settings },
];

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function UserDashboard() {
  const { user } = useAuth();
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
    <div className="-mx-4 px-4 lg:-mx-6 lg:px-8 xl:px-12">
      <motion.div className="mx-auto max-w-[1200px] py-6" variants={pageTransition} initial="initial" animate="animate">
        <PageShell>
          <PageHeader
            title={`${getGreeting()}, ${user?.username || 'User'}`}
            description="Snapshot of your docs, chats, and trust signals."
            actions={(
              <Link to="/workspaces">
                <Button size="md" className="whitespace-nowrap">
                  <Plus size={16} />
                  New Chat
                </Button>
              </Link>
            )}
          />

          <motion.div className="grid gap-4 sm:grid-cols-3" variants={staggerContainer} initial="initial" animate="animate">
            <motion.div variants={staggerItem}>
              <Card>
                <p className="text-sm text-text-muted">Documents Available</p>
                <p className="mt-1 text-2xl font-bold text-text">{MOCK_STATS.totalDocs}</p>
              </Card>
            </motion.div>
            <motion.div variants={staggerItem}>
              <Card>
                <p className="text-sm text-text-muted">Recent Queries</p>
                <p className="mt-1 text-2xl font-bold text-text">{MOCK_STATS.recentQueries}</p>
              </Card>
            </motion.div>
            <motion.div variants={staggerItem}>
              <Card>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-text-muted">Avg Trust Score</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color: getTrustColorVar(MOCK_STATS.avgTrustScore) }}>
                      {MOCK_STATS.avgTrustScore.toFixed(2)}
                    </p>
                  </div>
                  <Badge color={getTrustBadgeColor(MOCK_STATS.avgTrustScore)}>{getTrustStatusLabel(MOCK_STATS.avgTrustScore)}</Badge>
                </div>
              </Card>
            </motion.div>
          </motion.div>

          <motion.div variants={staggerItem}>
            <h2 className="mb-3 text-base font-semibold text-text">Quick Actions</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {QUICK_ACTIONS.map((action) => {
                const Icon = action.icon;
                return (
                  <Link key={action.label} to={action.path}>
                    <Card hover className="p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-text">
                        <Icon size={16} className="text-primary-soft" />
                        {action.label}
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </motion.div>

          <motion.div variants={staggerItem}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-text">Recent Chats</h2>
              <Link to="/chats" className="text-xs text-primary-soft hover:text-primary transition-colors">
                View all
              </Link>
            </div>

            {loading ? (
              <LoadingSpinner text="Loading recent chats..." />
            ) : chats.length === 0 ? (
              <EmptyState
                icon={<MessageSquare size={24} />}
                title="No chats yet"
                description="Start conversation to see recent activity."
                action={(
                  <Link to="/workspaces">
                    <Button size="sm">
                      <MessageSquare size={14} />
                      New Chat
                    </Button>
                  </Link>
                )}
              />
            ) : (
              <div className="space-y-2">
                {chats.map((chat) => (
                  <Link key={chat.id} to={`/chat/${chat.id}`}>
                    <Card hover className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-text">{chat.query_text}</p>
                          <div className="mt-1.5 flex items-center gap-3 text-xs text-text-dim">
                            <span className="flex items-center gap-1">
                              <Clock size={11} />
                              {formatTimestamp(chat.created_at)}
                            </span>
                            {chat.model_used && <span>{chat.model_used}</span>}
                          </div>
                        </div>
                        {chat.trust_score !== undefined && (
                          <Badge color={getTrustBadgeColor(chat.trust_score)}>{chat.trust_score.toFixed(2)}</Badge>
                        )}
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </motion.div>

          <motion.div variants={staggerItem}>
            <Card className="border-border/50 bg-white/[0.02] p-4">
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <Shield size={14} className="text-primary-soft" />
                Behavior unchanged. UI now aligned with shared page wrappers.
              </div>
            </Card>
          </motion.div>
        </PageShell>
      </motion.div>
    </div>
  );
}
