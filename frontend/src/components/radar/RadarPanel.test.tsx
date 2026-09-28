import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/utils';
import RadarPanel from './RadarPanel';
import type { Contradiction, ContradictionStatus, RadarState } from '../../api/types';

vi.mock('../../api/client', () => ({
  radarApi: {
    get: vi.fn(),
    scan: vi.fn(),
    setStatus: vi.fn(),
  },
}));

const mockOpenSource = vi.fn();
vi.mock('../../context/SourceViewerContext', () => ({
  useSourceViewer: () => ({ open: mockOpenSource, close: vi.fn(), target: null }),
}));

import { radarApi } from '../../api/client';

function makeContradiction(overrides: Partial<Contradiction> = {}): Contradiction {
  return {
    id: 'c1',
    score: 0.92,
    similarity: 0.71,
    status: 'open',
    created_at: '2024-01-01T00:00:00Z',
    a: { document_id: 'd1', document_name: 'Policy A', chunk_id: 'ch1', page_number: 2, sentence: 'The fee is $50 per month.' },
    b: { document_id: 'd2', document_name: 'Policy B', chunk_id: 'ch2', page_number: 5, sentence: 'The fee is $75 per month.' },
    ...overrides,
  };
}

function radarState(overrides: Partial<RadarState> = {}): RadarState {
  return {
    latest_scan: null,
    contradictions: [],
    counts: { open: 0, dismissed: 0, resolved: 0 },
    ...overrides,
  };
}

function renderPanel(canModerate = true) {
  return renderWithProviders(<RadarPanel workspaceId="ws-1" canModerate={canModerate} />);
}

describe('RadarPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a conflict card with word-level diff highlighting', async () => {
    vi.mocked(radarApi.get).mockResolvedValue(
      radarState({ contradictions: [makeContradiction()], counts: { open: 1, dismissed: 0, resolved: 0 } }),
    );

    const { container } = renderPanel();

    expect(await screen.findByText('Policy A')).toBeInTheDocument();
    expect(screen.getByText('Policy B')).toBeInTheDocument();

    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBeGreaterThanOrEqual(2);
    expect(marks[0].textContent).toContain('50');
    expect(marks[1].textContent).toContain('75');
  });

  it('switches filters and refetches the corresponding status', async () => {
    const user = userEvent.setup();
    vi.mocked(radarApi.get).mockImplementation((_wid: string, status?: ContradictionStatus) =>
      Promise.resolve(
        status === 'dismissed'
          ? radarState({
              contradictions: [makeContradiction({ id: 'c2', status: 'dismissed', a: { ...makeContradiction().a, document_name: 'Dismissed Doc' } })],
              counts: { open: 1, dismissed: 1, resolved: 0 },
            })
          : radarState({ contradictions: [makeContradiction()], counts: { open: 1, dismissed: 1, resolved: 0 } }),
      ),
    );

    renderPanel();

    expect(await screen.findByText('Policy A')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Dismissed/i }));

    expect(await screen.findByText('Dismissed Doc')).toBeInTheDocument();
    expect(screen.queryByText('Policy A')).not.toBeInTheDocument();
    expect(radarApi.get).toHaveBeenCalledWith('ws-1', 'dismissed');
  });

  it('dismiss optimistically removes the card and calls setStatus', async () => {
    const user = userEvent.setup();
    vi.mocked(radarApi.get).mockResolvedValue(
      radarState({ contradictions: [makeContradiction()], counts: { open: 1, dismissed: 0, resolved: 0 } }),
    );
    // Never resolves within the test — proves the card leaves the DOM from the
    // optimistic `onMutate` update, not from the mutation actually completing.
    vi.mocked(radarApi.setStatus).mockReturnValue(new Promise(() => {}));

    renderPanel();

    expect(await screen.findByText('Policy A')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Dismiss/i }));

    expect(radarApi.setStatus).toHaveBeenCalledWith('ws-1', 'c1', 'dismissed');
    await waitFor(() => expect(screen.queryByText('Policy A')).not.toBeInTheDocument());
  });

  it('shows live scan progress and polls while a scan is running', async () => {
    vi.useFakeTimers();
    vi.mocked(radarApi.get).mockResolvedValue(
      radarState({
        latest_scan: {
          id: 's1', status: 'running', scope: null,
          chunks_scanned: 5, pairs_checked: 10, found: 1, error: null,
          started_at: '2024-01-01T00:00:00Z', finished_at: null, created_at: '2024-01-01T00:00:00Z',
        },
      }),
    );

    renderPanel();

    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText(/Scanning for contradictions/i)).toBeInTheDocument();
    expect(screen.getByText(/5 chunks scanned/i)).toBeInTheDocument();
    const callsBefore = vi.mocked(radarApi.get).mock.calls.length;

    await vi.advanceTimersByTimeAsync(2100);
    expect(vi.mocked(radarApi.get).mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('reopens a dismissed contradiction from its own filter tab (BUG-62)', async () => {
    const user = userEvent.setup();
    vi.mocked(radarApi.get).mockImplementation((_wid: string, status?: ContradictionStatus) =>
      Promise.resolve(
        status === 'dismissed'
          ? radarState({
              contradictions: [makeContradiction({ status: 'dismissed' })],
              counts: { open: 0, dismissed: 1, resolved: 0 },
            })
          : radarState({ counts: { open: 0, dismissed: 1, resolved: 0 } }),
      ),
    );
    vi.mocked(radarApi.setStatus).mockReturnValue(new Promise(() => {}));

    renderPanel();
    await user.click(screen.getByRole('tab', { name: /Dismissed/i }));
    expect(await screen.findByText('Policy A')).toBeInTheDocument();

    // Only a Reopen action is offered for a non-open item — no Dismiss/Resolve.
    expect(screen.queryByRole('button', { name: /^Dismiss$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark resolved/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Reopen/i }));

    expect(radarApi.setStatus).toHaveBeenCalledWith('ws-1', 'c1', 'open');
    // Optimistic removal from the Dismissed view, same as dismiss/resolve.
    await waitFor(() => expect(screen.queryByText('Policy A')).not.toBeInTheDocument());
  });

  it('hides moderation actions for a viewer', async () => {
    vi.mocked(radarApi.get).mockResolvedValue(
      radarState({ contradictions: [makeContradiction()], counts: { open: 1, dismissed: 0, resolved: 0 } }),
    );

    renderPanel(false);

    expect(await screen.findByText('Policy A')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Dismiss/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark resolved/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Run full scan/i })).not.toBeInTheDocument();
    // Viewing evidence is still allowed — each side's button carries a
    // distinct accessible name (`View this passage in <document>`) so two
    // "View" buttons in the same card aren't indistinguishable to a screen
    // reader.
    expect(screen.getByRole('button', { name: /View this passage in Policy A/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View this passage in Policy B/i })).toBeInTheDocument();
  });
});
