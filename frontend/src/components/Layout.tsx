import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
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
  ChevronRight,
  Sparkles,
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
  { label: 'Workspaces', path: '/workspaces', icon: LayoutDashboard },
  { label: 'Documents', path: '/documents', icon: FileText },
  { label: 'Admin', path: '/admin', icon: Shield, adminOnly: true },
];

// ─── Props ────────────────────────────────────────────────────────────────────
interface LayoutProps {
  children: ReactNode;
}

// ─── Sidebar nav item component ───────────────────────────────────────────────
function NavItemLink({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.path}
      onClick={onClick}
      className="relative block"
    >
      {active && (
        <motion.div
          layoutId="navHighlight"
          className="absolute inset-0 rounded-xl bg-primary/10 border border-primary/20"
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        />
      )}
      <div
        className={clsx(
          'relative z-10 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
          active
            ? 'text-primary-soft'
            : 'text-text-muted hover:text-text hover:bg-white/[0.04]',
        )}
      >
        <Icon size={18} strokeWidth={active ? 2.5 : 1.5} />
        <span>{item.label}</span>
        {active && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="ml-auto"
          >
            <ChevronRight size={14} className="text-primary-soft" />
          </motion.div>
        )}
      </div>
    </Link>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function Layout({ children }: LayoutProps) {
  const { user, isAuthenticated, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const closeSidebar = () => setSidebarOpen(false);
  const filteredNav = navItems.filter((item) => !item.adminOnly || user?.role === 'admin');

  const isActive = (path: string) => {
    if (path === '/workspaces') return location.pathname === '/workspaces' || location.pathname.startsWith('/workspaces/');
    if (path === '/documents') return location.pathname === '/documents' || location.pathname.startsWith('/documents/');
    return location.pathname.startsWith(path);
  };

  if (!isAuthenticated) return <>{children}</>;

  return (
    <div className="relative flex h-screen overflow-hidden bg-bg">
      {/* Animated background (fixed) */}
      <AmbientBackground />

      {/* Mobile overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
            onClick={closeSidebar}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      {/* ─── Sidebar ──────────────────────────────────────────────────── */}
      <motion.aside
        initial={false}
        animate={{ x: sidebarOpen ? 0 : -280 }}
        transition={{ type: 'spring', damping: 25, stiffness: 250 }}
        className={clsx(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col',
          'lg:translate-x-0 lg:static',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Glass sidebar */}
        <div className="absolute inset-0 bg-[#0a0e17]/90 backdrop-blur-2xl border-r border-white/[0.06]" />

        {/* Brand */}
        <div className="relative z-10 flex h-16 items-center gap-3 border-b border-white/[0.06] px-6">
          <motion.div
            whileHover={{ rotate: 10, scale: 1.1 }}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-white text-sm font-bold shadow-lg shadow-primary/30"
          >
            <Sparkles size={16} />
          </motion.div>
          <div>
            <span className="text-base font-bold text-text">TruthLens</span>
            <span className="block text-[10px] uppercase tracking-widest text-text-dim">AI Platform</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="relative z-10 flex-1 overflow-y-auto px-3 py-5 space-y-0.5">
          {filteredNav.map((item) => (
            <NavItemLink key={item.path} item={item} active={isActive(item.path)} onClick={closeSidebar} />
          ))}

          {/* Quick actions */}
          <div className="pt-5 mt-5 border-t border-white/[0.06]">
            <p className="px-3 pb-2 text-[10px] uppercase tracking-widest text-text-dim font-medium">Quick Links</p>
            <Link
              to="/workspaces"
              onClick={closeSidebar}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-text-muted hover:text-text hover:bg-white/[0.04] transition-colors"
            >
              <Search size={16} />
              <span>Search Documents</span>
            </Link>
            <Link
              to="/workspaces"
              onClick={closeSidebar}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-text-muted hover:text-text hover:bg-white/[0.04] transition-colors"
            >
              <MessageSquare size={16} />
              <span>Recent Queries</span>
            </Link>
          </div>
        </nav>

        {/* User info */}
        {user && (
          <div className="relative z-10 border-t border-white/[0.06] p-4">
            <motion.div
              initial={false}
              whileHover={{ scale: 1.02 }}
              className="rounded-xl bg-white/[0.03] p-3"
            >
              <div className="flex items-center gap-3">
                <motion.div
                  whileHover={{ scale: 1.1 }}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-accent/30 border border-white/[0.08] text-text-muted"
                >
                  <User size={16} />
                </motion.div>
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
              <motion.button
                type="button"
                onClick={logout}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-muted transition-colors hover:bg-white/[0.05] hover:text-red"
              >
                <LogOut size={15} />
                <span>Sign out</span>
              </motion.button>
            </motion.div>
          </div>
        )}
      </motion.aside>

      {/* ─── Main area ────────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <motion.header
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="flex h-16 items-center gap-4 border-b border-white/[0.06] bg-[#0a0e17]/60 backdrop-blur-xl px-4 lg:px-6"
        >
          <motion.button
            type="button"
            onClick={() => setSidebarOpen((prev) => !prev)}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-text-muted hover:bg-white/[0.06] hover:text-text lg:hidden"
            aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </motion.button>

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
        </motion.header>

        {/* Content */}
        <main className="relative flex-1 overflow-y-auto">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="p-4 lg:p-6"
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
