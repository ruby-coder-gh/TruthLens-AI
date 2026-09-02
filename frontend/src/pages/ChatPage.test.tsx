import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/utils';
import ChatPage from './ChatPage';
import { queryApi } from '../api/client';
import type { QueryWebSocketCallbacks } from '../api/websocket';
import type { Source } from '../api/types';

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

vi.mock('../api/client', () => ({
  feedbackApi: { submit: vi.fn() },
  queryApi: { exportMarkdown: vi.fn().mockResolvedValue({ blob: new Blob(['#']), filename: 'a.md' }) },
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
    ) {
      this.workspaceId = workspaceId;
      this.query = query;
      this.callbacks = callbacks;
      this.conversationId = conversationId;
      this.topK = topK;
      this.forceRefresh = forceRefresh;
      instances.push(this);
    }
  }
  // Mirrors WS_RECONNECT_BACKOFF_MS.length in ../api/websocket — the real
  // value is asserted in websocket.test.ts, so a change there fails loudly.
  return { QueryWebSocket: MockQueryWebSocket, WS_RECONNECT_MAX: 4 };
});

function renderChatPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/workspaces/:id/chat" element={<ChatPage />} />
    </Routes>,
    { route: '/workspaces/ws-1/chat' },
  );
}

describe('ChatPage', () => {
  beforeEach(() => {
    // The Markdown export clicks a generated <a download>; jsdom can't navigate
    // and logs "Not implemented" for it.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    instances.length = 0;
    mockConnect.mockClear();
    mockDisconnect.mockClear();
    mockCancel.mockClear();
  });

  it('renders the empty state before any query has been sent', () => {
    renderChatPage();

    expect(screen.getByText('Ask anything')).toBeInTheDocument();
  });

  it('constructs a QueryWebSocket with the workspace id + text and connects on Enter', async () => {
    const user = userEvent.setup();
    renderChatPage();

    const textarea = screen.getByLabelText('Type your question');
    await user.type(textarea, 'What is the meaning of life?');
    await user.keyboard('{Enter}');

    expect(instances).toHaveLength(1);
    expect(instances[0].workspaceId).toBe('ws-1');
    expect(instances[0].query).toBe('What is the meaning of life?');
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('updates the bubble to complete as onToken and onComplete fire', async () => {
    const user = userEvent.setup();
    renderChatPage();

    const textarea = screen.getByLabelText('Type your question');
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

  it('shows an error and a Retry action when onError fires', async () => {
    const user = userEvent.setup();
    renderChatPage();

    const textarea = screen.getByLabelText('Type your question');
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

    await user.type(screen.getByLabelText('Type your question'), 'A doomed question');
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

    const textarea = screen.getByLabelText('Type your question');
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

    // No citations, no feedback thumbs on an abstention.
    expect(screen.queryByLabelText('Thumbs up')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Thumbs down')).not.toBeInTheDocument();

    // The evidence panel must not present trust 0.0 as a generic low-trust
    // verdict — an abstention is a correct refusal, not a bad answer.
    expect(screen.getByText('ABSTAINED')).toBeInTheDocument();
    expect(screen.queryByText('Flagged')).not.toBeInTheDocument();
  });

  it('calls cancel() on the socket when Stop is clicked', async () => {
    const user = userEvent.setup();
    renderChatPage();

    const textarea = screen.getByLabelText('Type your question');
    await user.type(textarea, 'A long-running question');
    await user.keyboard('{Enter}');

    await user.click(screen.getByRole('button', { name: /stop generating/i }));

    expect(mockCancel).toHaveBeenCalledTimes(1);
  });

  it('shows a Reconnecting badge on the streaming bubble and clears it on reconnect', async () => {
    const user = userEvent.setup();
    renderChatPage();

    const textarea = screen.getByLabelText('Type your question');
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

    await user.type(screen.getByLabelText('Type your question'), 'A question whose buffer expires');
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

    // Evidence surfaces once the answer completes: one card, not two.
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sources/i })).toHaveTextContent('1');
    expect(screen.getAllByText('Revenue grew by 12% year over year.')).toHaveLength(1);
  });

  it('releases the composer when a resumed stream ends without completing', async () => {
    const user = userEvent.setup();
    renderChatPage();

    await user.type(screen.getByLabelText('Type your question'), 'A truncated answer');
    await user.keyboard('{Enter}');

    act(() => {
      instances[0].callbacks.onError?.('stream_ended', 'Stream ended without completion');
    });

    expect(screen.getByLabelText('Type your question')).not.toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Answer incomplete');
    expect(screen.getByRole('button', { name: /retry this question/i })).toBeInTheDocument();
  });

  it('re-enables the composer and offers Retry when the connection is lost for good', async () => {
    const user = userEvent.setup();
    renderChatPage();

    await user.type(screen.getByLabelText('Type your question'), 'A doomed question');
    await user.keyboard('{Enter}');

    expect(screen.getByLabelText('Type your question')).toBeDisabled();

    const { callbacks } = instances[0];

    act(() => {
      callbacks.onReconnecting?.(4);
    });
    act(() => {
      callbacks.onError?.('connection_lost', 'Lost connection to the server.');
    });

    // The textarea used to stay locked forever, because a dropped socket
    // reported nothing at all.
    expect(screen.getByLabelText('Type your question')).not.toBeDisabled();
    expect(screen.queryByRole('status', { name: /reconnecting/i })).not.toBeInTheDocument();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Connection lost');
    expect(alert).toHaveTextContent('Lost connection to the server.');
    expect(screen.getByRole('button', { name: /retry this question/i })).toBeInTheDocument();
  });
});
