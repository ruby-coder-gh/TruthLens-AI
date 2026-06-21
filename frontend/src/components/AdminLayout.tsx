import { useState } from 'react';
import { Link, useLocation, Outlet } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import {
  LayoutDashboard, FileText, Upload, Users, UserPlus, Settings, BarChart3, ClipboardList, Shield, ChevronRight, Menu, X, ArrowLeft,
} from 'lucide-react';

// Admin nav items
const adminNavItems = [
  { label: 'Overview', path: '/admin', icon: LayoutDashboard },
  { label: 'Documents', path: '/admin/documents', icon: FileText },
  { label: 'Upload', path: '/admin/documents/upload', icon: Upload },
  { label: 'Users', path: '/admin/users', icon: Users },
  { label: 'Settings', path: '/admin/settings', icon: Settings },
  { label: 'Analytics', path: '/admin/analytics', icon: BarChart3 },
  { label: 'Audit Log', path: '/admin/audit-log', icon: ClipboardList },
];

export default function AdminLayout() {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isActive = (path: string) => {
    if (path === '/admin') return location.pathname === '/admin';
    return location.pathname.startsWith(path);
  };

  return (
    <div className="flex h-full gap-0">
      {/* Mobile overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0.99 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0.99 }}
            className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={clsx(
        'fixed inset-y-0 left-0 z-40 flex w-56 flex-col transition-transform duration-300 lg:translate-x-0 lg:static lg:z-auto',
        'lg:mr-4',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full',
      )}>
        <div className="absolute inset-0 bg-[#0a0e17]/90 backdrop-blur-2xl border-r border-white/[0.06]" />
        
        {/* Header */}
        <div className="relative z-10 flex items-center gap-3 px-4 py-4 border-b border-white/[0.06]">
          <Link to="/admin" className="flex items-center gap-2">
            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-accent text-white">
              <Shield size={14} />
            </div>
            <span className="text-sm font-bold text-text">Admin</span>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="relative z-10 flex-1 overflow-y-auto px-2 py-4 space-y-0.5">
          {adminNavItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className="relative block"
              >
                {active && (
                  <motion.div
                    layoutId="adminNavHighlight"
                    className="absolute inset-0 rounded-lg bg-primary/10 border border-primary/20"
                    transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                  />
                )}
                <div className={clsx(
                  'relative z-10 flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-all',
                  active ? 'text-primary-soft' : 'text-text-muted hover:text-text hover:bg-white/[0.04]',
                )}>
                  <Icon size={16} strokeWidth={active ? 2.5 : 1.5} />
                  <span>{item.label}</span>
                  {active && <ChevronRight size={12} className="ml-auto text-primary-soft" />}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Back link */}
        <div className="relative z-10 border-t border-white/[0.06] p-3">
          <Link to="/dashboard" className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-text-muted hover:text-text hover:bg-white/[0.04] transition-all">
            <ArrowLeft size={14} />
            Back to App
          </Link>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {/* Mobile header */}
        <div className="flex items-center gap-2 mb-3 lg:hidden">
          <button type="button" onClick={() => setSidebarOpen(true)} className="glass rounded-lg px-3 py-1.5 text-xs text-text-muted flex items-center gap-1.5">
            <Menu size={14} /> Admin Menu
          </button>
        </div>
        <Outlet />
      </div>
    </div>
  );
}
