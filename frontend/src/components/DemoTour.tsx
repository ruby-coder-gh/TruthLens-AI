// Owning lane: L10 (Demo FE), reworked in fix-round-2 (R2-2). Two
// independent pieces, both gated to demo-mode deployments:
//   1. `DemoTourWarmup` — a warm-up toast while the models are still
//      loading, for any authenticated user.
//   2. `DemoTourButton` — a "Tour n/5" trigger meant to be mounted inside
//      the app's top bar (see Layout.tsx), opening a popover checklist.
//      R2-2: it used to be a `fixed` pill floating over the page, which sat
//      on top of every page's own header action buttons (Refresh, Upload
//      Document, ...). Anchoring it inside the top bar instead means it can
//      never again collide with a page's header row.
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Loader2, ChevronDown, ChevronUp, X, ArrowRight } from 'lucide-react';
import { Badge, type BadgeColor } from './ui';
import { useReady, type UseReadyResult } from '../hooks/useReady';
import { useAuth } from '../context/auth-context';
import type { ModelWarmState, User } from '../api/types';

const STORAGE_KEY = 'truthlens-demo-tour-v1';
const STEP_COUNT = 5;

// R2-2/BUG-33: the tour is presenter chrome for the two seeded demo
// personas only (`app/demo/seed.py`) — any other @truthlens.dev address
// (e.g. a QA account invited on a demo-mode deployment) isn't running the
// demo and shouldn't see it.
const DEMO_ACCOUNT_EMAILS = new Set(['analyst@truthlens.dev', 'admin@truthlens.dev']);

function isDemoAccount(user: User | null): boolean {
  if (!user?.email) return false;
  return DEMO_ACCOUNT_EMAILS.has(user.email);
}

interface TourState {
  checked: boolean[];
  // No separate "hidden forever" state — Hide/collapse always leaves the
  // trigger button itself on screen, so the tour is always re-openable
  // rather than a dead end once dismissed.
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

function WarmupToastContent({ ready }: { ready: UseReadyResult }) {
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

/** Warm-up toast — shows per-model load state; disappears once `warm`. For
 *  any authenticated user on a demo-mode deployment, not just the demo
 *  personas. Mount anywhere; it's `fixed` and self-positions. */
export function DemoTourWarmup() {
  const ready = useReady();
  const { isAuthenticated } = useAuth();

  if (ready.isLoading || !ready.demoMode || !isAuthenticated || ready.warm) return null;

  return <WarmupToastContent ready={ready} />;
}

interface Step {
  id: string;
  label: string;
  to: string;
}

/** "Tour n/5" trigger + popover checklist. Meant to be mounted inline inside
 *  the app's top bar (`Layout.tsx`'s header), not `fixed` — the popover
 *  anchors below the button and closes on "Go", Esc, or an outside click. */
export function DemoTourButton() {
  const ready = useReady();
  const { isAuthenticated, user } = useAuth();
  const [state, setState] = useState<TourState>(() => loadState());
  const containerRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  // R3-2: "Go" already collapses on click (below), but that only covers
  // navigating through the tour's *own* links — any other navigation while
  // the panel was open (browser back, a different header control, a stray
  // click that both closes the panel and follows a link) left it floating
  // over whatever page came next. Layout never unmounts this button across
  // routes, so close on every route change, not just the tour's own "Go".
  // Derived during render (React's documented "adjusting state when a prop
  // changes" bail-out pattern), not an effect — an effect here would commit
  // the still-open panel for a frame before closing it.
  const [lastPathname, setLastPathname] = useState(location.pathname);
  if (location.pathname !== lastPathname) {
    setLastPathname(location.pathname);
    if (!state.collapsed) setState((prev) => ({ ...prev, collapsed: true }));
  }

  useEffect(() => {
    saveState(state);
  }, [state]);

  // R2-9/BUG-33 pattern: Esc and a click outside the trigger+panel both
  // close it — no full-screen blocking backdrop, so the rest of the top bar
  // stays clickable while the panel is open. Only attached while open.
  useEffect(() => {
    if (state.collapsed) return;
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setState((prev) => ({ ...prev, collapsed: true }));
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setState((prev) => ({ ...prev, collapsed: true }));
      toggleRef.current?.focus();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [state.collapsed]);

  if (ready.isLoading || !ready.demoMode || !isAuthenticated || !isDemoAccount(user)) return null;

  const chatPath = ready.demoWorkspaceId ? `/workspaces/${ready.demoWorkspaceId}/chat` : '/workspaces';
  const radarPath = ready.demoWorkspaceId ? `/workspaces/${ready.demoWorkspaceId}?tab=radar` : '/workspaces';

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
    <div ref={containerRef} className="relative">
      <button
        ref={toggleRef}
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!state.collapsed}
        aria-controls="demo-tour-panel"
        className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control border border-border bg-card-2 px-2.5 py-1.5 text-xs font-semibold text-text transition-colors hover:bg-card-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        Tour {doneCount}/{STEP_COUNT}
        {state.collapsed ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronUp size={13} aria-hidden="true" />}
      </button>

      {/* R3-10: below `sm`, `right-0` under a trigger that isn't flush with
          the viewport's own right edge pushed the panel's left edge
          off-screen negative (the button sits mid-header, not at x=0, so a
          320px-wide panel anchored to *its* right edge ran out of room).
          `fixed inset-x-4` clamps the panel to the viewport itself — it can
          never go off either edge — then `sm:` reverts to the original
          trigger-anchored popover once there's room for one. */}
      {/* Plain element, no exit animation: under Framer Motion v12 (WAAPI) an
          exit animation can stall, so AnimatePresence never unmounted the
          panel — it stayed on screen at opacity 1 over the next page and
          blocked header clicks (R3-2, QA4). */}
      {!state.collapsed && (
          <div
            id="demo-tour-panel"
            className="fixed inset-x-4 top-14 z-40 w-auto rounded-card border border-border bg-glass p-4 shadow-e2 backdrop-blur-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80 sm:max-w-[calc(100vw-2rem)]"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-text">Presenter tour</p>
              {/* Collapses rather than hiding forever — the trigger above
                  always stays on screen, so the tour is always re-openable,
                  never a dead end. */}
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
                  {/* "Go" also collapses the panel — it used to stay open,
                      floating over the page it just navigated to. */}
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
          </div>
      )}
    </div>
  );
}
