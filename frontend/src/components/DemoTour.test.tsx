import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route, Link } from 'react-router-dom';
import { renderWithProviders } from '../test/utils';
import { DemoTourWarmup, DemoTourButton } from './DemoTour';
import { useReady } from '../hooks/useReady';
import type { UseReadyResult } from '../hooks/useReady';
import type { User } from '../api/types';

const demoUser: User = {
  id: 'demo-1',
  email: 'analyst@truthlens.dev',
  username: 'demo_analyst',
  role: 'analyst',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const adminDemoUser: User = {
  id: 'demo-2',
  email: 'admin@truthlens.dev',
  username: 'demo_admin',
  role: 'admin',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

// R2-2/BUG-33: a QA account on the same @truthlens.dev domain as the seeded
// personas, but not one of the two seeded emails itself.
const qaUser: User = {
  id: 'qa-1',
  email: 'viewer2_qa@truthlens.dev',
  username: 'viewer2_qa',
  role: 'viewer',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

vi.mock('../hooks/useReady', () => ({ useReady: vi.fn() }));

// This jsdom run has no usable `window.localStorage` — Node's experimental
// global shadows jsdom's implementation and is inert without
// `--localstorage-file` (see ThemeContext.test.tsx). DemoTourButton tolerates
// that (every access is try/caught), but persistence is what's under test
// here, so install a minimal in-memory Storage for these tests only.
function installMemoryStorage() {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: storage,
  });
}

function mockReady(overrides: Partial<UseReadyResult> = {}) {
  vi.mocked(useReady).mockReturnValue({
    demoMode: false,
    warm: false,
    demoWorkspaceId: null,
    models: undefined,
    ollama: undefined,
    isLoading: false,
    ...overrides,
  });
}

describe('DemoTourWarmup', () => {
  beforeEach(() => {
    vi.mocked(useReady).mockReset();
    installMemoryStorage();
  });

  it('renders nothing outside demo mode', () => {
    mockReady({ demoMode: false });
    const { container } = renderWithProviders(<DemoTourWarmup />, { authValue: { isAuthenticated: true } });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when not authenticated, even in demo mode', () => {
    mockReady({ demoMode: true, warm: true });
    const { container } = renderWithProviders(<DemoTourWarmup />, { authValue: { isAuthenticated: false } });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the warm-up toast with per-model states while not warm', () => {
    mockReady({
      demoMode: true,
      warm: false,
      models: { embedder: 'warm', reranker: 'loading', nli: 'cold' },
      ollama: { reachable: true, model: 'qwen3:4b', model_present: false },
    });
    // The warm-up status is for any authenticated user on a demo-mode
    // deployment, not just the demo personas — no `user` needed here.
    renderWithProviders(<DemoTourWarmup />, { authValue: { isAuthenticated: true } });

    expect(screen.getByText(/warming up models/i)).toBeInTheDocument();
    expect(screen.getByText('Embedder')).toBeInTheDocument();
    expect(screen.getByText('Reranker')).toBeInTheDocument();
    expect(screen.getByText('NLI')).toBeInTheDocument();
    expect(screen.getByText('LLM')).toBeInTheDocument();
    expect(screen.getByText('warm')).toBeInTheDocument();
    expect(screen.getByText('cold')).toBeInTheDocument();
    // Reranker and the derived LLM state (ollama reachable, model not yet pulled) both read "loading".
    expect(screen.getAllByText('loading').length).toBeGreaterThanOrEqual(1);
  });

  it('hides the warm-up toast once warm', () => {
    mockReady({ demoMode: true, warm: true });
    renderWithProviders(<DemoTourWarmup />, { authValue: { isAuthenticated: true } });
    expect(screen.queryByText(/warming up models/i)).not.toBeInTheDocument();
  });
});

describe('DemoTourButton', () => {
  beforeEach(() => {
    vi.mocked(useReady).mockReset();
    installMemoryStorage();
  });

  it('renders nothing outside demo mode', () => {
    mockReady({ demoMode: false });
    const { container } = renderWithProviders(<DemoTourButton />, { authValue: { isAuthenticated: true, user: demoUser } });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the "Tour n/5" trigger and persists a checked step across remounts', async () => {
    mockReady({ demoMode: true, warm: true, demoWorkspaceId: 'ws-demo-1' });
    const user = userEvent.setup();

    const { unmount } = renderWithProviders(<DemoTourButton />, { authValue: { isAuthenticated: true, user: demoUser } });
    expect(screen.getByRole('button', { name: /tour 0\/5/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /tour 0\/5/i }));
    await user.click(screen.getByLabelText(/ask a suggested question/i));

    expect(await screen.findByRole('button', { name: /tour 1\/5/i })).toBeInTheDocument();

    unmount();
    renderWithProviders(<DemoTourButton />, { authValue: { isAuthenticated: true, user: demoUser } });
    expect(await screen.findByRole('button', { name: /tour 1\/5/i })).toBeInTheDocument();
  });

  it('also shows for the seeded demo admin account', () => {
    mockReady({ demoMode: true, warm: true });
    renderWithProviders(<DemoTourButton />, { authValue: { isAuthenticated: true, user: adminDemoUser } });
    expect(screen.getByRole('button', { name: /tour 0\/5/i })).toBeInTheDocument();
  });

  // R2-2/BUG-33: `isDemoAccount` used to match every `@truthlens.dev`
  // address, so QA accounts invited on a demo-mode deployment saw the tour
  // too, even though they aren't running the demo.
  it('hides for a non-seeded @truthlens.dev account', () => {
    mockReady({ demoMode: true, warm: true });
    renderWithProviders(<DemoTourButton />, { authValue: { isAuthenticated: true, user: qaUser } });
    expect(screen.queryByRole('button', { name: /tour/i })).not.toBeInTheDocument();
  });

  it('collapses (never hides entirely) so the tour is always re-openable', async () => {
    mockReady({ demoMode: true, warm: true });
    const user = userEvent.setup();

    renderWithProviders(<DemoTourButton />, { authValue: { isAuthenticated: true, user: demoUser } });
    await user.click(screen.getByRole('button', { name: /tour 0\/5/i }));
    await user.click(screen.getByRole('button', { name: /collapse tour/i }));

    // The trigger itself is still there — collapsing is not a dead end.
    const trigger = screen.getByRole('button', { name: /tour 0\/5/i });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);
    expect(screen.getByText('Presenter tour')).toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    mockReady({ demoMode: true, warm: true });
    const user = userEvent.setup();

    renderWithProviders(<DemoTourButton />, { authValue: { isAuthenticated: true, user: demoUser } });
    const trigger = screen.getByRole('button', { name: /tour 0\/5/i });
    await user.click(trigger);
    expect(screen.getByText('Presenter tour')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByText('Presenter tour')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  // R2-2/BUG-33: previously there was no outside-click handling at all — a
  // real click anywhere else on the page left the panel open, floating over
  // whatever the user navigated to or clicked next.
  it('closes on an outside click', async () => {
    mockReady({ demoMode: true, warm: true });
    const user = userEvent.setup();

    renderWithProviders(<DemoTourButton />, { authValue: { isAuthenticated: true, user: demoUser } });
    await user.click(screen.getByRole('button', { name: /tour 0\/5/i }));
    expect(screen.getByText('Presenter tour')).toBeInTheDocument();

    await user.click(document.body);

    expect(screen.queryByText('Presenter tour')).not.toBeInTheDocument();
  });

  it('collapses the panel after "Go" navigates to a step', async () => {
    mockReady({ demoMode: true, warm: true, demoWorkspaceId: 'ws-demo-1' });
    const user = userEvent.setup();

    renderWithProviders(<DemoTourButton />, { authValue: { isAuthenticated: true, user: demoUser } });
    await user.click(screen.getByRole('button', { name: /tour 0\/5/i }));
    await user.click(screen.getAllByRole('link', { name: /^go$/i })[0]);

    expect(screen.queryByText('Presenter tour')).not.toBeInTheDocument();
  });

  // R3-2: only the tour's own "Go" links used to collapse the panel — any
  // *other* navigation while it was open (a different header control, the
  // logo, browser back) left a ghost popover behind that ignored Esc/outside
  // click and sat over whatever page came next, since Layout never unmounts
  // this button across routes.
  it('closes on any route change, not just its own "Go" links (R3-2)', async () => {
    mockReady({ demoMode: true, warm: true });
    const user = userEvent.setup();
    const onElsewhereClick = vi.fn();

    renderWithProviders(
      <Routes>
        <Route
          path="/start"
          element={
            <>
              <DemoTourButton />
              <Link to="/elsewhere">Elsewhere</Link>
            </>
          }
        />
        <Route
          path="/elsewhere"
          element={
            <>
              <DemoTourButton />
              <button type="button" onClick={onElsewhereClick}>Page action</button>
            </>
          }
        />
      </Routes>,
      { route: '/start', authValue: { isAuthenticated: true, user: demoUser } },
    );

    await user.click(screen.getByRole('button', { name: /tour 0\/5/i }));
    expect(screen.getByText('Presenter tour')).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /elsewhere/i }));

    // No ghost panel left behind, and it isn't swallowing clicks on the new
    // page's own controls.
    expect(screen.queryByText('Presenter tour')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /page action/i }));
    expect(onElsewhereClick).toHaveBeenCalledTimes(1);
  });

  // R3-10: `right-0` under a trigger that isn't flush with the viewport's
  // own right edge pushed a 320px-wide popover off-screen to the left at
  // 375px. Below `sm`, the panel must clamp to the viewport itself.
  it('clamps the panel inside the viewport on narrow screens (R3-10)', async () => {
    mockReady({ demoMode: true, warm: true });
    const user = userEvent.setup();

    renderWithProviders(<DemoTourButton />, { authValue: { isAuthenticated: true, user: demoUser } });
    await user.click(screen.getByRole('button', { name: /tour 0\/5/i }));

    const panel = screen.getByText('Presenter tour').closest('#demo-tour-panel')!;
    // `fixed inset-x-4` — clamped to the viewport's own edges below `sm`;
    // `sm:right-0`/`sm:absolute` — the original trigger-anchored popover
    // returns once there's room for a 320px panel.
    expect(panel.className).toContain('fixed');
    expect(panel.className).toContain('inset-x-4');
    expect(panel.className).toContain('sm:right-0');
    expect(panel.className).toContain('sm:absolute');
  });
});
