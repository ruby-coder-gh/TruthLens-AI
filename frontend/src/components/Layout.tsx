import { useState, useEffect } from 'react';
import { Link, useLocation, Outlet, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import {
  LayoutDashboard,
  FileText,
  Shield,
  MessageSquare,
  Search,
  User,
  BookOpen,
  Home,
  Clock,
  Settings,
  LogOut,
  Upload,
  Users,
  BarChart3,
  ClipboardList,
  ClipboardCheck,
  FolderOpen,
  GitBranch,
  Sparkles,
  Menu,
  X,
} from 'lucide-react';
import { useAuth } from '../context/auth-context';
import Logo from './Logo';
import GlobalSearch from './GlobalSearch';
import { reviewQueueApi } from '../api/client';

// ─── Ambient Background ───────────────────────────────────────────────────────
function AmbientBackground() {
  return (
    <>
      <div className="bg-grid" />
      <div className="ambient-blob ambient-blob-1" />
      <div className="ambient-blob ambient-blob-2" />
      <div className="ambient-blob ambient-blob-3" />
    </>
  );
}

// ─── Nav items ────────────────────────────────────────────────────────────────
interface NavItem {
  label: string;
  path: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', path: '/dashboard', icon: Home },
  { label: 'Chat History', path: '/chats', icon: Clock },
  { label: 'My Documents', path: '/documents', icon: FileText },
  { label: 'Workspaces', path: '/workspaces', icon: LayoutDashboard },
  { label: 'Settings', path: '/settings', icon: Settings },
  // ── Admin ──
  { label: 'Admin Dashboard', path: '/admin', icon: Shield, adminOnly: true },
  { label: 'Documents', path: '/admin/documents', icon: FileText, adminOnly: true },
  { label: 'Upload', path: '/admin/documents/upload', icon: Upload, adminOnly: true },
  { label: 'Users', path: '/admin/users', icon: Users, adminOnly: true },
  { label: 'Analytics', path: '/admin/analytics', icon: BarChart3, adminOnly: true },
  { label: 'Settings', path: '/admin/settings', icon: Settings, adminOnly: true },
  { label: 'Audit Log', path: '/admin/audit-log', icon: ClipboardList, adminOnly: true },
  { label: 'Prompts', path: '/admin/prompts', icon: GitBranch, adminOnly: true },
  { label: 'Golden Set', path: '/admin/golden', icon: Sparkles, adminOnly: true },
  { label: 'Collections', path: '/admin/collections', icon: FolderOpen, adminOnly: true },
  { label: 'API Catalog', path: '/api-catalog', icon: BookOpen, adminOnly: true },
];

// ─── Glow particles ─────────────────────────────────────────────────────────
function NavGlowParticles() {
  return (
    <span className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <motion.span
          key={i}
          className="absolute w-1 h-1 rounded-full bg-primary-soft"
          style={{ left: `${20 + i * 20}%`, top: '50%' }}
          initial={{ y: 0, opacity: 0 }}
          animate={{
            y: [0, -15 - ((i * 7) % 10)],
            opacity: [0, 0.6, 0],
          }}
          transition={{ duration: 1.5, delay: i * 0.3, repeat: Infinity, ease: 'easeOut' }}
        />
      ))}
    </span>
  );
}

// ─── Sidebar nav item component (animated glowing) ──────────────────────────
function NavItemLink({ item, active, collapsed, onClick }: { item: NavItem; active: boolean; collapsed: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.path}
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      className={clsx('relative block group', collapsed ? 'mx-auto' : '')}
    >
      {active && (
        <motion.div
          layoutId="navHighlight"
          className="absolute inset-0 rounded-xl bg-primary/10 border border-primary/20"
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        />
      )}

      {/* Active glow background */}
      {active && (
        <motion.div
          className="absolute inset-0 rounded-xl"
          style={{
            background: 'radial-gradient(circle at 30% 50%, rgba(99,102,241,0.12), transparent)',
          }}
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {/* Active floating particles */}
      {active && <NavGlowParticles />}

      <motion.div
        className={clsx(
          'relative z-10 flex items-center rounded-xl text-sm font-medium transition-all duration-300',
          collapsed ? 'justify-center w-10 h-10' : 'gap-3 px-3 py-2.5',
          active
            ? 'text-primary-soft'
            : 'text-text-muted group-hover:text-text group-hover:bg-white/[0.04]',
        )}
        whileHover={collapsed ? { scale: 1.05 } : { x: 3 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        <motion.span
          className="flex items-center justify-center"
          whileHover={{ scale: 1.15 }}
          transition={{ duration: 0.2 }}
        >
          <Icon
            size={18}
            strokeWidth={active ? 2.5 : 1.5}
            style={{
              filter: active ? 'drop-shadow(0 0 6px rgba(99,102,241,0.5))' : 'none',
            }}
          />
        </motion.span>
        <motion.span
          animate={{ opacity: collapsed ? 0 : 1, width: collapsed ? 0 : 'auto' }}
          transition={{ type: 'spring', damping: 22, stiffness: 180, mass: 0.8 }}
          className="overflow-hidden whitespace-nowrap"
        >
          {item.label}
        </motion.span>
      </motion.div>
    </Link>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function Layout() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);
  const workspaceMatch = location.pathname.match(/^\/workspaces\/([^/]+)/);
  const activeWorkspaceId = workspaceMatch?.[1];

  useEffect(() => {
    if (!activeWorkspaceId) {
      const reset = window.setTimeout(() => setReviewCount(0), 0);
      return () => window.clearTimeout(reset);
    }
    reviewQueueApi.count(activeWorkspaceId).then((response) => setReviewCount(response.count)).catch(() => setReviewCount(0));
  }, [activeWorkspaceId]);

  const closeSidebar = () => setSidebarOpen(false);
  const filteredNav = navItems.filter((item) => !item.adminOnly || user?.role === 'admin');

  const isActive = (path: string) => {
    if (path === '/dashboard') return location.pathname === '/dashboard';
    if (path === '/chats') return location.pathname === '/chats';
    if (path === '/documents') return location.pathname === '/documents';
    if (path === '/workspaces') return location.pathname === '/workspaces' || location.pathname.startsWith('/workspaces/');
    if (path === '/settings') return location.pathname === '/settings';
    if (path === '/api-catalog') return location.pathname === '/api-catalog';
    if (path === '/admin') return location.pathname === '/admin';
    if (path === '/admin/documents') return location.pathname === '/admin/documents' || location.pathname.startsWith('/admin/documents/') && !location.pathname.startsWith('/admin/documents/upload');
    if (path === '/admin/documents/upload') return location.pathname === '/admin/documents/upload';
    if (path === '/admin/users') return location.pathname === '/admin/users' || location.pathname.startsWith('/admin/users/');
    if (path === '/admin/analytics') return location.pathname === '/admin/analytics';
    if (path === '/admin/settings') return location.pathname === '/admin/settings';
    if (path === '/admin/audit-log') return location.pathname === '/admin/audit-log';
    if (path === '/admin/prompts') return location.pathname === '/admin/prompts';
    if (path === '/admin/golden') return location.pathname === '/admin/golden';
    if (path === '/admin/collections') return location.pathname === '/admin/collections';
    return location.pathname.startsWith(path);
  };

  if (!isAuthenticated) return <Outlet />;

  return (
    <div className="relative flex h-screen overflow-hidden bg-bg">
      {/* Animated background (fixed) */}
      <AmbientBackground />

      {/* Mobile overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0.99 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0.99 }}
            className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
            onClick={closeSidebar}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      {/* ─── Sidebar ──────────────────────────────────────────────────── */}
      <motion.aside
        id="app-sidebar"
        animate={{ width: collapsed ? 64 : 256 }}
        transition={{ type: 'spring', damping: 22, stiffness: 180, mass: 0.8 }}
        className={clsx(
          'fixed inset-y-0 left-0 z-40 flex flex-col overflow-hidden',
          'lg:translate-x-0 lg:static',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Glass sidebar */}
        <div className="absolute inset-0 bg-[#0b0f17]/90 backdrop-blur-2xl border-r border-white/[0.06]" />

        {/* Brand — click to toggle collapse */}
        <div
          onClick={() => setCollapsed((prev) => !prev)}
          className={clsx(
            'relative z-10 flex h-16 cursor-pointer items-center border-b border-white/[0.06] transition-all duration-300',
            collapsed ? 'justify-center px-0' : 'gap-3 px-6',
          )}
        >
          <Logo size={22} variant="gradient-bg" />
          <motion.div
            animate={{ opacity: collapsed ? 0 : 1, width: collapsed ? 0 : 'auto' }}
            transition={{ type: 'spring', damping: 22, stiffness: 180, mass: 0.8 }}
            className={clsx('overflow-hidden whitespace-nowrap', collapsed ? 'invisible' : 'visible')}
          >
            <span className="text-base font-bold text-text">TruthLens</span>
            <span className="block text-[10px] uppercase tracking-widest text-text-dim">AI Platform</span>
          </motion.div>
        </div>

        {/* Navigation */}
        <nav className={clsx(
          'relative z-10 flex-1 overflow-y-auto py-5 space-y-0.5',
          collapsed ? 'px-0 flex flex-col items-center' : 'px-3',
        )}>
          {filteredNav.map((item) => (
            <NavItemLink key={item.path} item={item} active={isActive(item.path)} collapsed={collapsed} onClick={closeSidebar} />
          ))}
          {activeWorkspaceId && (
            <Link to={`/workspaces/${activeWorkspaceId}/review-queue`} onClick={closeSidebar} className={clsx('relative flex items-center rounded-xl text-sm font-medium text-text-muted transition-colors hover:bg-primary/10 hover:text-primary-soft', collapsed ? 'justify-center h-10 w-10' : 'gap-3 px-3 py-2.5')} title={collapsed ? 'Review Queue' : undefined}>
              <ClipboardCheck size={18} />
              {!collapsed && <span className="flex-1">Review Queue</span>}
              {reviewCount > 0 && <span className="rounded-full bg-red/20 px-1.5 py-0.5 text-[10px] font-semibold text-red">{reviewCount}</span>}
            </Link>
          )}

          {/* Quick actions */}
          <div className={clsx('pt-5 mt-5 border-t border-white/[0.06]', collapsed ? 'flex flex-col items-center px-0' : '')}>
            {!collapsed && (
              <p className="px-3 pb-2 text-[10px] uppercase tracking-widest text-text-dim font-medium">Quick Links</p>
            )}
            <Link
              to="/chat/new"
              onClick={closeSidebar}
              className={clsx(
                'flex items-center rounded-xl text-sm text-text-muted hover:text-text hover:bg-white/[0.04] transition-colors',
                collapsed ? 'justify-center w-10 h-10' : 'gap-3 px-3 py-2.5',
              )}
              title={collapsed ? 'New Chat' : undefined}
            >
              <MessageSquare size={16} />
              {!collapsed && <span>New Chat</span>}
            </Link>
            <Link
              to="/documents"
              onClick={closeSidebar}
              className={clsx(
                'flex items-center rounded-xl text-sm text-text-muted hover:text-text hover:bg-white/[0.04] transition-colors',
                collapsed ? 'justify-center w-10 h-10' : 'gap-3 px-3 py-2.5',
              )}
              title={collapsed ? 'Browse Documents' : undefined}
            >
              <Search size={16} />
              {!collapsed && <span>Browse Documents</span>}
            </Link>
          </div>
        </nav>

        {/* User info — with glow */}
        {user && (
          <div className={clsx('relative z-10 border-t border-white/[0.06]', collapsed ? 'p-2' : 'p-4')}>
            <div
              className={clsx(
                'relative overflow-hidden rounded-xl transition-transform duration-150',
                collapsed ? 'flex justify-center p-2' : 'p-3 hover:scale-[1.02]',
              )}
              title={collapsed ? `${user.username} (${user.role})` : undefined}
            >
              {/* Floating glow particles */}
              <span className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
                {Array.from({ length: 3 }).map((_, i) => (
                  <motion.span
                    key={i}
                    className="absolute w-1 h-1 rounded-full bg-primary-soft"
                    style={{ left: `${30 + i * 20}%`, top: '40%' }}
                    initial={{ y: 0, opacity: 0 }}
                    animate={{
                      y: [0, -12 - ((i * 5) % 8)],
                      opacity: [0, 0.5, 0],
                    }}
                    transition={{ duration: 1.5, delay: i * 0.4, repeat: Infinity, ease: 'easeOut' }}
                  />
                ))}
              </span>
              <div className={clsx('relative z-10 flex items-center', collapsed ? 'justify-center' : 'gap-3')}>
                <motion.div
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-accent/30 border border-white/[0.08] transition-transform duration-150"
                  animate={{
                    boxShadow: [
                      '0 0 6px 2px rgba(99,102,241,0.15)',
                      '0 0 12px 5px rgba(99,102,241,0.25)',
                      '0 0 6px 2px rgba(99,102,241,0.15)',
                    ],
                  }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                  whileHover={{ scale: 1.1 }}
                >
                  <motion.span
                    animate={{ filter: ['drop-shadow(0 0 3px rgba(99,102,241,0.3))', 'drop-shadow(0 0 8px rgba(99,102,241,0.5))', 'drop-shadow(0 0 3px rgba(99,102,241,0.3))'] }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <User size={16} className="text-text-muted" />
                  </motion.span>
                </motion.div>
                {!collapsed && (
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-text">{user.username}</p>
                    <p className="truncate text-xs text-text-dim">{user.email}</p>
                  </div>
                )}
                {!collapsed && user.role === 'admin' && (
                  <motion.span
                    className="rounded-md bg-primary/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-soft border border-primary/20"
                    animate={{ opacity: [0.7, 1, 0.7] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    Admin
                  </motion.span>
                )}
              </div>
            </div>
            <button
              onClick={() => { void logout(); navigate('/login'); }}
              className={clsx(
                'relative z-10 mt-2 flex items-center rounded-xl text-text-muted transition-all duration-200 hover:bg-red-500/10 hover:text-red-400',
                collapsed ? 'mx-auto h-10 w-10 justify-center p-0' : 'w-full gap-3 px-3 py-2 text-sm',
              )}
              title={collapsed ? 'Sign out' : undefined}
              aria-label="Sign out"
            >
              <LogOut size={16} />
              {!collapsed && <span>Sign out</span>}
            </button>
          </div>
        )}
        </motion.aside>

      {/* ─── Main area ────────────────────────────────────────────────── */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="px-4 pt-4 lg:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-controls="app-sidebar"
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="inline-flex items-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.03] px-3 py-2 text-sm text-text-muted transition-colors hover:text-text"
          >
            {sidebarOpen ? <X size={16} /> : <Menu size={16} />}
            <span>{sidebarOpen ? 'Close menu' : 'Open menu'}</span>
          </button>
        </div>

        <div className="hidden border-b border-white/[0.06] px-4 py-3 lg:flex lg:items-center lg:justify-end">
          <GlobalSearch />
        </div>
        <div className="px-4 pt-4 lg:hidden">
          <GlobalSearch />
        </div>

        {/* Content */}
        <main className="relative min-w-0 flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
