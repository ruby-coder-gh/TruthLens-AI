import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import {
  ChevronDown,
  Copy,
  Check,
  Lock,
  Shield,
  Unlock,
} from 'lucide-react';
import type { LucideIcon as LucideIconType } from 'lucide-react';
import type { ApiGroup, ApiEndpoint } from './types';
import { METHOD_COLORS } from './data';
import * as Icons from 'lucide-react';

const LucideIcon = ({
  name,
  size = 20,
  className,
  color,
}: {
  name: string;
  size?: number;
  className?: string;
  color?: string;
}) => {
  const iconMap = Icons as unknown as Record<string, LucideIconType>;
  const Icon = iconMap[name];
  if (!Icon) return null;
  return <Icon size={size} className={className} color={color} />;
};

interface EndpointGroupProps {
  group: ApiGroup;
  defaultOpen?: boolean;
  onSelectEndpoint: (endpoint: ApiEndpoint) => void;
}

function EndpointItem({ endpoint, onSelectEndpoint }: { endpoint: ApiEndpoint; onSelectEndpoint: (e: ApiEndpoint) => void }) {
  const [copied, setCopied] = useState(false);

  const copyPath = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(endpoint.path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  const authIcon = endpoint.auth === 'Admin'
    ? <Shield size={12} className="text-red" />
    : endpoint.auth === 'Required'
    ? <Lock size={12} className="text-text-dim" />
    : endpoint.auth === 'Optional'
    ? <Unlock size={12} className="text-text-dim" />
    : null;

  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={() => onSelectEndpoint(endpoint)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectEndpoint(endpoint);
        }
      }}
      className="relative w-full flex items-center gap-3 px-4 py-2.5 text-left rounded-xl transition-all duration-150 group hover:bg-white/[0.03] active:scale-[0.99] cursor-pointer"
    >
      {/* Method badge */}
      <span
        className={clsx(
          'shrink-0 inline-flex items-center justify-center w-14 px-1.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider border',
          METHOD_COLORS[endpoint.method],
        )}
      >
        {endpoint.method === 'WS' ? 'WS' : endpoint.method}
      </span>

      {/* Path */}
      <code className="flex-1 text-xs sm:text-sm font-mono text-text-muted group-hover:text-text transition-colors truncate">
        {endpoint.path}
      </code>

      {/* Auth indicator */}
      {authIcon && (
        <span className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {authIcon}
        </span>
      )}

      {/* Copy button */}
      <button
        type="button"
        onClick={copyPath}
        className="shrink-0 flex items-center justify-center w-7 h-7 rounded-lg text-text-dim hover:text-text hover:bg-white/[0.06] transition-all opacity-0 group-hover:opacity-100"
        aria-label="Copy endpoint path"
      >
        {copied ? <Check size={14} className="text-green" /> : <Copy size={13} />}
      </button>
    </motion.div>
  );
}

export default function EndpointGroup({ group, defaultOpen = false, onSelectEndpoint }: EndpointGroupProps) {
  const [open, setOpen] = useState(defaultOpen);

  const total = group.endpoints.length;
  const wsCount = group.endpoints.filter((e) => e.method === 'WS').length;
  const httpCount = total - wsCount;

  return (
    <motion.div
      initial={{ opacity: 0.99, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl glass border border-glass-border overflow-hidden transition-all duration-200 hover:border-primary/20 hover:shadow-[0_0_30px_rgba(99,102,241,0.05)]"
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 sm:px-5 py-3.5 text-left transition-colors hover:bg-white/[0.02]"
      >
        {/* Icon */}
        <div
          className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0 border"
          style={{
            background: `${group.color}15`,
            borderColor: `${group.color}30`,
          }}
        >
          <LucideIcon name={group.icon} size={16} className="shrink-0" color={group.color} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-text">{group.name}</span>
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center rounded-md bg-primary/10 border border-primary/20 px-1.5 py-0.5 text-[10px] font-mono font-bold text-primary-soft">
                {httpCount} {httpCount === 1 ? 'HTTP' : 'HTTP'}
              </span>
              {wsCount > 0 && (
                <span className="inline-flex items-center rounded-md bg-accent/10 border border-accent/20 px-1.5 py-0.5 text-[10px] font-mono font-bold text-accent">
                  {wsCount} WS
                </span>
              )}
            </div>
          </div>
          <p className="text-xs text-text-dim mt-0.5 truncate">{group.description}</p>
        </div>

        {/* Expand icon */}
        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="shrink-0 text-text-dim"
        >
          <ChevronDown size={16} />
        </motion.div>
      </button>

      {/* Endpoints list */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="endpoints"
            initial={{ height: 0, opacity: 0.99 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/[0.04] px-2 pb-2 pt-1">
              {group.endpoints.map((ep, i) => (
                <EndpointItem key={`${ep.method}-${ep.path}-${i}`} endpoint={ep} onSelectEndpoint={onSelectEndpoint} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
