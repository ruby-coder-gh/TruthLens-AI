import { useState } from 'react';
import { Link, useLocation, Outlet } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import {
  LayoutDashboard,
  FileText,
  Shield,
  MessageSquare,
  Search,
  User,
  LogOut,
  Menu,
  X,
  Sparkles,
  BookOpen,
  Home,
  Clock,
  Settings,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

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
  { label: 'Documents', path: '/documents', icon: FileText },
  { label: 'Workspaces', path: '/workspaces', icon: LayoutDashboard },
  { label: 'Settings', path: '/settings', icon: Settings },
  { label: 'API Catalog', path: '/api-catalog', icon: BookOpen, adminOnly: true },
  { label: 'Admin', path: '/admin', icon: Shield, adminOnly: true },
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
            y: [0, -15 - Math.random() * 10],
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
            background: 'radial-gradient(circle at 30% 50%, rgba(139,92,246,0.12), transparent)',
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
              filter: active ? 'drop-shadow(0 0 6px rgba(139,92,246,0.5))' : 'none',
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
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const closeSidebar = () => setSidebarOpen(false);
  const filteredNav = navItems.filter((item) => !item.adminOnly || user?.role === 'admin');

  const isActive = (path: string) => {
    if (path === '/dashboard') return location.pathname === '/dashboard';
    if (path === '/chats') return location.pathname === '/chats';
    if (path === '/documents') return location.pathname === '/documents';
    if (path === '/workspaces') return location.pathname === '/workspaces' || location.pathname.startsWith('/workspaces/');
    if (path === '/settings') return location.pathname === '/settings';
    if (path === '/api-catalog') return location.pathname === '/api-catalog';
    if (path === '/admin') return location.pathname === '/admin' || location.pathname.startsWith('/admin/');
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
        animate={{ width: collapsed ? 64 : 256 }}
        transition={{ type: 'spring', damping: 22, stiffness: 180, mass: 0.8 }}
        className={clsx(
          'fixed inset-y-0 left-0 z-40 flex flex-col overflow-hidden',
          'lg:translate-x-0 lg:static',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Glass sidebar */}
        <div className="absolute inset-0 bg-[#0a0e17]/90 backdrop-blur-2xl border-r border-white/[0.06]" />

        {/* Brand — click to toggle collapse */}
        <div
          onClick={() => setCollapsed((prev) => !prev)}
          className={clsx(
            'relative z-10 flex h-16 cursor-pointer items-center border-b border-white/[0.06] transition-all duration-300',
            collapsed ? 'justify-center px-0' : 'gap-3 px-6',
          )}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-white text-sm font-bold shadow-lg shadow-primary/30 transition-transform duration-150 hover:scale-110 hover:rotate-[10deg] shrink-0">
            <Sparkles size={16} />
          </div>
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

        {/* User info */}
        {user && (
          <div className="relative z-10 border-t border-white/[0.06] p-4">
            <div className="rounded-xl bg-white/[0.03] p-3 transition-transform duration-150 hover:scale-[1.02]">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-accent/30 border border-white/[0.08] text-text-muted transition-transform duration-150 hover:scale-110">
                  <User size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-text">{user.username}</p>
                  <p className="truncate text-xs text-text-dim">{user.email}</p>
                </div>
                {user.role === 'admin' && (
                  <span className="rounded-md bg-primary/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-soft border border-primary/20">
                    Admin
                  </span>
                )}
              </div>
              <Link
                to="/settings"
                onClick={closeSidebar}
                className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-muted transition-all duration-150 hover:scale-[1.02] hover:bg-white/[0.05] hover:text-text active:scale-[0.98]"
              >
                <Settings size={15} />
                <span>Settings</span>
              </Link>
              <button
                type="button"
                onClick={logout}
                className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-muted transition-all duration-150 hover:scale-[1.02] hover:bg-white/[0.05] hover:text-red active:scale-[0.98]"
              >
                <LogOut size={15} />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        )}
        </motion.aside>

      {/* ─── Main area ────────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-16 items-center gap-4 border-b border-white/[0.06] bg-[#0a0e17]/60 backdrop-blur-xl px-4 lg:px-6">
          <button
            type="button"
            onClick={() => setSidebarOpen((prev) => !prev)}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-text-muted transition-all duration-150 hover:scale-110 hover:bg-white/[0.06] hover:text-text active:scale-90 lg:hidden"
            aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>

          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-text-dim">/</span>
            <span className="text-text-muted">{location.pathname.split('/').filter(Boolean).join(' / ')}</span>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden sm:block text-xs text-text-dim">
              {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </span>
          </div>
        </header>

        {/* Content */}
        <main className="relative flex-1 overflow-y-auto">
          <div className="p-4 lg:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
