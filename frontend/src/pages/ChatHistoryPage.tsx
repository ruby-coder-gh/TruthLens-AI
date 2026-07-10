import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MessageSquare, Search, Clock, Trash2, ChevronRight } from 'lucide-react';
import { Button, Card, Badge, Input, LoadingSpinner, EmptyState } from '../components/ui';
import { staggerContainer, staggerItem, pageTransition } from '../components/motion';
import { useToast } from '../components/toast-context';
import { PageHeader, PageShell } from '../components/PageWrappers';
import { queryApi } from '../api/client';
import type { QuerySummary } from '../api/types';
import { getTrustBadgeColor } from '../utils/relevance';

// ─── Mock Data Removed — API source ────────────────────────────────────────────

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
    <div className="-mx-4 lg:-mx-6 px-4 lg:px-8 xl:px-12">
      <motion.div
        className="mx-auto max-w-4xl space-y-5 py-6"
        variants={pageTransition}
        initial="initial"
        animate="animate"
      >
      <PageShell>
      <motion.div variants={staggerItem}>
        <PageHeader
          title="Chat History"
          description="Browse past conversations and their trust scores."
        />
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
          filtered.map((chat) => (
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
                        <Badge color={getTrustBadgeColor(chat.trust_score)}>
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
      </PageShell>
      </motion.div>
    </div>
  );
}
