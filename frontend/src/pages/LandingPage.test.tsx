import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/utils';
import LandingPage from './LandingPage';
import { useReady } from '../hooks/useReady';
import type { UseReadyResult } from '../hooks/useReady';

vi.mock('../hooks/useReady', () => ({ useReady: vi.fn() }));

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

describe('LandingPage', () => {
  beforeEach(() => {
    vi.mocked(useReady).mockReset();
  });

  it('does not show the live-demo CTA outside demo mode', () => {
    mockReady({ demoMode: false });
    renderWithProviders(<LandingPage />, { route: '/' });

    expect(screen.queryByRole('button', { name: /try the live demo/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /launch workspace/i })).toBeInTheDocument();
  });

  it('shows the live-demo CTA in demo mode, logs in, and navigates to the demo workspace chat', async () => {
    mockReady({ demoMode: true, demoWorkspaceId: 'ws-demo-1' });
    const loginDemo = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderWithProviders(
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/workspaces/:id/chat" element={<div>Demo Chat</div>} />
      </Routes>,
      { route: '/', authValue: { loginDemo } },
    );

    const cta = screen.getByRole('button', { name: /try the live demo/i });
    await user.click(cta);

    await waitFor(() => expect(loginDemo).toHaveBeenCalledWith('analyst'));
    expect(await screen.findByText('Demo Chat')).toBeInTheDocument();
  });

  it('shows an error and stays on the page when the demo login fails', async () => {
    mockReady({ demoMode: true, demoWorkspaceId: 'ws-demo-1' });
    const loginDemo = vi.fn().mockRejectedValue(new Error('Demo backend unavailable'));
    const user = userEvent.setup();

    renderWithProviders(<LandingPage />, { route: '/', authValue: { loginDemo } });

    await user.click(screen.getByRole('button', { name: /try the live demo/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/demo backend unavailable/i);
  });
});
