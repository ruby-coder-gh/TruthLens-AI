import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/utils';
import { DemoTour } from './DemoTour';
import { useReady } from '../hooks/useReady';
import type { UseReadyResult } from '../hooks/useReady';

vi.mock('../hooks/useReady', () => ({ useReady: vi.fn() }));

// This jsdom run has no usable `window.localStorage` — Node's experimental
// global shadows jsdom's implementation and is inert without
// `--localstorage-file` (see ThemeContext.test.tsx). DemoTour tolerates that
// (every access is try/caught), but persistence is what's under test here, so
// install a minimal in-memory Storage for these tests only.
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

describe('DemoTour', () => {
  beforeEach(() => {
    vi.mocked(useReady).mockReset();
    installMemoryStorage();
  });

  it('renders nothing outside demo mode', () => {
    mockReady({ demoMode: false });
    const { container } = renderWithProviders(<DemoTour />, { authValue: { isAuthenticated: true } });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when not authenticated, even in demo mode', () => {
    mockReady({ demoMode: true, warm: true });
    const { container } = renderWithProviders(<DemoTour />, { authValue: { isAuthenticated: false } });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the warm-up toast with per-model states while not warm', () => {
    mockReady({
      demoMode: true,
      warm: false,
      models: { embedder: 'warm', reranker: 'loading', nli: 'cold' },
      ollama: { reachable: true, model: 'qwen3:4b', model_present: false },
    });
    renderWithProviders(<DemoTour />, { authValue: { isAuthenticated: true } });

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
    renderWithProviders(<DemoTour />, { authValue: { isAuthenticated: true } });
    expect(screen.queryByText(/warming up models/i)).not.toBeInTheDocument();
  });

  it('shows the presenter checklist pill and persists a checked step across remounts', async () => {
    mockReady({ demoMode: true, warm: true, demoWorkspaceId: 'ws-demo-1' });
    const user = userEvent.setup();

    const { unmount } = renderWithProviders(<DemoTour />, { authValue: { isAuthenticated: true } });
    expect(screen.getByRole('button', { name: /demo tour 0\/5/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /demo tour 0\/5/i }));
    await user.click(screen.getByLabelText(/ask a suggested question/i));

    expect(await screen.findByRole('button', { name: /demo tour 1\/5/i })).toBeInTheDocument();

    unmount();
    renderWithProviders(<DemoTour />, { authValue: { isAuthenticated: true } });
    expect(await screen.findByRole('button', { name: /demo tour 1\/5/i })).toBeInTheDocument();
  });

  it('hides the tour entirely after "Hide tour" is clicked', async () => {
    mockReady({ demoMode: true, warm: true });
    const user = userEvent.setup();

    renderWithProviders(<DemoTour />, { authValue: { isAuthenticated: true } });
    await user.click(screen.getByRole('button', { name: /demo tour 0\/5/i }));
    await user.click(screen.getByRole('button', { name: /hide tour/i }));

    expect(screen.queryByRole('button', { name: /demo tour/i })).not.toBeInTheDocument();
  });
});
