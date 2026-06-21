import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MessageSquare, Search, Clock, Trash2, ChevronRight } from 'lucide-react';
import { Button, Card, Badge, Input, LoadingSpinner, EmptyState, useToast, staggerContainer, staggerItem, pageTransition } from '../components/ui';
import { queryApi } from '../api/client';
import type { QuerySummary } from '../api/types';

// ─── Mock Data Removed — API source ────────────────────────────────────────────

function trustScoreBadgeColor(score: number | undefined): 'green' | 'orange' | 'red' | 'gray' {
  if (score === undefined) return 'gray';
  if (score >= 0.75) return 'green';
  if (score >= 0.5) return 'orange';
  return 'red';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function ChatHistoryPage() {
  const { addToast } = useToast();
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [chats, setChats] = useState<QuerySummary[]>([]);

  useEffect(() => {
    setLoading(true);
    queryApi.listAll()
      .then((result) => {
        setChats(result.data || []);
        setLoading(false);
      })
      .catch(() => {
        setChats([]);
        setLoading(false);
      });
  }, []);

  const filtered = chats.filter((c) =>
    c.query_text.toLowerCase().includes(search.toLowerCase()),
  );

  async function handleDelete(chat: QuerySummary) {
    try {
      await queryApi.delete(chat.workspace_id, chat.id);
      setChats((prev) => prev.filter((c) => c.id !== chat.id));
      addToast('Chat deleted', 'info');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete chat', 'error');
    }
  }

  return (
    <motion.div
      className="space-y-5"
      variants={pageTransition}
      initial="initial"
      animate="animate"
    >
      {/* Header */}
      <motion.div variants={staggerItem}>
        <h1 className="text-2xl font-bold text-text">Chat History</h1>
        <p className="text-sm text-text-muted mt-1">Browse past conversations and their trust scores.</p>
      </motion.div>

      {/* Search */}
      <motion.div variants={staggerItem} className="max-w-md">
        <Input
          placeholder="Search past chats..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          icon={<Search size={16} />}
        />
      </motion.div>

      {/* List */}
      <motion.div
        className="space-y-2"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        {loading ? (
          <LoadingSpinner text="Loading chat history..." />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<MessageSquare size={24} />}
            title={search ? 'No chats match your search' : 'No chat history'}
            description={search ? 'Try a different search term.' : 'Start a conversation to see your history here.'}
            action={
              !search ? (
                <Link to="/workspaces">
                  <Button size="sm">
                    <MessageSquare size={14} />
                    Start a Chat
                  </Button>
                </Link>
              ) : undefined
            }
          />
        ) : (
          filtered.map((chat, i) => (
            <motion.div
              key={chat.id}
              variants={staggerItem}
            >
              <Card hover className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <Link to={`/chat/${chat.id}`} className="min-w-0 flex-1 group">
                    <p className="text-sm text-text truncate group-hover:text-primary-soft transition-colors">{chat.query_text}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="flex items-center gap-1 text-xs text-text-dim">
                        <Clock size={11} />
                        {formatDate(chat.created_at)}
                      </span>
                      {chat.model_used && (
                        <Badge color="gray">{chat.model_used}</Badge>
                      )}
                      {chat.trust_score !== undefined && (
                        <Badge color={trustScoreBadgeColor(chat.trust_score)}>
                          Score: {chat.trust_score.toFixed(2)}
                        </Badge>
                      )}
                    </div>
                  </Link>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleDelete(chat)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim hover:text-red hover:bg-red/10 transition-all"
                      aria-label="Delete chat"
                    >
                      <Trash2 size={14} />
                    </button>
                    <Link
                      to={`/chat/${chat.id}`}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim hover:text-text hover:bg-white/[0.06] transition-all"
                      aria-label="Open chat"
                    >
                      <ChevronRight size={14} />
                    </Link>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))
        )}
      </motion.div>
    </motion.div>
  );
}
