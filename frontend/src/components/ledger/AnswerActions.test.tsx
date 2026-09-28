import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/utils';
import { stripCitationMarkers, formatLatency, ClaimTallyChips, AnswerActionBar } from './AnswerActions';
import { tallyClaims } from './verdict';
import type { Claim } from '../../api/types';

describe('stripCitationMarkers', () => {
  it('replaces [source:N] with the reader-facing [N] (BUG-9)', () => {
    expect(stripCitationMarkers('Revenue was €412 million [source:2].')).toBe('Revenue was €412 million [2].');
  });

  it('leaves text with no markers untouched', () => {
    expect(stripCitationMarkers('No citations here.')).toBe('No citations here.');
  });
});

describe('formatLatency', () => {
  it('shows milliseconds under a second', () => {
    expect(formatLatency(842)).toBe('842ms');
  });

  it('shows seconds at or above a second', () => {
    expect(formatLatency(1500)).toBe('1.5s');
  });
});

function claim(overrides: Partial<Claim>): Claim {
  return {
    text: 't', start: 0, end: 1, verdict: 'supported', entailment: 0.9, contradiction: 0.01,
    source_index: 1, chunk_id: null, document_id: null, document_name: null, page_number: null, evidence: null,
    ...overrides,
  };
}

describe('ClaimTallyChips', () => {
  it('renders one chip per non-zero verdict and switches to the ledger view on click', async () => {
    const user = userEvent.setup();
    const claims = [claim({ verdict: 'supported' }), claim({ verdict: 'partial' })];
    const onSelectLedgerView = vi.fn();
    renderWithProviders(<ClaimTallyChips claims={claims} tally={tallyClaims(claims)} conflictPairs={[]} onSelectLedgerView={onSelectLedgerView} />);

    expect(screen.getByRole('button', { name: '1 verified' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 partial' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /unsupported/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '1 verified' }));
    expect(onSelectLedgerView).toHaveBeenCalled();
  });
});

describe('AnswerActionBar', () => {
  it('copies the answer text with citation markers stripped (BUG-9)', async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    renderWithProviders(<AnswerActionBar content="Revenue grew [source:1]." onCopy={onCopy} canRegenerate />);
    await user.click(screen.getByLabelText('Copy response'));
    expect(onCopy).toHaveBeenCalledWith('Revenue grew [1].');
  });

  it('shows Regenerate whenever canRegenerate is true, not only for cached answers (BUG-31)', () => {
    renderWithProviders(<AnswerActionBar content="x" onCopy={vi.fn()} onRegenerate={vi.fn()} canRegenerate servedFromCache={false} />);
    expect(screen.getByLabelText('Regenerate with fresh retrieval')).toBeInTheDocument();
  });

  it('hides Export/feedback/Regenerate when their handlers are not supplied', () => {
    renderWithProviders(<AnswerActionBar content="x" onCopy={vi.fn()} />);
    expect(screen.queryByLabelText('Export as Markdown')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Good answer')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Regenerate with fresh retrieval')).not.toBeInTheDocument();
  });
});
