import { motion } from 'framer-motion';
import {
  Key,
  Zap,
  Terminal,
  Shield,
  Lock,
  Copy,
  Check,
  BookOpen,
  ArrowRight,
} from 'lucide-react';
import { useState } from 'react';
import WebSocketViz from './WebSocketViz';
import { CATALOG_STATS } from './data';

function AuthPanel() {
  const [copiedToken, setCopiedToken] = useState(false);

  const copyToken = () => {
    navigator.clipboard.writeText('trl_eyJhbGciOiJIUzI1NiIs...').then(() => {
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 1500);
    }).catch(() => {});
  };

  return (
    <div className="rounded-xl glass border border-glass-border p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-primary/15 border border-primary/30">
          <Key size={12} className="text-primary-soft" />
        </div>
        <span className="text-xs font-semibold uppercase tracking-wider text-text-dim">Authentication</span>
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Shield size={12} className="text-accent" />
          <span>Bearer token</span>
          <span className="ml-auto text-[10px] font-mono text-text-dim">JWT</span>
        </div>

        {/* Token display */}
        <div className="relative group">
          <div className="flex items-center gap-2 rounded-lg bg-black/40 border border-white/[0.06] px-3 py-2">
            <Lock size={12} className="text-text-dim shrink-0" />
            <code className="flex-1 text-[11px] font-mono text-text-muted truncate">
              trl_eyJhbGciOiJIUzI1NiIs...
            </code>
            <button
              type="button"
              onClick={copyToken}
              className="flex items-center justify-center w-6 h-6 rounded-md text-text-dim hover:text-text hover:bg-white/[0.06] transition-all shrink-0"
              aria-label="Copy example token"
            >
              {copiedToken ? <Check size={11} className="text-green" /> : <Copy size={11} />}
            </button>
          </div>
        </div>

        <button
          type="button"
          className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-primary/10 border border-primary/20 px-3 py-2 text-xs font-medium text-primary-soft hover:bg-primary/15 transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <BookOpen size={12} />
          Auth Docs
          <ArrowRight size={11} className="ml-auto" />
        </button>
      </div>
    </div>
  );
}

function QuickPlayground() {
  const [code] = useState(`curl -X POST https://api.truthlens.ai/api/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"username": "user", "password": "pass"}'`);

  return (
    <div className="rounded-xl glass border border-glass-border p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-accent/15 border border-accent/30">
          <Terminal size={12} className="text-accent" />
        </div>
        <span className="text-xs font-semibold uppercase tracking-wider text-text-dim">Quick Test</span>
      </div>

      <pre className="relative overflow-x-auto rounded-lg bg-black/40 border border-white/[0.06] p-3 text-[11px] font-mono leading-relaxed text-text-muted max-h-[120px] overflow-y-auto">
        <code>{code}</code>
      </pre>

      <div className="flex items-center gap-2 mt-2.5">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/10 border border-primary/20">
          <Zap size={10} className="text-primary-soft" />
          <span className="text-[10px] font-medium text-primary-soft">cURL</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-card-2 border border-border">
          <span className="text-[10px] font-medium text-text-dim">Python</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-card-2 border border-border">
          <span className="text-[10px] font-medium text-text-dim">JS</span>
        </div>
      </div>
    </div>
  );
}

function LiveStatus() {
  return (
    <div className="rounded-xl glass border border-glass-border p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-green-500/15 border border-green-500/30">
          <span className="w-2 h-2 rounded-full bg-green animate-pulse" />
        </div>
        <span className="text-xs font-semibold uppercase tracking-wider text-text-dim">System Status</span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">API Server</span>
          <span className="flex items-center gap-1.5 text-green">
            <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse-dot" />
            Operational
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">WebSocket</span>
          <span className="flex items-center gap-1.5 text-green">
            <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse-dot" />
            Connected
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">Background Jobs</span>
          <span className="flex items-center gap-1.5 text-accent-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-2 animate-pulse-dot" />
            2 Active
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">Uptime</span>
          <span className="flex items-center gap-1.5 text-text font-mono">
            {CATALOG_STATS.uptime}%
          </span>
        </div>
      </div>
    </div>
  );
}

export default function RightPanel() {
  return (
    <motion.aside
      initial={{ opacity: 0.99, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
      className="w-72 shrink-0 flex flex-col gap-3 overflow-y-auto"
    >
      <WebSocketViz />
      <AuthPanel />
      <QuickPlayground />
      <LiveStatus />
    </motion.aside>
  );
}
