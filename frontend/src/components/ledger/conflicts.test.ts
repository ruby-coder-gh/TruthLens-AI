import { describe, it, expect } from 'vitest';
import { pairClaimConflicts, extractFigure, figureDiff } from './conflicts';
import type { Claim, Contradiction } from '../../api/types';

function claim(overrides: Partial<Claim>): Claim {
  return {
    text: 'placeholder',
    start: 0,
    end: 0,
    verdict: 'supported',
    entailment: 0.9,
    contradiction: 0.05,
    source_index: 1,
    chunk_id: null,
    document_id: null,
    document_name: null,
    page_number: null,
    evidence: null,
    ...overrides,
  };
}

function contradiction(overrides: Partial<Contradiction>): Contradiction {
  return {
    id: 'contra-1',
    score: 0.9,
    similarity: 0.8,
    status: 'open',
    created_at: '2026-01-01T00:00:00Z',
    a: { document_id: 'd1', document_name: 'Annual Report', chunk_id: 'chunk-a', page_number: 3, sentence: 'Revenue in 2025 was €412 million.' },
    b: { document_id: 'd2', document_name: 'Q4 Results', chunk_id: 'chunk-b', page_number: 1, sentence: 'Revenue in 2025 was €398 million.' },
    ...overrides,
  };
}

describe('pairClaimConflicts', () => {
  it('pairs claims whose chunk_ids match either side of an open contradiction', () => {
    const claims = [
      claim({ text: 'Revenue was €412 million', chunk_id: 'chunk-a' }),
      claim({ text: 'unrelated claim', chunk_id: 'chunk-x' }),
      claim({ text: 'the press release gives €398 million', chunk_id: 'chunk-b' }),
    ];
    const pairs = pairClaimConflicts(claims, [contradiction({})]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ claimAIndex: 0, claimBIndex: 2 });
  });

  it('skips a contradiction when only one side is cited in this answer', () => {
    const claims = [claim({ chunk_id: 'chunk-a' })];
    expect(pairClaimConflicts(claims, [contradiction({})])).toHaveLength(0);
  });

  it('returns no pairs when there are no open contradictions', () => {
    const claims = [claim({ chunk_id: 'chunk-a' }), claim({ chunk_id: 'chunk-b' })];
    expect(pairClaimConflicts(claims, [])).toHaveLength(0);
  });
});

describe('extractFigure', () => {
  it('extracts a currency figure with a scale word', () => {
    expect(extractFigure('Revenue was €412 million for 2025')).toMatchObject({ value: 412, unit: '€ million' });
  });

  it('returns null when there is no number in the text', () => {
    expect(extractFigure('Growth came mainly from the expansion')).toBeNull();
  });
});

describe('figureDiff', () => {
  it('computes the difference when both claims cite a figure with the same unit', () => {
    const a = claim({ text: 'Revenue was €412 million' });
    const b = claim({ text: 'the press release gives a different figure of €398 million' });
    expect(figureDiff(a, b)).toMatchObject({ diff: 14 });
  });

  it('returns null when units differ', () => {
    const a = claim({ text: 'Revenue was €412 million' });
    const b = claim({ text: 'Revenue was 398 thousand units' });
    expect(figureDiff(a, b)).toBeNull();
  });
});
