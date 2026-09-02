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
  return { QueryWebSocket: MockQueryWebSocket };
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
});
