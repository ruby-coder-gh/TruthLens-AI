// Owning lane: L10 (Demo FE). Mounted unconditionally in Layout (see
// Layout.tsx) — renders nothing unless this deployment is in demo mode and
// the viewer is signed in. Two independent pieces:
//   1. A warm-up toast while the models are still loading.
//   2. A collapsible 5-step presenter checklist, persisted in localStorage.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, ChevronDown, ChevronUp, X, ArrowRight } from 'lucide-react';
import { Badge, type BadgeColor } from './ui';
import { useReady, type UseReadyResult } from '../hooks/useReady';
import { useAuth } from '../context/auth-context';
import type { ModelWarmState } from '../api/types';

const STORAGE_KEY = 'truthlens-demo-tour-v1';
const STEP_COUNT = 5;

interface TourState {
  checked: boolean[];
  hidden: boolean;
  collapsed: boolean;
}

function defaultState(): TourState {
  return { checked: new Array<boolean>(STEP_COUNT).fill(false), hidden: false, collapsed: true };
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
    return { checked, hidden: Boolean(parsed.hidden), collapsed: parsed.collapsed !== false };
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

/** Collapsible presenter checklist — bottom-left, opens upward so an
 * expanded panel never grows down over the chat composer on mobile. */
function TourChecklist({ demoWorkspaceId }: { demoWorkspaceId: string | null }) {
  const [state, setState] = useState<TourState>(() => loadState());

  useEffect(() => {
    saveState(state);
  }, [state]);

  if (state.hidden) return null;

  const chatPath = demoWorkspaceId ? `/workspaces/${demoWorkspaceId}/chat` : '/workspaces';
  const radarPath = demoWorkspaceId ? `/workspaces/${demoWorkspaceId}?tab=radar` : '/workspaces';

  const steps: Step[] = [
    { id: 'ask', label: 'Ask a suggested question', to: chatPath },
    { id: 'lens', label: 'Turn on Truth Lens and hover a claim', to: chatPath },
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

  const toggleCollapsed = () => setState((prev) => ({ ...prev, collapsed: !prev.collapsed }));
  const hideTour = () => setState((prev) => ({ ...prev, hidden: true }));

  return (
    <div className="fixed bottom-4 left-4 z-40 max-w-[calc(100vw-2rem)] sm:max-w-xs">
      <AnimatePresence>
        {!state.collapsed && (
          <motion.div
            id="demo-tour-panel"
            initial={{ opacity: 0.99, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="mb-2 w-full rounded-card border border-border bg-glass p-4 shadow-e2 backdrop-blur-xl sm:w-80"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-text">Presenter tour</p>
              <button
                type="button"
                onClick={hideTour}
                className="flex h-7 w-7 items-center justify-center rounded-control text-text-dim transition-colors hover:bg-card-2 hover:text-text"
                aria-label="Hide tour"
                title="Hide tour"
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
                  <Link
                    to={step.to}
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

      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!state.collapsed}
        aria-controls="demo-tour-panel"
        className="flex items-center gap-2 rounded-full border border-border bg-glass px-3.5 py-2 text-xs font-semibold text-text shadow-e1 backdrop-blur-xl transition-colors hover:bg-card-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        Demo tour {doneCount}/{STEP_COUNT}
        {state.collapsed ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
      </button>
    </div>
  );
}

export function DemoTour() {
  const ready = useReady();
  const { isAuthenticated } = useAuth();

  if (ready.isLoading || !ready.demoMode || !isAuthenticated) return null;

  return (
    <>
      <WarmupToast ready={ready} />
      <TourChecklist demoWorkspaceId={ready.demoWorkspaceId} />
    </>
  );
}
