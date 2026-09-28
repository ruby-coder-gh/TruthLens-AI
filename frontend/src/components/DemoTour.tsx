// Owning lane: L10 (Demo FE). Mounted unconditionally in Layout (see
// Layout.tsx) — renders nothing unless this deployment is in demo mode and
// the viewer is signed in. Two independent pieces:
//   1. A warm-up toast while the models are still loading.
//   2. A collapsible 5-step presenter checklist, persisted in localStorage.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, ChevronDown, ChevronUp, X, ArrowRight } from 'lucide-react';
import { Badge, type BadgeColor } from './ui';
import { useReady, type UseReadyResult } from '../hooks/useReady';
import { useAuth } from '../context/auth-context';
import type { ModelWarmState, User } from '../api/types';

const STORAGE_KEY = 'truthlens-demo-tour-v1';
const STEP_COUNT = 5;

// BUG-33: the tour is presenter chrome for the seeded demo personas — a
// regular signed-in user on a deployment that merely *has* demo mode
// enabled (e.g. a QA account) isn't running the demo and shouldn't see it.
// Matches how `app/demo/seed.py` provisions the accounts: @truthlens.dev
// email, demo_-prefixed username.
function isDemoAccount(user: User | null): boolean {
  if (!user) return false;
  return user.email?.endsWith('@truthlens.dev') || user.username?.startsWith('demo_');
}

interface TourState {
  checked: boolean[];
  // BUG-33: no separate "hidden forever" state — Hide/collapse always leaves
  // the pill itself on screen, so the tour is always re-openable rather than
  // a dead end once dismissed.
  collapsed: boolean;
}

function defaultState(): TourState {
  return { checked: new Array<boolean>(STEP_COUNT).fill(false), collapsed: true };
}

function loadState(): TourState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<TourState>;
    const checked =
      Array.isArray(parsed.checked) && parsed.checked.length === STEP_COUNT
        ? parsed.checked.map(Boolean)
        : defaultState().checked;
    return { checked, collapsed: parsed.collapsed !== false };
  } catch {
    // Private browsing / quota errors / corrupt JSON — fall back quietly.
    return defaultState();
  }
}

function saveState(state: TourState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // best-effort persistence only
  }
}

const modelStateColor: Record<ModelWarmState, BadgeColor> = {
  cold: 'gray',
  loading: 'orange',
  warm: 'green',
  error: 'red',
};

/** Warm-up toast — shows per-model load state; disappears once `warm`. */
function WarmupToast({ ready }: { ready: UseReadyResult }) {
  if (ready.warm) return null;

  const llmState: ModelWarmState = !ready.ollama
    ? 'loading'
    : !ready.ollama.reachable
      ? 'error'
      : ready.ollama.model_present
        ? 'warm'
        : 'loading';

  const rows: Array<{ label: string; state: ModelWarmState }> = [
    { label: 'Embedder', state: ready.models?.embedder ?? 'loading' },
    { label: 'Reranker', state: ready.models?.reranker ?? 'loading' },
    { label: 'NLI', state: ready.models?.nli ?? 'loading' },
    { label: 'LLM', state: llmState },
  ];

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-40 w-64 rounded-card border border-border bg-glass p-4 shadow-e2 backdrop-blur-xl"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-text">
        <Loader2 size={14} className="animate-spin text-primary-soft" aria-hidden="true" />
        Warming up models&hellip;
      </p>
      <ul className="mt-3 space-y-1.5">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center justify-between gap-2 text-xs text-text-muted">
            <span>{row.label}</span>
            <Badge color={modelStateColor[row.state]}>{row.state}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface Step {
  id: string;
  label: string;
  to: string;
}

/** Collapsible presenter checklist — top-right, below the header, so an
 * expanded panel never sits over the sidebar's account row (BUG-21) or the
 * chat composer at the bottom of the screen on mobile. */
function TourChecklist({ demoWorkspaceId }: { demoWorkspaceId: string | null }) {
  const [state, setState] = useState<TourState>(() => loadState());
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    saveState(state);
  }, [state]);

  // BUG-33: Esc closes the expanded panel, same as any other popover, and
  // returns focus to the toggle that opened it.
  useEffect(() => {
    if (state.collapsed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setState((prev) => ({ ...prev, collapsed: true }));
      toggleRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [state.collapsed]);

  const chatPath = demoWorkspaceId ? `/workspaces/${demoWorkspaceId}/chat` : '/workspaces';
  const radarPath = demoWorkspaceId ? `/workspaces/${demoWorkspaceId}?tab=radar` : '/workspaces';

  // BUG-20: step 2 named a "Truth Lens toggle" that the Claim Ledger
  // redesign replaced — claims and their verdicts now render inline.
  const steps: Step[] = [
    { id: 'ask', label: 'Ask a suggested question', to: chatPath },
    { id: 'lens', label: "Review the Claim Ledger's claims and verdicts", to: chatPath },
    { id: 'view', label: '"View in document" to see the highlighted passage', to: chatPath },
    { id: 'seal', label: 'Seal a Truth Receipt and open it logged-out', to: chatPath },
    { id: 'radar', label: 'Open Contradiction Radar', to: radarPath },
  ];

  const doneCount = state.checked.filter(Boolean).length;

  const toggleStep = (index: number) => {
    setState((prev) => {
      const checked = [...prev.checked];
      checked[index] = !checked[index];
      return { ...prev, checked };
    });
  };

  const collapse = () => setState((prev) => ({ ...prev, collapsed: true }));
  const toggleCollapsed = () => setState((prev) => ({ ...prev, collapsed: !prev.collapsed }));

  return (
    <div className="fixed right-4 top-[4.5rem] z-40 flex max-w-[calc(100vw-2rem)] flex-col items-end sm:max-w-xs">
      <button
        ref={toggleRef}
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!state.collapsed}
        aria-controls="demo-tour-panel"
        className="flex items-center gap-2 rounded-full border border-border bg-glass px-3.5 py-2 text-xs font-semibold text-text shadow-e1 backdrop-blur-xl transition-colors hover:bg-card-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        Demo tour {doneCount}/{STEP_COUNT}
        {state.collapsed ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronUp size={14} aria-hidden="true" />}
      </button>

      {/* Opens downward below the pill — this widget now anchors to the top
          of the viewport (BUG-21), so an upward-opening panel would run off
          the top of the screen. */}
      <AnimatePresence>
        {!state.collapsed && (
          <motion.div
            id="demo-tour-panel"
            initial={{ opacity: 0.99, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="mt-2 w-full rounded-card border border-border bg-glass p-4 shadow-e2 backdrop-blur-xl sm:w-80"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-text">Presenter tour</p>
              {/* BUG-33: collapses rather than hiding forever — the pill
                  below always stays on screen, so the tour is always
                  re-openable, never a dead end. */}
              <button
                type="button"
                onClick={collapse}
                className="flex h-7 w-7 items-center justify-center rounded-control text-text-dim transition-colors hover:bg-card-2 hover:text-text"
                aria-label="Collapse tour"
                title="Collapse tour"
              >
                <X size={14} />
              </button>
            </div>
            <ol className="space-y-2">
              {steps.map((step, index) => (
                <li key={step.id} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    id={`demo-tour-step-${step.id}`}
                    checked={state.checked[index]}
                    onChange={() => toggleStep(index)}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
                  />
                  <label
                    htmlFor={`demo-tour-step-${step.id}`}
                    className={`flex-1 text-xs leading-relaxed ${state.checked[index] ? 'text-text-dim line-through' : 'text-text-muted'}`}
                  >
                    {index + 1}. {step.label}
                  </label>
                  {/* BUG-33: "Go" also collapses the panel — it used to stay
                      open, floating over the page it just navigated to. */}
                  <Link
                    to={step.to}
                    onClick={collapse}
                    className="flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-primary-soft transition-colors hover:text-primary"
                  >
                    Go
                    <ArrowRight size={11} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function DemoTour() {
  const ready = useReady();
  const { isAuthenticated, user } = useAuth();

  if (ready.isLoading || !ready.demoMode || !isAuthenticated) return null;

  return (
    <>
      <WarmupToast ready={ready} />
      {/* BUG-33: the presenter checklist is for the seeded demo personas
          only — a QA/test account signed into a demo-mode deployment isn't
          running the demo. The warm-up status above stays for everyone. */}
      {isDemoAccount(user) && <TourChecklist demoWorkspaceId={ready.demoWorkspaceId} />}
    </>
  );
}
