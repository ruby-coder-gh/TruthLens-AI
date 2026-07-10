import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, User, Calendar, Clock, MessageSquare, FileText, Ban, Trash2, AlertTriangle } from 'lucide-react';
import { Button, Card, Badge, Modal, useToast, pageTransition } from '../components/ui';
import { PageHeader, PageShell, StateBlock } from '../components/PageWrappers';
import { adminApi } from '../api/client';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: string;
  is_active: boolean;
  last_login?: string;
  created_at: string;
}

interface RecentQuery {
  id: string;
  query_text: string;
  trust_score: number;
  created_at: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function trustScoreBadgeColor(score: number): 'green' | 'orange' | 'red' | 'gray' {
  if (score >= 0.75) return 'green';
  if (score >= 0.5) return 'orange';
  return 'red';
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function AdminUserDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AdminUser | null>(null);
  const [queries, setQueries] = useState<RecentQuery[]>([]);
  const [confirmModal, setConfirmModal] = useState<{ action: 'deactivate' | 'delete' } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    (async () => {
      try {
        const [userData, activityData] = await Promise.all([
          adminApi.getUser(userId),
          adminApi.getUserActivity(userId),
        ]);
        setUser(userData as AdminUser);
        setQueries(((activityData as unknown as { data?: RecentQuery[] }).data || []) as RecentQuery[]);
      } catch (err) {
        addToast(err instanceof Error ? err.message : 'Failed to load user', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [userId, addToast]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleToggleActive() {
    if (!user) return;
    setActionLoading(true);
    try {
      const updated = await adminApi.updateUserStatus(userId!, !user.is_active);
      setUser(updated as AdminUser);
      setConfirmModal(null);
      addToast(`User ${(updated as AdminUser).is_active ? 'activated' : 'deactivated'}`, 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to update user status', 'error');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDelete() {
    if (!userId) return;
    setActionLoading(true);
    try {
      await adminApi.deleteUser(userId);
      setConfirmModal(null);
      addToast('User deleted', 'success');
      navigate('/admin/users');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete user', 'error');
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <motion.div variants={pageTransition} initial="initial" animate="animate">
        <PageShell className="max-w-3xl">
          <PageHeader title="User Details" description="Inspect account profile, access level, and recent activity." />
          <StateBlock role="status">Loading user…</StateBlock>
        </PageShell>
      </motion.div>
    );
  }

  if (!user) {
    return (
      <motion.div variants={pageTransition} initial="initial" animate="animate">
        <PageShell className="max-w-3xl">
          <PageHeader title="User Details" description="Inspect account profile, access level, and recent activity." />
          <StateBlock role="alert" className="space-y-3">
            <p>The requested user could not be found.</p>
            <Button variant="secondary" size="sm" onClick={() => navigate('/admin/users')}>Back to Users</Button>
          </StateBlock>
        </PageShell>
      </motion.div>
    );
  }

  const queryCount = queries.length;

  return (
    <motion.div variants={pageTransition} initial="initial" animate="animate">
      <PageShell className="max-w-3xl">
      {/* Back */}
      <button
        type="button"
        onClick={() => navigate('/admin/users')}
        className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text transition-colors"
      >
        <ArrowLeft size={14} />
        Back to Users
      </button>

      <PageHeader
        title="User Details"
        description="Inspect account profile, access level, and recent activity."
      />

      {/* User Info Card */}
      <Card className="p-5 lg:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full glass text-primary-soft">
              <User size={28} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-text">{user.username}</h1>
              <p className="text-sm text-text-muted">{user.email}</p>
              <div className="flex items-center gap-2 mt-2">
                <Badge color={user.role === 'admin' ? 'purple' : 'blue'}>{user.role}</Badge>
                <Badge color={user.is_active ? 'green' : 'red'}>{user.is_active ? 'Active' : 'Inactive'}</Badge>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmModal({ action: 'deactivate' })}
            >
              <Ban size={14} />
              {user.is_active ? 'Deactivate' : 'Activate'}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => setConfirmModal({ action: 'delete' })}
            >
              <Trash2 size={14} />
              Delete
            </Button>
          </div>
        </div>

        {/* Details */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-5 border-t border-border">
          <div>
            <p className="text-xs text-text-dim">User ID</p>
            <p className="text-xs font-mono text-text-muted">{user.id}</p>
          </div>
          <div>
            <p className="text-xs text-text-dim">Created</p>
            <p className="flex items-center gap-1 text-xs text-text"><Calendar size={11} /> {formatDate(user.created_at)}</p>
          </div>
          <div>
            <p className="text-xs text-text-dim">Last Login</p>
            <p className="flex items-center gap-1 text-xs text-text"><Clock size={11} /> {user.last_login ? formatDate(user.last_login) : 'Never'}</p>
          </div>
          <div>
            <p className="text-xs text-text-dim">Role</p>
            <select
              value={user.role}
              onChange={async (e) => {
                const newRole = e.target.value;
                try {
                  await adminApi.updateUserRole(user.id, newRole);
                  setUser((prev) => prev ? { ...prev, role: newRole } : null);
                  addToast(`Role changed to ${newRole}`, 'success');
                } catch (err) {
                  addToast(err instanceof Error ? err.message : 'Failed to update role', 'error');
                }
              }}
              className="rounded-lg border border-border bg-bg-soft/60 px-2 py-1 text-xs text-text focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Activity Summary */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg glass text-accent">
              <MessageSquare size={20} />
            </div>
            <div>
              <p className="text-sm text-text-muted">Total Queries</p>
              <p className="text-xl font-bold text-text tabular-nums">{queryCount}</p>
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg glass text-primary-soft">
              <FileText size={20} />
            </div>
            <div>
              <p className="text-sm text-text-muted">Documents Uploaded</p>
              <p className="text-xl font-bold text-text tabular-nums">—</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Recent Queries */}
      <Card className="p-5 lg:p-6">
        <h2 className="text-sm font-semibold text-text mb-3 flex items-center gap-2">
          <MessageSquare size={14} className="text-accent" />
          Recent Queries
        </h2>
        {queries.length === 0 ? (
          <p className="text-sm text-text-muted py-4 text-center">No queries recorded.</p>
        ) : (
          <div className="space-y-2">
            {queries.map((q) => (
              <div key={q.id} className="rounded-xl glass p-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-text truncate">&ldquo;{q.query_text}&rdquo;</p>
                  <p className="text-xs text-text-dim mt-0.5">{formatDate(q.created_at)}</p>
                </div>
                <Badge color={trustScoreBadgeColor(q.trust_score)}>
                  {q.trust_score.toFixed(2)}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Confirmation Modal */}
      <Modal
        open={confirmModal !== null}
        onClose={() => setConfirmModal(null)}
        title={confirmModal?.action === 'delete' ? 'Delete User' : 'Confirm Action'}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl bg-red/10 border border-red/20 p-4">
            <AlertTriangle size={20} className="text-red shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red">
                {confirmModal?.action === 'delete' ? 'Delete this user?' : `${user?.is_active ? 'Deactivate' : 'Activate'} this user?`}
              </p>
              <p className="text-xs text-text-muted mt-1">
                {confirmModal?.action === 'delete'
                  ? `This will permanently delete ${user?.username}'s account and all associated data.`
                  : `${user?.is_active ? 'Deactivating' : 'Activating'} will ${user?.is_active ? 'prevent' : 'allow'} ${user?.username} from accessing the platform.`
                }
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button
              variant="danger"
              size="sm"
              loading={actionLoading}
              onClick={confirmModal?.action === 'delete' ? handleDelete : handleToggleActive}
            >
              {confirmModal?.action === 'delete' ? 'Delete' : user?.is_active ? 'Deactivate' : 'Activate'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirmModal(null)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
      </PageShell>
    </motion.div>
  );
}
