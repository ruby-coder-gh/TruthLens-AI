import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/utils';
import AdminPromptsPage from './AdminPromptsPage';
import type { ActivePrompt, PromptVersion } from '../api/types';

const {
  list, get, active, create, evaluate, promote, rollback, remove, diff,
} = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  active: vi.fn(),
  create: vi.fn(),
  evaluate: vi.fn(),
  promote: vi.fn(),
  rollback: vi.fn(),
  remove: vi.fn(),
  diff: vi.fn(),
}));

vi.mock('../api/client', () => ({
  adminApi: {
    prompts: { list, get, active, create, evaluate, promote, rollback, remove, diff },
  },
}));

const THRESHOLDS = {
  min_faithfulness: 0.6,
  min_trust: 0.5,
  min_context_precision: 0.5,
  refusal_accuracy_min: 0.7,
};

const ACTIVE_CONTENT = 'Line one\nLine two\n';

function makeVersion(overrides: Partial<PromptVersion> & Pick<PromptVersion, 'id' | 'version' | 'status'>): PromptVersion {
  return {
    name: 'answer',
    content: 'Answer only from the provided context.',
    content_hash: 'aaa111bbb222',
    model_name: 'llama3.2:3b',
    created_by: 'u-1',
    promoted_at: null,
    eval_run_id: null,
    notes: null,
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
    eval: null,
    ...overrides,
  };
}

const draftVersion = makeVersion({
  id: 'p-draft',
  version: 3,
  status: 'draft',
  content_hash: 'aaa111bbb222',
  content: 'Line one\nLine three\n',
});

const stagedVersion = makeVersion({
  id: 'p-staged',
  version: 2,
  status: 'staged',
  content_hash: 'ccc333ddd444',
  eval_run_id: 'e-1',
  eval: {
    id: 'e-1',
    status: 'passed',
    subset: 'smoke',
    model_used: 'llama3.2:3b',
    golden_set_version: 'bcb6d9b3613b',
    faithfulness: 0.95,
    context_precision: null,
    context_recall: null,
    answer_relevance: 0.72,
    answer_correctness: null,
    refusal_accuracy: 1,
    trust: 0.86,
    verdict: { passed: true, failed_metrics: [], thresholds: THRESHOLDS },
    run_at: '2026-09-02T17:32:36Z',
  },
});

const activeVersion = makeVersion({
  id: 'p-active',
  version: 1,
  status: 'active',
  content_hash: 'eee555fff666',
  content: ACTIVE_CONTENT,
  promoted_at: '2026-09-02T18:00:00Z',
});

const activePrompt: ActivePrompt = {
  name: 'answer',
  content: ACTIVE_CONTENT,
  content_hash: 'eee555fff666',
  model_name: 'llama3.2:3b',
  version: 1,
  version_id: 'p-active',
  is_default: false,
};

function gateError() {
  return Object.assign(new Error('eval_gate_failed'), {
    name: 'ApiError',
    status: 409,
    details: {
      detail: 'eval_gate_failed',
      reason: 'thresholds_not_met',
      failed_metrics: ['faithfulness', 'trust'],
      thresholds: THRESHOLDS,
      scores: { faithfulness: 0.05, trust: 0.46, refusal_accuracy: 1, context_precision: null },
    },
  });
}

describe('AdminPromptsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue({ data: [draftVersion, stagedVersion, activeVersion] });
    active.mockResolvedValue(activePrompt);
    get.mockResolvedValue(draftVersion);
    diff.mockResolvedValue({
      from_id: 'p-active',
      from_label: 'answer active (eee555fff666)',
      to_id: 'p-draft',
      to_label: 'answer v3 (aaa111bbb222)',
      diff: '--- a\n+++ b\n',
    });
  });

  it('renders a row per version with its status badge', async () => {
    renderWithProviders(<AdminPromptsPage />, { route: '/admin/prompts' });

    const rows = await screen.findAllByRole('row');
    // 1 header row + 3 version rows
    expect(rows).toHaveLength(4);

    const draftRow = screen.getByRole('row', { name: /answer v3/i });
    expect(within(draftRow).getByText('draft')).toBeInTheDocument();
    expect(within(draftRow).getByText('aaa111bbb222')).toBeInTheDocument();
    expect(within(draftRow).getByText('llama3.2:3b')).toBeInTheDocument();

    expect(within(screen.getByRole('row', { name: /answer v2/i })).getByText('staged')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /answer v1/i })).getByText('active')).toBeInTheDocument();
  });

  it('scores the eval against its thresholds with a pass/fail marker', async () => {
    renderWithProviders(<AdminPromptsPage />, { route: '/admin/prompts' });

    const stagedRow = await screen.findByRole('row', { name: /answer v2/i });
    const faithfulness = within(stagedRow).getByText(/faithfulness/i);
    expect(faithfulness).toHaveTextContent('0.95');
    // Threshold is surfaced, not just the raw score.
    expect(faithfulness).toHaveTextContent('0.60');
    expect(faithfulness).toHaveTextContent(/pass/i);
  });

  it('disables Promote for a draft and enables it for a staged version', async () => {
    renderWithProviders(<AdminPromptsPage />, { route: '/admin/prompts' });

    expect(await screen.findByRole('button', { name: 'Promote answer v3' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Promote answer v2' })).toBeEnabled();
  });

  it('shows the failed metrics and a Force promote button when the gate refuses', async () => {
    const user = userEvent.setup();
    promote.mockRejectedValueOnce(gateError());
    promote.mockResolvedValueOnce({ ...stagedVersion, status: 'active' });

    renderWithProviders(<AdminPromptsPage />, { route: '/admin/prompts' });

    await user.click(await screen.findByRole('button', { name: 'Promote answer v2' }));

    const dialog = await screen.findByRole('dialog', { name: /promotion blocked/i });
    expect(within(dialog).getByText(/scores below threshold/i)).toBeInTheDocument();

    const failedRow = within(dialog).getByRole('row', { name: /faithfulness/i });
    expect(failedRow).toHaveTextContent('0.05');
    expect(failedRow).toHaveTextContent('0.60');
    expect(within(dialog).getByRole('row', { name: /trust/i })).toHaveTextContent('0.46');

    // Force promote sits behind an explicit confirmation step.
    await user.click(within(dialog).getByRole('button', { name: /^force promote$/i }));
    expect(promote).toHaveBeenCalledTimes(1);

    await user.click(within(dialog).getByRole('button', { name: /confirm force promote/i }));
    await waitFor(() => expect(promote).toHaveBeenLastCalledWith('p-staged', true));
  });

  it('queues a smoke eval for the selected row', async () => {
    const user = userEvent.setup();
    evaluate.mockResolvedValue({
      eval_run_id: 'e-2', prompt_version_id: 'p-draft', subset: 'smoke', status: 'running',
    });

    renderWithProviders(<AdminPromptsPage />, { route: '/admin/prompts' });

    await user.click(await screen.findByRole('button', { name: 'Run eval for answer v3' }));

    await waitFor(() => expect(evaluate).toHaveBeenCalledWith('p-draft', 'smoke'));
    const draftRow = screen.getByRole('row', { name: /answer v3/i });
    expect(await within(draftRow).findByText(/queued/i)).toBeInTheDocument();
  });

  it('renders added and removed lines in the diff modal', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminPromptsPage />, { route: '/admin/prompts' });

    await user.click(await screen.findByRole('button', { name: 'Diff answer v3 against active' }));

    const dialog = await screen.findByRole('dialog', { name: /diff vs active/i });
    await waitFor(() => expect(diff).toHaveBeenCalledWith('p-draft', 'active'));

    const removed = within(dialog).getByText('Line two');
    expect(removed.closest('li')).toHaveClass('text-red');
    expect(removed.closest('li')).toHaveTextContent(/removed/i);

    const added = within(dialog).getByText('Line three');
    expect(added.closest('li')).toHaveClass('text-green');
    expect(added.closest('li')).toHaveTextContent(/added/i);

    // Unchanged context lines are still rendered, uncoloured.
    expect(within(dialog).getByText('Line one').closest('li')).not.toHaveClass('text-green');
  });

  it('renders an error state with a retry when the list fails', async () => {
    const user = userEvent.setup();
    list.mockRejectedValueOnce(new Error('boom'));

    renderWithProviders(<AdminPromptsPage />, { route: '/admin/prompts' });

    expect(await screen.findByRole('alert')).toHaveTextContent(/boom/i);
    await user.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.getByRole('row', { name: /answer v3/i })).toBeInTheDocument());
  });

  it('renders an empty state when no versions exist', async () => {
    list.mockResolvedValue({ data: [] });

    renderWithProviders(<AdminPromptsPage />, { route: '/admin/prompts' });

    expect(await screen.findByText(/no prompt versions/i)).toBeInTheDocument();
  });
});
