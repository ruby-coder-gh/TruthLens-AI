import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import {
  X,
  Copy,
  Check,
  Lock,
  Shield,
  Unlock,
  ChevronDown,
  FileJson,
  Code,
} from 'lucide-react';
import type { ApiEndpoint } from './types';
import { METHOD_COLORS } from './data';

interface EndpointDetailDrawerProps {
  endpoint: ApiEndpoint | null;
  onClose: () => void;
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-text-dim">
          <FileJson size={13} />
          {label}
        </span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 text-xs text-text-dim hover:text-text transition-colors"
        >
          {copied ? <Check size={12} className="text-green" /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="relative overflow-x-auto rounded-xl bg-black/40 border border-white/[0.06] p-4 text-xs font-mono leading-relaxed text-text-muted">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function EndpointDetailDrawer({ endpoint, onClose }: EndpointDetailDrawerProps) {
  const [showRequest, setShowRequest] = useState(true);
  const [showResponse, setShowResponse] = useState(true);

  if (!endpoint) return null;

  const authIcon = endpoint.auth === 'Admin'
    ? <Shield size={14} className="text-red" />
    : endpoint.auth === 'Required'
    ? <Lock size={14} className="text-accent-2" />
    : endpoint.auth === 'Optional'
    ? <Unlock size={14} className="text-text-dim" />
    : null;

  return (
    <AnimatePresence>
      {endpoint && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0.99 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.div
            initial={{ opacity: 0.99, x: 320 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 320 }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-[#14150f]/95 backdrop-blur-2xl border-l border-white/[0.06] shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
              <div className="flex items-center gap-3">
                <span
                  className={clsx(
                    'inline-flex items-center justify-center w-14 px-1.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider border',
                    METHOD_COLORS[endpoint.method],
                  )}
                >
                  {endpoint.method === 'WS' ? 'WS' : endpoint.method}
                </span>
                <code className="text-sm font-mono text-text truncate max-w-[260px]">{endpoint.path}</code>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex items-center justify-center w-8 h-8 rounded-lg text-text-dim hover:text-text hover:bg-white/[0.06] transition-all"
                aria-label="Close drawer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Description */}
              <div>
                <p className="text-sm text-text-muted leading-relaxed">{endpoint.description}</p>
              </div>

              {/* Meta badges */}
              <div className="flex flex-wrap gap-2">
                {endpoint.auth && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-card-2 border border-border px-2.5 py-1 text-[11px] font-medium text-text-dim">
                    {authIcon}
                    {endpoint.auth}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-card-2 border border-border px-2.5 py-1 text-[11px] font-medium text-text-dim">
                  <Code size={12} />
                  {endpoint.method === 'WS' ? 'WebSocket' : 'REST'}
                </span>
              </div>

              {/* Parameters */}
              {endpoint.parameters && endpoint.parameters.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-text-dim mb-3">Parameters</h4>
                  <div className="space-y-1.5">
                    {endpoint.parameters.map((param) => (
                      <div
                        key={param.name}
                        className="flex items-start gap-3 rounded-lg bg-card-2/50 border border-border/50 px-3.5 py-2.5"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <code className="text-xs font-mono font-semibold text-text">{param.name}</code>
                            {param.required && (
                              <span className="text-[10px] font-medium text-red">required</span>
                            )}
                            <span className="text-[10px] font-mono text-text-dim">{param.type}</span>
                          </div>
                          <p className="text-xs text-text-dim mt-0.5">{param.description}</p>
                        </div>
                        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-text-dim bg-card-2 rounded-md px-2 py-0.5 border border-border/50">
                          {param.location}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Request example */}
              {endpoint.exampleRequest && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowRequest(!showRequest)}
                    className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-dim mb-2 hover:text-text transition-colors"
                  >
                    <motion.div animate={{ rotate: showRequest ? 180 : 0 }}>
                      <ChevronDown size={12} />
                    </motion.div>
                    Request Body
                  </button>
                  <AnimatePresence>
                    {showRequest && (
                      <motion.div
                        initial={{ height: 0, opacity: 0.99 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                      >
                        <CodeBlock code={endpoint.exampleRequest} label="JSON" />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Response example */}
              {endpoint.exampleResponse && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowResponse(!showResponse)}
                    className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-dim mb-2 hover:text-text transition-colors"
                  >
                    <motion.div animate={{ rotate: showResponse ? 180 : 0 }}>
                      <ChevronDown size={12} />
                    </motion.div>
                    Response Body
                  </button>
                  <AnimatePresence>
                    {showResponse && (
                      <motion.div
                        initial={{ height: 0, opacity: 0.99 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                      >
                        <CodeBlock code={endpoint.exampleResponse} label="JSON" />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Empty state for endpoints without examples */}
              {!endpoint.exampleRequest && !endpoint.exampleResponse && (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Code size={24} className="text-text-dim mb-2" />
                  <p className="text-sm text-text-muted">No example data available for this endpoint</p>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
