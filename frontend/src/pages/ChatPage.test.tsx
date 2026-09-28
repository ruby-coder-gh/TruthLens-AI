import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/utils';
import { SourceViewerProvider } from '../context/SourceViewerContext';
import ChatPage from './ChatPage';
import { queryApi } from '../api/client';
import type { QueryWebSocketCallbacks } from '../api/websocket';
import type { Claim, Source } from '../api/types';
import { __resetAnswerViewForTests } from '../components/ledger/useAnswerView';

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    chunk_id: 'chunk-1',
    document_id: 'doc-1',
    excerpt: 'Revenue grew by 12% year over year.',
    relevance_score: 0.9,
    document_name: 'Alpha Report',
    matched_chunks: 1,
    ...overrides,
  };
}

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  const text = overrides.text ?? 'Revenue grew 12%.';
  return {
    text,
    start: 0,
    end: text.length, // matches `text` unless the caller overrides both.
    verdict: 'supported',
    entailment: 0.91,
    contradiction: 0.02,
    source_index: 1,
    chunk_id: 'chunk-1',
    document_id: 'doc-1',
    document_name: 'Alpha Report',
    page_number: 3,
    evidence: 'Revenue increased by 12 percent year over year.',
    ...overrides,
  };
}

vi.mock('../api/client', () => ({
  feedbackApi: { submit: vi.fn() },
  queryApi: { exportMarkdown: vi.fn().mockResolvedValue({ blob: new Blob(['#']), filename: 'a.md' }) },
  // Empty suggestions → SuggestedQuestions falls back to EXAMPLE_QUESTIONS.
  demoApi: { suggestions: vi.fn().mockResolvedValue({ questions: [] }) },
  receiptApi: { create: vi.fn(), listForQuery: vi.fn().mockResolvedValue([]), revoke: vi.fn() },
  workspaceApi: {
    get: vi.fn().mockResolvedValue({ id: 'ws-1', name: 'Test Workspace', description: '', owner_id: 'u1', member_count: 1, document_count: 3, created_at: '', updated_at: '' }),
    listMembers: vi.fn().mockResolvedValue({ data: [] }),
  },
  radarApi: { get: vi.fn().mockResolvedValue({ latest_scan: null, contradictions: [], counts: { open: 0, dismissed: 0, resolved: 0 } }) },
}));

// Claim Ledger / Exhibits / ProseAnswer all call useSourceViewer(); stub the
// hook so tests can assert on open(), and make the provider a passthrough.
const mockOpenSourceViewer = vi.fn();
vi.mock('../context/SourceViewerContext', () => ({
  SourceViewerProvider: ({ children }: { children: ReactNode }) => children,
  useSourceViewer: () => ({ open: mockOpenSourceViewer, close: vi.fn(), target: null }),
}));

const { mockConnect, mockDisconnect, mockCancel, instances } = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockDisconnect: vi.fn(),
  mockCancel: vi.fn(),
  instances: [] as MockQueryWebSocketInstance[],
}));

interface MockQueryWebSocketInstance {
  workspaceId: string;
  query: string;
  callbacks: QueryWebSocketCallbacks;
  conversationId?: string;
  topK?: number;
  forceRefresh?: boolean;
  replacesQueryId?: string;
  connect: typeof mockConnect;
  disconnect: typeof mockDisconnect;
  cancel: typeof mockCancel;
}

vi.mock('../api/websocket', () => {
  class MockQueryWebSocket implements MockQueryWebSocketInstance {
    workspaceId: string;
    query: string;
    callbacks: QueryWebSocketCallbacks;
    conversationId?: string;
    topK?: number;
    forceRefresh?: boolean;
    replacesQueryId?: string;
    connect = mockConnect;
    disconnect = mockDisconnect;
    cancel = mockCancel;

    constructor(
      workspaceId: string,
      query: string,
      callbacks: QueryWebSocketCallbacks,
      conversationId?: string,
      topK?: number,
      forceRefresh?: boolean,
      replacesQueryId?: string,
    ) {
      this.workspaceId = workspaceId;
      this.query = query;
      this.callbacks = callbacks;
      this.conversationId = conversationId;
      this.topK = topK;
      this.forceRefresh = forceRefresh;
      this.replacesQueryId = replacesQueryId;
      instances.push(this);
    }
  }
  // Mirrors WS_RECONNECT_BACKOFF_MS.length in ../api/websocket — the real
  // value is asserted in websocket.test.ts, so a change there fails loudly.
  return { QueryWebSocket: MockQueryWebSocket, WS_RECONNECT_MAX: 4 };
});

function progressDetail(overrides: Partial<{ found: number | null; kept: number | null; words: number | null; elapsedMs: number | null }> = {}) {
  return { found: null, kept: null, words: null, elapsedMs: null, ...overrides };
}

// ChatPage's own onGuardrail callback only reads `claims`, but the WS client's
// callback type carries the full guardrail payload — fill in placeholders for
// the fields this page ignores rather than repeating them at every call site.
function guardrailPayload(claims: Claim[]) {
  return { passed: true, score: 1, details: '', claims, unsupportedClaims: [] };
}

function renderChatPage(username?: string) {
  return renderWithProviders(
    <SourceViewerProvider>
      <Routes>
        <Route path="/workspaces/:id/chat" element={<ChatPage />} />
      </Routes>
    </SourceViewerProvider>,
    {
      route: '/workspaces/ws-1/chat',
      authValue: username
        ? { user: { id: 'u1', email: 'demo@x.com', username, role: 'analyst', is_active: true, created_at: '', updated_at: '' }, isAuthenticated: true }
        : undefined,
    },
  );
}

const ASK_LABEL = 'Ask a question about this workspace';

describe('ChatPage', () => {
  beforeEach(() => {
    // The Markdown export clicks a generated <a download>; jsdom can't navigate
    // and logs "Not implemented" for it.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    instances.length = 0;
    mockConnect.mockClear();
    mockDisconnect.mockClear();
    mockCancel.mockClear();
    mockOpenSourceViewer.mockClear();
    // Claim ledger / prose toggle is (in this jsdom setup, in-memory) shared/
    // global — start every test from its default instead of leaking state.
    __resetAnswerViewForTests();
  });

  it('renders the empty state before any query has been sent', () => {
    renderChatPage();

    expect(screen.getByText('What would you like to verify?')).toBeInTheDocument();
  });

  it('scrolls only inside <main> — no second overflow container (R2-8)', () => {
    const { container } = renderChatPage();

    // `<main>` (Layout.tsx) is the sole scroll container; this page must not
    // add its own `overflow-y-auto` region, which used to draw a second,
    // nested scrollbar.
    expect(container.querySelector('#chat-scroll')).not.toHaveClass('overflow-y-auto');
    expect(document.querySelectorAll('.overflow-y-auto')).toHaveLength(0);
  });

  it('constructs a QueryWebSocket with the workspace id + text and connects on Enter', async () => {
    const user = userEvent.setup();
    renderChatPage();

    const textarea = screen.getByLabelText(ASK_LABEL);
    await user.type(textarea, 'What is the meaning of life?');
    await user.keyboard('{Enter}');

    expect(instances).toHaveLength(1);
    expect(instances[0].workspaceId).toBe('ws-1');
    expect(instances[0].query).toBe('What is the meaning of life?');
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('updates the answer to complete as onToken and onComplete fire', async () => {
    const user = userEvent.setup();
    renderChatPage();

    const textarea = screen.getByLabelText(ASK_LABEL);
    await user.type(textarea, 'Summarise the report');
    await user.keyboard('{Enter}');

    const { callbacks } = instances[0];

    act(() => {
      callbacks.onToken?.('The report shows steady growth.');
    });

    expect(screen.getByText('The report shows steady growth.')).toBeInTheDocument();

    // The id is learned at `ack`, well before `complete`, and an empty
    // `complete.query_id` must not clobber it.
    act(() => {
      callbacks.onAck?.('q-1');
    });

    act(() => {
      callbacks.onComplete?.({
        query_id: '',
        latency_ms: 842,
        model_used: 'qwen3:4b',
        token_count: 12,
        from_cache: false,
      });
    });

    expect(screen.getByText('842ms')).toBeInTheDocument();
    expect(screen.getByText('qwen3:4b')).toBeInTheDocument();
    expect(screen.getByLabelText('Copy response')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Export as Markdown'));
    expect(queryApi.exportMarkdown).toHaveBeenCalledWith('q-1');
  });

  it('copies the answer with [source:N] markers replaced by [N], and offers Regenerate on a non-cached answer (BUG-9, BUG-31)', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderChatPage();

    await user.type(screen.getByLabelText(ASK_LABEL), 'Summarise revenue');
    await user.keyboard('{Enter}');

    const { callbacks } = instances[0];
    act(() => {
      callbacks.onToken?.('Revenue was €412M [source:1].');
      callbacks.onComplete?.({ query_id: 'q-fresh', latency_ms: 500, model_used: 'qwen3:4b', token_count: 9, from_cache: false });
    });

    // Copy reads the completed answer (BUG-9) — checked before Regenerate,
    // which replaces this bubble with a fresh pending one in place (R2-21).
    await user.click(screen.getByLabelText('Copy response'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Revenue was €412M [1].');

    // Regenerate shows up on a fresh (non-cached) complete answer, not just a
    // cached one (BUG-31).
    const regenerate = screen.getByLabelText('Regenerate with fresh retrieval');
    expect(regenerate).toBeInTheDocument();
    await user.click(regenerate);
    expect(instances).toHaveLength(2);
    expect(instances[1].forceRefresh).toBe(true);
  });

  it('regenerates the turn in place and sends K4 replaces_query_id instead of duplicating it (R2-21)', async () => {
    const user = userEvent.setup();
    renderChatPage();

    await user.type(screen.getByLabelText(ASK_LABEL), 'What was installed capacity?');
    await user.keyboard('{Enter}');

    act(() => {
      instances[0].callbacks.onToken?.('1.8 GW installed.');
      instances[0].callbacks.onComplete?.({ query_id: 'q-old', latency_ms: 500, model_used: 'qwen3:4b', token_count: 4, from_cache: false });
    });

    expect(screen.getAllByText('What was installed capacity?')).toHaveLength(1);

    await user.click(screen.getByLabelText('Regenerate with fresh retrieval'));

    // The second run tells the backend which saved query it replaces (K4).
    expect(instances).toHaveLength(2);
    expect(instances[1].replacesQueryId).toBe('q-old');

    act(() => {
      instances[1].callbacks.onToken?.('1.9 GW installed.');
      instances[1].callbacks.onComplete?.({ query_id: 'q-new', latency_ms: 400, model_used: 'qwen3:4b', token_count: 4, from_cache: false });
    });

    // Still one question turn and one answer — not a second copy appended.
    expect(screen.getAllByText('What was installed capacity?')).toHaveLength(1);
    expect(screen.getByText('1.9 GW installed.')).toBeInTheDocument();
    expect(screen.queryByText('1.8 GW installed.')).not.toBeInTheDocument();
  });

  it('shows Seal receipt for the workspace owner on a completed answer (R2-6)', async () => {
    const user = userEvent.setup();
    renderChatPage('demo_analyst');

    await user.type(screen.getByLabelText(ASK_LABEL), 'Summarise revenue');
    await user.keyboard('{Enter}');

    act(() => {
      instances[0].callbacks.onToken?.('Revenue grew.');
      instances[0].callbacks.onComplete?.({ query_id: 'q-owner', latency_ms: 500, model_used: 'qwen3:4b', token_count: 3, from_cache: false });
    });

    expect(await screen.findByRole('button', { name: /seal receipt/i })).toBeInTheDocument();
  });

  it('shows the sidebar-consistent two-word initials on the question avatar (BUG-32)', async () => {
    const user = userEvent.setup();
    renderChatPage('demo_analyst');

    await user.type(screen.getByLabelText(ASK_LABEL), 'Hi there');
    await user.keyboard('{Enter}');

    expect(screen.getByText('DA')).toBeInTheDocument();
    expect(screen.queryByText('DE')).not.toBeInTheDocument();
  });

  it('says "Guardrail failed" instead of "Answer verified" when the guardrail did not pass (BUG-6)', async () => {
    const user = userEvent.setup();
    renderChatPage();

    await user.type(screen.getByLabelText(ASK_LABEL), 'Emissions this year?');
    await user.keyboard('{Enter}');

    const { callbacks } = instances[0];
    act(() => {
      callbacks.onToken?.('Emissions fell.');
      callbacks.onGuardrail?.({ passed: false, score: 0.38, details: '', claims: [makeClaim({ verdict: 'unsupported' })], unsupportedClaims: [] });
      callbacks.onComplete?.({ query_id: 'q-fail', latency_ms: 500, model_used: 'qwen3:4b', token_count: 4, from_cache: false });
    });

    expect(screen.getByText('Guardrail failed')).toBeInTheDocument();
    expect(screen.queryByText('How this answer was verified')).not.toBeInTheDocument();
  });

  it('backfills an exhibit page number from a claim citing the same chunk (BUG-8: fresh answers omit Source.page_number)', async () => {
    const user = userEvent.setup();
    renderChatPage();

    await user.type(screen.getByLabelText(ASK_LABEL), 'Summarise revenue');
    await user.keyboard('{Enter}');

    const { callbacks } = instances[0];
    act(() => {
      callbacks.onToken?.('Revenue grew 12%.');
      // A fresh (non-cached) source with no page_number — the live WS path
      // never sends one — but a claim citing the same chunk carries it.
      callbacks.onSource?.(makeSource());
      callbacks.onGuardrail?.(guardrailPayload([makeClaim({ verdict: 'supported', page_number: 5 })]));
      callbacks.onComplete?.({ query_id: 'q-page', latency_ms: 500, model_used: 'qwen3:4b', token_count: 4, from_cache: false });
    });

    expect(screen.getAllByText('page 5', { exact: false }).length).toBeGreaterThan(0);
  });

  it('shows an error and a Retry action when onError fires', async () => {
    const user = userEvent.setup();
    renderChatPage();

    const textarea = screen.getByLabelText(ASK_LABEL);
    await user.type(textarea, 'Trigger a failure');
    await user.keyboard('{Enter}');

    const { callbacks } = instances[0];

    act(() => {
      callbacks.onError?.('MODEL_ERROR', 'The model timed out');
    });

    expect(screen.getByRole('alert')).toHaveTextContent('The model timed out');
    expect(screen.getByRole('button', { name: /retry this question/i })).toBeInTheDocument();
  });

  // S3 regression: Retry used to append a fresh user + assistant pair, leaving
  // the dead error card (and its still-clickable Retry button) above a second
  // echo of the same question.
  it('replaces the errored bubble on Retry instead of appending a second turn', async () => {
    const user = userEvent.setup();
    renderChatPage();

    await user.type(screen.getByLabelText(ASK_LABEL), 'A doomed question');
    await user.keyboard('{Enter}');

    act(() => {
      instances[0].callbacks.onError?.('connection_lost', 'Lost connection to the server.');
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Connection lost');
    expect(screen.getAllByText('A doomed question')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /retry this question/i }));

    // Same question, re-sent on a new socket.
    expect(instances).toHaveLength(2);
    expect(instances[1].query).toBe('A doomed question');

    // The stale error card and its Retry control are gone, and the question is
    // not echoed a second time.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry this question/i })).not.toBeInTheDocument();
    expect(screen.getAllByText('A doomed question')).toHaveLength(1);

    act(() => {
      instances[1].callbacks.onToken?.('The retried answer.');
      instances[1].callbacks.onComplete?.({
        query_id: 'q-retry',
        latency_ms: 120,
        model_used: 'qwen3:4b',
        token_count: 3,
        from_cache: false,
      });
    });

    expect(screen.getByText('The retried answer.')).toBeInTheDocument();
    expect(screen.getAllByText('A doomed question')).toHaveLength(1);
  });

  it('renders the abstention card and hides feedback when onComplete reports insufficient evidence', async () => {
    const user = userEvent.setup();
    renderChatPage();

    const textarea = screen.getByLabelText(ASK_LABEL);
    await user.type(textarea, 'What is the moon made of?');
    await user.keyboard('{Enter}');

    const { callbacks } = instances[0];

    act(() => {
      callbacks.onToken?.('I cannot find this information in your documents.');
      callbacks.onComplete?.({
        query_id: 'q-abstain',
        latency_ms: 42,
        model_used: 'abstain',
        token_count: 0,
        from_cache: false,
        edge_case: 'insufficient_evidence',
        sufficiency: {
          sufficient: false,
          reason: 'low_relevance',
          top_score: 0.02,
          supporting_count: 0,
          searched_count: 5,
          document_count: 2,
        },
      });
    });

    expect(screen.getByText('No sufficient evidence')).toBeInTheDocument();
    expect(
      screen.getByText('Searched 5 chunks across 2 documents · best evidence score 0.02'),
    ).toBeInTheDocument();

    // Suggestion chips replace the normal action cluster.
    expect(screen.getByRole('button', { name: /rephrase the question/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /upload a document/i })).toBeInTheDocument();

    // No citations, no feedback thumbs, no audit trail on an abstention —
    // nothing was generated, so there is nothing to verify or rate.
    expect(screen.queryByLabelText('Good answer')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Bad answer')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Verification record')).not.toBeInTheDocument();
  });

  it('calls cancel() on the socket when Stop is clicked', async () => {
    const user = userEvent.setup();
    renderChatPage();

    const textarea = screen.getByLabelText(ASK_LABEL);
    await user.type(textarea, 'A long-running question');
    await user.keyboard('{Enter}');

    await user.click(screen.getByRole('button', { name: /stop generating/i }));

    expect(mockCancel).toHaveBeenCalledTimes(1);
  });

  it('shows a Reconnecting badge on the streaming answer and clears it on reconnect', async () => {
    const user = userEvent.setup();
    renderChatPage();

    const textarea = screen.getByLabelText(ASK_LABEL);
    await user.type(textarea, 'A question over a flaky link');
    await user.keyboard('{Enter}');

    const { callbacks } = instances[0];

    act(() => {
      callbacks.onToken?.('Partial ans');
    });
    expect(screen.queryByRole('status', { name: /reconnecting/i })).not.toBeInTheDocument();

    act(() => {
      callbacks.onReconnecting?.(2);
    });

    expect(screen.getByRole('status', { name: /reconnecting/i })).toHaveTextContent(
      'Reconnecting… (2/4)',
    );
    // The partial answer stays on screen while the client resumes.
    expect(screen.getByText('Partial ans')).toBeInTheDocument();

    act(() => {
      callbacks.onReconnected?.();
    });

    expect(screen.queryByRole('status', { name: /reconnecting/i })).not.toBeInTheDocument();
  });

  it('replaces the stale partial answer when the stream restarts from scratch', async () => {
    const user = userEvent.setup();
    renderChatPage();

    await user.type(screen.getByLabelText(ASK_LABEL), 'A question whose buffer expires');
    await user.keyboard('{Enter}');

    const { callbacks } = instances[0];

    act(() => {
      callbacks.onToken?.('Hel');
      callbacks.onSource?.(makeSource());
    });
    expect(screen.getByText('Hel')).toBeInTheDocument();

    // The buffer expired, so the client re-ran the query — everything already
    // rendered belongs to a stream that no longer exists.
    act(() => {
      callbacks.onStreamRestart?.();
    });
    act(() => {
      callbacks.onToken?.('Hello');
      callbacks.onSource?.(makeSource());
    });

    // Appended rather than replaced, this would read "HelHello" with the source
    // listed twice (and duplicate React keys).
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.queryByText('HelHello')).not.toBeInTheDocument();

    act(() => {
      callbacks.onComplete?.({
        query_id: 'q-2',
        latency_ms: 500,
        model_used: 'qwen3:4b',
        token_count: 1,
        from_cache: false,
      });
    });

    // Exhibits lists the source once, not twice.
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getAllByText('Alpha Report')).toHaveLength(1);
  });

  it('releases the composer when a resumed stream ends without completing', async () => {
    const user = userEvent.setup();
    renderChatPage();

    await user.type(screen.getByLabelText(ASK_LABEL), 'A truncated answer');
    await user.keyboard('{Enter}');

    act(() => {
      instances[0].callbacks.onError?.('stream_ended', 'Stream ended without completion');
    });

    expect(screen.getByLabelText(ASK_LABEL)).not.toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Answer incomplete');
    expect(screen.getByRole('button', { name: /retry this question/i })).toBeInTheDocument();
  });

  it('re-enables the composer and offers Retry when the connection is lost for good', async () => {
    const user = userEvent.setup();
    renderChatPage();

    await user.type(screen.getByLabelText(ASK_LABEL), 'A doomed question');
    await user.keyboard('{Enter}');

    expect(screen.getByLabelText(ASK_LABEL)).toBeDisabled();

    const { callbacks } = instances[0];

    act(() => {
      callbacks.onReconnecting?.(4);
    });
    act(() => {
      callbacks.onError?.('connection_lost', 'Lost connection to the server.');
    });

    // The textarea used to stay locked forever, because a dropped socket
    // reported nothing at all.
    expect(screen.getByLabelText(ASK_LABEL)).not.toBeDisabled();
    expect(screen.queryByRole('status', { name: /reconnecting/i })).not.toBeInTheDocument();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Connection lost');
    expect(alert).toHaveTextContent('Lost connection to the server.');
    expect(screen.getByRole('button', { name: /retry this question/i })).toBeInTheDocument();
  });

  // ─── Claim Ledger (L1/L2, redesigned) ───────────────────────────────────────

  it('shows the audit trail live while streaming, with progress-frame counts', async () => {
    const user = userEvent.setup();
    renderChatPage();

    await user.type(screen.getByLabelText(ASK_LABEL), 'Summarise revenue');
    await user.keyboard('{Enter}');

    const { callbacks } = instances[0];
    act(() => {
      callbacks.onProgress?.('retrieval', 0.1, progressDetail());
    });
    expect(screen.getByText('Answering')).toBeInTheDocument();

    act(() => {
      callbacks.onProgress?.('ranking', 0.4, progressDetail({ found: 16 }));
    });
    expect(screen.getByText('16 found', { exact: false })).toBeInTheDocument();
  });

  it('shows claim tally chips and a Claim Ledger row per claim once the guardrail frame lands', async () => {
    const user = userEvent.setup();
    renderChatPage();

    await user.type(screen.getByLabelText(ASK_LABEL), 'Summarise revenue');
    await user.keyboard('{Enter}');

    const { callbacks } = instances[0];

    act(() => {
      callbacks.onToken?.('Revenue grew 12%. It rained yesterday. Sales fell 5%.');
      callbacks.onGuardrail?.(guardrailPayload([
        makeClaim({ verdict: 'supported' }),
        makeClaim({ text: 'Sales fell 5%.', verdict: 'partial', chunk_id: 'chunk-2' }),
        makeClaim({ text: 'It rained yesterday.', verdict: 'unsupported', chunk_id: 'chunk-3' }),
      ]));
      callbacks.onComplete?.({
        query_id: 'q-lens-1',
        latency_ms: 400,
        model_used: 'qwen3:4b',
        token_count: 12,
        from_cache: false,
      });
    });

    expect(screen.getByRole('button', { name: '1 verified' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 partial' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 unsupported' })).toBeInTheDocument();

    // Ledger is the default view — one row per claim, no toggle needed to see it.
    expect(screen.getByText('C1')).toBeInTheDocument();
    expect(screen.getByText('C2')).toBeInTheDocument();
    expect(screen.getByText('C3')).toBeInTheDocument();
  });

  it('"Read as prose" switches off the ledger and shows the claim inline with a verdict icon', async () => {
    const user = userEvent.setup();
    renderChatPage();

    await user.type(screen.getByLabelText(ASK_LABEL), 'Summarise revenue');
    await user.keyboard('{Enter}');

    const claimText = 'Revenue grew 12%.';
    const content = `${claimText} It rained yesterday.`;
    const { callbacks } = instances[0];

    act(() => {
      callbacks.onToken?.(content);
      callbacks.onGuardrail?.(guardrailPayload([makeClaim({ text: claimText, verdict: 'supported' })]));
      callbacks.onComplete?.({
        query_id: 'q-lens-2',
        latency_ms: 300,
        model_used: 'qwen3:4b',
        token_count: 8,
        from_cache: false,
      });
    });

    expect(screen.getByText('C1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Read as prose' }));

    expect(screen.queryByText('C1')).not.toBeInTheDocument();
    // The claim and the rest of the answer both render inline (split across
    // spans by the verdict icon), so match on substrings rather than the
    // whole string in one text node.
    expect(screen.getByText(/Revenue grew 12%\./)).toBeInTheDocument();
    expect(screen.getByText(/It rained yesterday\./)).toBeInTheDocument();
    expect(screen.getByText('(verified)')).toBeInTheDocument();
  });

  it('expanding a claim row shows its evidence and "View in document" calls the source viewer', async () => {
    const user = userEvent.setup();
    renderChatPage();

    await user.type(screen.getByLabelText(ASK_LABEL), 'Summarise revenue');
    await user.keyboard('{Enter}');

    const claimText = 'Revenue grew 12%.';
    const { callbacks } = instances[0];

    act(() => {
      callbacks.onToken?.(claimText);
      callbacks.onGuardrail?.(guardrailPayload([makeClaim({ text: claimText, verdict: 'supported' })]));
      callbacks.onComplete?.({
        query_id: 'q-lens-3',
        latency_ms: 300,
        model_used: 'qwen3:4b',
        token_count: 8,
        from_cache: false,
      });
    });

    await user.click(screen.getByRole('button', { name: /why c1 is verified/i }));

    expect(screen.getByText(/Revenue increased by 12 percent/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /view in document/i }));

    expect(mockOpenSourceViewer).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      documentId: 'doc-1',
      chunkId: 'chunk-1',
      documentName: 'Alpha Report',
      pageNumber: 3,
      // C1: the ledger row passes the claim's own evidence sentence so the
      // viewer can locate just the cited passage, not the whole chunk.
      highlightText: 'Revenue increased by 12 percent year over year.',
    });
  });

  it('clicking a suggested question sends it immediately instead of only filling the input', async () => {
    const user = userEvent.setup();
    renderChatPage();

    const question = 'What are the key findings in my documents?';
    await user.click(screen.getByRole('button', { name: question }));

    expect(instances).toHaveLength(1);
    expect(instances[0].query).toBe(question);
    expect(mockConnect).toHaveBeenCalledTimes(1);
    // Sent immediately — not just parked in the composer.
    expect(screen.getByLabelText(ASK_LABEL)).toHaveValue('');
  });
});
