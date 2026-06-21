import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Users, Search, UserPlus, User, Shield, Ban, ChevronRight, Clock } from 'lucide-react';
import { Button, Card, Badge, Input, LoadingSpinner, EmptyState, Select, useToast, staggerContainer, staggerItem, pageTransition } from '../components/ui';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
  is_active: boolean;
  last_login: string;
  created_at: string;
}

// ─── Mock Data ─────────────────────────────────────────────────────────────────

const MOCK_USERS: AdminUser[] = [
  { id: 'u1', username: 'alice', email: 'alice@example.com', role: 'admin', is_active: true, last_login: '2026-06-20T08:30:00Z', created_at: '2026-01-15T10:00:00Z' },
  { id: 'u2', username: 'bob', email: 'bob@example.com', role: 'user', is_active: true, last_login: '2026-06-19T14:00:00Z', created_at: '2026-02-20T09:00:00Z' },
  { id: 'u3', username: 'carol', email: 'carol@example.com', role: 'user', is_active: true, last_login: '2026-06-18T11:00:00Z', created_at: '2026-03-10T12:00:00Z' },
  { id: 'u4', username: 'dave', email: 'dave@example.com', role: 'user', is_active: false, last_login: '2026-05-30T16:00:00Z', created_at: '2026-03-15T08:00:00Z' },
  { id: 'u5', username: 'eve', email: 'eve@example.com', role: 'admin', is_active: true, last_login: '2026-06-20T09:00:00Z', created_at: '2026-01-10T14:00:00Z' },
  { id: 'u6', username: 'frank', email: 'frank@example.com', role: 'user', is_active: true, last_login: '2026-06-17T10:00:00Z', created_at: '2026-04-01T11:00:00Z' },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setUsers(MOCK_USERS);
      setLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, []);

  const filtered = users.filter((u) =>
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()),
  );

  function handleRoleChange(userId: string, newRole: 'admin' | 'user') {
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)));
    addToast(`User role updated to ${newRole}`, 'success');
  }

  function handleToggleActive(userId: string) {
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, is_active: !u.is_active } : u)),
    );
    const user = users.find((u) => u.id === userId);
    addToast(`User ${user?.is_active ? 'deactivated' : 'activated'}`, 'info');
  }

  if (loading) {
    return <motion.div variants={pageTransition} initial="initial" animate="animate"><LoadingSpinner text="Loading users..." /></motion.div>;
  }

  return (
    <motion.div
      className="space-y-5"
      variants={pageTransition}
      initial="initial"
      animate="animate"
    >
      {/* Header */}
      <motion.div variants={staggerItem} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">Users</h1>
          <p className="text-sm text-text-muted mt-1">Manage user accounts and permissions.</p>
        </div>
        <Link to="/admin/users/invite">
          <Button size="sm">
            <UserPlus size={14} />
            Invite User
          </Button>
        </Link>
      </motion.div>

      {/* Search */}
      <motion.div variants={staggerItem} className="max-w-md">
        <Input
          placeholder="Search users..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          icon={<Search size={16} />}
        />
      </motion.div>

      {/* Table */}
      <motion.div
        variants={staggerItem}
        className="overflow-x-auto rounded-xl border border-border glass"
      >
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-card-2/80">
              <th className="px-4 py-3 font-medium text-text-muted">User</th>
              <th className="px-4 py-3 font-medium text-text-muted">Email</th>
              <th className="px-4 py-3 font-medium text-text-muted">Role</th>
              <th className="px-4 py-3 font-medium text-text-muted">Status</th>
              <th className="px-4 py-3 font-medium text-text-muted">Last Login</th>
              <th className="px-4 py-3 font-medium text-text-muted">Actions</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12">
                  <EmptyState
                    icon={<Users size={24} />}
                    title="No users found"
                    description={search ? 'Try a different search term.' : 'No users have been created yet.'}
                  />
                </td>
              </tr>
            ) : (
              filtered.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-border last:border-b-0 transition-colors hover:bg-card-2/50"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full glass text-text-muted">
                        <User size={14} />
                      </div>
                      <span className="text-text font-medium">{user.username}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-text-muted text-xs">{user.email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={user.role}
                      onChange={(e) => handleRoleChange(user.id, e.target.value as 'admin' | 'user')}
                      className={`rounded-lg border px-2 py-1 text-xs font-medium transition-all ${
                        user.role === 'admin'
                          ? 'bg-primary/15 text-primary-soft border-primary/20'
                          : 'bg-card-2 text-text-muted border-border'
                      } focus:outline-none focus:ring-2 focus:ring-primary/20`}
                      aria-label="Change user role"
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={user.is_active ? 'green' : 'red'}>
                      {user.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-text-dim text-xs whitespace-nowrap">
                    <span className="flex items-center gap-1">
                      <Clock size={11} />
                      {formatDate(user.last_login)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(user.id)}
                        className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-all ${
                          user.is_active
                            ? 'text-orange hover:bg-orange/10'
                            : 'text-green hover:bg-green/10'
                        }`}
                        aria-label={user.is_active ? 'Deactivate user' : 'Activate user'}
                      >
                        <Ban size={12} />
                        {user.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => navigate(`/admin/users/${user.id}`)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim hover:text-text hover:bg-white/[0.06] transition-all"
                      aria-label="View user details"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </motion.div>

      <motion.p variants={staggerItem} className="text-xs text-text-muted">
        Showing {filtered.length} of {users.length} users
      </motion.p>
    </motion.div>
  );
}
