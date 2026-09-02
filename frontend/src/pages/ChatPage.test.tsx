import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/utils';
import ChatPage from './ChatPage';
import type { QueryWebSocketCallbacks } from '../api/websocket';

vi.mock('../api/client', () => ({
  feedbackApi: { submit: vi.fn() },
  queryApi: { exportMarkdown: vi.fn() },
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

    act(() => {
      callbacks.onComplete?.({
        query_id: 'q-1',
        latency_ms: 842,
        model_used: 'qwen3:4b',
        token_count: 12,
        from_cache: false,
      });
    });

    expect(screen.getByText('842ms')).toBeInTheDocument();
    expect(screen.getByText('qwen3:4b')).toBeInTheDocument();
    expect(screen.getByLabelText('Copy response')).toBeInTheDocument();
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
