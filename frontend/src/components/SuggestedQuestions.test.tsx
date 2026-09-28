import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SuggestedQuestions } from './SuggestedQuestions';
import { demoApi } from '../api/client';

vi.mock('../api/client', () => ({
  demoApi: { suggestions: vi.fn() },
}));

describe('SuggestedQuestions', () => {
  beforeEach(() => {
    vi.mocked(demoApi.suggestions).mockReset();
  });

  it('renders fetched questions once the request resolves', async () => {
    vi.mocked(demoApi.suggestions).mockResolvedValue({ questions: ['What changed in Q2?'] });
    const onPick = vi.fn();

    render(
      <SuggestedQuestions workspaceId="ws-1" onPick={onPick} fallback={['Fallback question']} />,
    );

    expect(await screen.findByRole('button', { name: /what changed in q2/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /fallback question/i })).not.toBeInTheDocument();
  });

  it('falls back to the caller-provided list on fetch error', async () => {
    vi.mocked(demoApi.suggestions).mockRejectedValue(new Error('network down'));
    const onPick = vi.fn();

    render(
      <SuggestedQuestions workspaceId="ws-1" onPick={onPick} fallback={['Fallback question']} />,
    );

    expect(await screen.findByRole('button', { name: /fallback question/i })).toBeInTheDocument();
  });

  it('falls back to the caller-provided list on an empty response', async () => {
    vi.mocked(demoApi.suggestions).mockResolvedValue({ questions: [] });
    const onPick = vi.fn();

    render(
      <SuggestedQuestions workspaceId="ws-1" onPick={onPick} fallback={['Fallback question']} />,
    );

    expect(await screen.findByRole('button', { name: /fallback question/i })).toBeInTheDocument();
  });

  it('calls onPick with the clicked question', async () => {
    vi.mocked(demoApi.suggestions).mockResolvedValue({ questions: ['What changed in Q2?'] });
    const onPick = vi.fn();
    const user = userEvent.setup();

    render(
      <SuggestedQuestions workspaceId="ws-1" onPick={onPick} fallback={[]} />,
    );

    const chip = await screen.findByRole('button', { name: /what changed in q2/i });
    await user.click(chip);

    await waitFor(() => expect(onPick).toHaveBeenCalledWith('What changed in Q2?'));
  });

  it('renders nothing while loading with an empty fallback', () => {
    vi.mocked(demoApi.suggestions).mockReturnValue(new Promise(() => {}));
    const { container } = render(
      <SuggestedQuestions workspaceId="ws-1" onPick={vi.fn()} fallback={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
