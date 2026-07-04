import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Search, UserPlus, User, Ban, ChevronRight, Clock } from 'lucide-react';
import { Button, Badge, LoadingSpinner, EmptyState, useToast, staggerContainer, staggerItem, pageTransition } from '../components/ui';
import AnimatedInput from '../components/premium/AnimatedInput';
import { adminApi } from '../api/client';
import type { User as AdminUserType } from '../api/types';

interface AdminUser extends AdminUserType {
  last_login: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
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
        <LoadingSpinner text="Loading users..." />
      </motion.div>
    );
  }

  if (usersQuery.isError) {
    return (
      <motion.div
        variants={pageTransition}
        initial="initial"
        animate="animate"
        className="flex flex-col items-center justify-center py-20 gap-4"
      >
        <p className="text-text-muted">Failed to load users</p>
        <Button onClick={() => usersQuery.refetch()} size="sm">Retry</Button>
      </motion.div>
    );
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
          <h1 className="text-2xl font-bold gradient-text">Users</h1>
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
        <AnimatedInput
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
                  className="border-b border-border last:border-b-0 transition-colors hover:bg-white/[0.03] cursor-pointer"
                  onClick={() => navigate(`/admin/users/${user.id}`)}
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
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => roleMutation.mutate({ userId: user.id, role: e.target.value })}
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
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => statusMutation.mutate({ userId: user.id, isActive: !user.is_active })}
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
                    <motion.button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); navigate(`/admin/users/${user.id}`); }}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim hover:text-text hover:bg-white/[0.06] transition-all"
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
    </motion.div>
  );
}
