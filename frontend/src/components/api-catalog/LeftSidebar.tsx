import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import {
  Sparkles,
  BookOpen,
  MessageSquare,
  ExternalLink,
  ChevronRight,
} from 'lucide-react';
import { API_GROUPS } from './data';
import * as Icons from 'lucide-react';

const LucideIcon = ({ name, size = 16, className }: { name: string; size?: number; className?: string }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Icon = (Icons as any)[name];
  if (!Icon) return null;
  return <Icon size={size} className={className} />;
};

interface LeftSidebarProps {
  activeGroup: string;
  onGroupChange: (id: string) => void;
}

const quickLinks = [
  { label: 'Getting Started', icon: BookOpen },
  { label: 'Support', icon: MessageSquare },
];

export default function LeftSidebar({ activeGroup, onGroupChange }: LeftSidebarProps) {
  return (
    <motion.aside
      initial={{ opacity: 0.99, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="w-56 shrink-0 flex flex-col h-full"
    >
      {/* Logo + brand */}
      <div className="flex items-center gap-2.5 px-1 pb-4 mb-1">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent text-white shadow-lg shadow-primary/20">
          <Sparkles size={14} />
        </div>
        <div>
          <span className="text-sm font-bold text-text">API Catalog</span>
          <span className="block text-[9px] uppercase tracking-widest text-text-dim">TruthLens AI</span>
        </div>
      </div>

      {/* Groups navigation */}
      <nav className="flex-1 overflow-y-auto -mx-1 space-y-0.5">
        {API_GROUPS.map((group) => {
          const isActive = activeGroup === group.id;
          const httpCount = group.endpoints.filter((e) => e.method !== 'WS').length;
          const wsCount = group.endpoints.filter((e) => e.method === 'WS').length;

          return (
            <button
              key={group.id}
              type="button"
              onClick={() => onGroupChange(group.id)}
              className={clsx(
                'relative w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-all duration-150',
                'group',
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="apiNavHighlight"
                  className="absolute inset-0 rounded-xl bg-primary/10 border border-primary/20"
                  transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                />
              )}
              <div
                className="relative z-10 flex items-center justify-center w-7 h-7 rounded-lg shrink-0 border transition-all"
                style={{
                  background: isActive ? `${group.color}20` : 'transparent',
                  borderColor: isActive ? `${group.color}40` : 'rgba(60,75,110,0.3)',
                }}
              >
                <LucideIcon
                  name={group.icon}
                  size={13}
                  className={clsx(
                    'transition-colors',
                    isActive ? 'opacity-100' : 'opacity-60 group-hover:opacity-90',
                  )}
                  // @ts-expect-error - style on custom component
                  style={{ color: isActive ? group.color : undefined }}
                />
              </div>
              <div className="relative z-10 flex-1 min-w-0">
                <span
                  className={clsx(
                    'block text-xs font-medium truncate transition-colors',
                    isActive ? 'text-text' : 'text-text-muted group-hover:text-text',
                  )}
                >
                  {group.name}
                </span>
                <span className="block text-[9px] text-text-dim font-mono">
                  {httpCount > 0 && `${httpCount} HTTP`}
                  {httpCount > 0 && wsCount > 0 && ' · '}
                  {wsCount > 0 && `${wsCount} WS`}
                </span>
              </div>
              {isActive && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="relative z-10"
                >
                  <ChevronRight size={12} className="text-primary-soft" />
                </motion.div>
              )}
            </button>
          );
        })}
      </nav>

      {/* Quick links */}
      <div className="pt-4 mt-2 border-t border-white/[0.06] space-y-0.5">
        {quickLinks.map((link) => {
          const Icon = link.icon;
          return (
            <button
              key={link.label}
              type="button"
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-text-muted hover:text-text hover:bg-white/[0.04] transition-all group"
            >
              <Icon size={13} className="opacity-60 group-hover:opacity-100" />
              <span>{link.label}</span>
              <ExternalLink size={10} className="ml-auto opacity-0 group-hover:opacity-60" />
            </button>
          );
        })}
      </div>
    </motion.aside>
  );
}
