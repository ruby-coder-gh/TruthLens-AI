import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Search, UserPlus, User, Ban, ChevronDown, ChevronRight, Clock } from 'lucide-react';
import { Button, Badge, Input, EmptyState } from '../components/ui';
import { staggerContainer, staggerItem, pageTransition } from '../components/motion';
import { useToast } from '../components/toast-context';
import { PageHeader, PageShell, StateBlock } from '../components/PageWrappers';
import { adminApi } from '../api/client';
import type { User as AdminUserType } from '../api/types';

interface AdminUser extends AdminUserType {
  last_login_at: string | null;
}

// Handles null (never logged in) and invalid/unparseable values gracefully —
// never renders the native "Invalid Date" string.
function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Never';
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function AdminUsersPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const usersQuery = useQuery({
    queryKey: ['admin', 'users', page],
    queryFn: () => adminApi.listUsers({ page, page_size: 20 }),
  });

  const usersData = usersQuery.data as
    | { data: AdminUser[]; meta: { page: number; page_size: number; total: number } }
    | undefined;

  const allUsers = usersData?.data ?? [];
  const total = usersData?.meta?.total ?? 0;
  const pageSize = usersData?.meta?.page_size ?? 20;
  const totalPages = Math.ceil(total / pageSize);

  const filtered = allUsers.filter((u) =>
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()),
  );

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      adminApi.updateUserRole(userId, role),
    onSuccess: (_data, variables) => {
      addToast(`User role updated to ${variables.role}`, 'success');
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: () => {
      addToast('Failed to update role', 'error');
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ userId, isActive }: { userId: string; isActive: boolean }) =>
      adminApi.updateUserStatus(userId, isActive),
    onSuccess: (_data, variables) => {
      addToast(`User ${variables.isActive ? 'activated' : 'deactivated'}`, 'info');
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: () => {
      addToast('Failed to update status', 'error');
    },
  });

  if (usersQuery.isLoading) {
    return (
      <motion.div variants={pageTransition} initial="initial" animate="animate">
        <PageShell>
          <PageHeader title="Users" description="Manage user accounts and permissions." />
          <StateBlock role="status">Loading users…</StateBlock>
        </PageShell>
      </motion.div>
    );
  }

  if (usersQuery.isError) {
    return (
      <motion.div variants={pageTransition} initial="initial" animate="animate">
        <PageShell>
          <PageHeader title="Users" description="Manage user accounts and permissions." />
          <StateBlock tone="danger" role="alert" className="space-y-3">
            <p>Failed to load users.</p>
            <Button onClick={() => usersQuery.refetch()} size="sm" variant="secondary">Retry</Button>
          </StateBlock>
        </PageShell>
      </motion.div>
    );
  }

  return (
    <motion.div variants={pageTransition} initial="initial" animate="animate">
      <PageShell>
      {/* Header */}
      <motion.div variants={staggerItem}>
        <PageHeader
          title="Users"
          description="Manage user accounts and permissions."
          actions={(
            <Link to="/admin/users/invite">
              <Button size="sm">
                <UserPlus size={14} />
                Invite User
              </Button>
            </Link>
          )}
        />
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
        className="overflow-x-auto rounded-card border border-border bg-solid shadow-e1"
      >
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-card-2">
              <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-dim">User</th>
              <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-dim">Email</th>
              <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-dim">Role</th>
              <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-dim">Status</th>
              <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-dim">Last Login</th>
              <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-dim">Actions</th>
              <th className="w-10" />
            </tr>
          </thead>
          <motion.tbody variants={staggerContainer} initial="initial" animate="animate">
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
                <motion.tr
                  key={user.id}
                  variants={staggerItem}
                  className="cursor-pointer border-b border-border-light transition-colors last:border-b-0 hover:bg-card-2"
                  onClick={() => navigate(`/admin/users/${user.id}`)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card-2 text-text-muted">
                        <User size={14} />
                      </div>
                      <span className="text-text font-medium">{user.username}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-text-muted text-xs">{user.email}</td>
                  <td className="px-4 py-3">
                    {/* appearance-none so the themed surface paints: a native
                        select widget ignores it and stays light in dark mode. */}
                    <div className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={user.role}
                        onChange={(e) => roleMutation.mutate({ userId: user.id, role: e.target.value })}
                        className={`appearance-none rounded-chip border py-1 pl-2 pr-7 text-xs font-medium transition-colors ${
                          user.role === 'admin'
                            ? 'border-primary/30 bg-primary/12 text-primary-soft'
                            : 'border-border bg-solid text-text-muted'
                        } focus:outline-none focus:ring-2 focus:ring-primary/30`}
                        aria-label="Change user role"
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                      <ChevronDown
                        size={12}
                        aria-hidden="true"
                        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-dim"
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={user.is_active ? 'green' : 'red'}>
                      {user.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-text-dim text-xs whitespace-nowrap">
                    <span className="flex items-center gap-1">
                      <Clock size={11} />
                      {formatDate(user.last_login_at)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => statusMutation.mutate({ userId: user.id, isActive: !user.is_active })}
                        className={`flex items-center gap-1 rounded-chip px-2 py-1 text-xs font-medium transition-colors ${
                          user.is_active
                            ? 'text-orange hover:bg-orange/12'
                            : 'text-green hover:bg-green/12'
                        }`}
                        aria-label={user.is_active ? 'Deactivate user' : 'Activate user'}
                      >
                        <Ban size={12} />
                        {user.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <motion.button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); navigate(`/admin/users/${user.id}`); }}
                      className="flex h-7 w-7 items-center justify-center rounded-chip text-text-dim transition-colors hover:bg-card-2 hover:text-text"
                      aria-label="View user details"
                      whileHover={{ scale: 1.1, x: 2 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <ChevronRight size={14} />
                    </motion.button>
                  </td>
                </motion.tr>
              ))
            )}
          </motion.tbody>
        </table>
      </motion.div>

      {/* Pagination */}
      {totalPages > 1 ? (
        <motion.div variants={staggerItem} className="flex items-center justify-between">
          <p className="text-xs text-text-muted">
            Showing {filtered.length} of {total} users
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              Previous
            </Button>
            <span className="text-xs text-text-muted px-1">
              Page {page} of {totalPages}
            </span>
            <Button
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next
            </Button>
          </div>
        </motion.div>
      ) : (
        <motion.p variants={staggerItem} className="text-xs text-text-muted">
          Showing {filtered.length} of {total} users
        </motion.p>
      )}
      </PageShell>
    </motion.div>
  );
}
