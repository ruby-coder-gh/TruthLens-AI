import { describe, it, expect } from 'vitest';
import { pairClaimConflicts, conflictRowId, countSourceConflicts, extractFigure, figureDiff, formatFigureDiff } from './conflicts';
import type { Claim, Contradiction, Source } from '../../api/types';

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

  it('still pairs a contradiction when only one side is cited in this answer (BUG-5)', () => {
    const claims = [claim({ chunk_id: 'chunk-a' })];
    const pairs = pairClaimConflicts(claims, [contradiction({})]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ claimAIndex: 0, claimBIndex: -1 });
  });

  it('skips a contradiction when neither side is cited in this answer', () => {
    const claims = [claim({ chunk_id: 'chunk-x' })];
    expect(pairClaimConflicts(claims, [contradiction({})])).toHaveLength(0);
  });

  it('returns no pairs when there are no open contradictions', () => {
    const claims = [claim({ chunk_id: 'chunk-a' }), claim({ chunk_id: 'chunk-b' })];
    expect(pairClaimConflicts(claims, [])).toHaveLength(0);
  });
});

describe('conflictRowId', () => {
  it('points at the partner claim row when the partner is cited', () => {
    const pair = { claimAIndex: 0, claimBIndex: 2, contradiction: contradiction({}) };
    expect(conflictRowId(pair, 'a')).toBe('row-C1');
    expect(conflictRowId(pair, 'b')).toBe('row-C3');
  });

  it('falls back to the discrepancy row when the partner side is uncited', () => {
    const pair = { claimAIndex: 0, claimBIndex: -1, contradiction: contradiction({ id: 'contra-9' }) };
    expect(conflictRowId(pair, 'b')).toBe('row-D-contra-9');
  });
});

describe('countSourceConflicts', () => {
  function source(overrides: Partial<Source> = {}): Source {
    return { chunk_id: 'chunk-a', document_id: 'd1', excerpt: '', relevance_score: 0.9, ...overrides };
  }

  it('backfills a conflict count for a source that never carried one (BUG-22)', () => {
    const sources = [source({ chunk_id: 'chunk-a' }), source({ chunk_id: 'chunk-b', document_id: 'd2' }), source({ chunk_id: 'chunk-z', document_id: 'd3' })];
    const result = countSourceConflicts(sources, [contradiction({})]);
    expect(result.find((s) => s.chunk_id === 'chunk-a')?.conflicts).toBe(1);
    expect(result.find((s) => s.chunk_id === 'chunk-b')?.conflicts).toBe(1);
    expect(result.find((s) => s.chunk_id === 'chunk-z')?.conflicts).toBe(0);
  });

  it('leaves sources alone when every one already carries a conflicts count', () => {
    const sources = [source({ conflicts: 0 })];
    expect(countSourceConflicts(sources, [contradiction({})])).toBe(sources);
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
  it('computes the difference when both texts cite a figure with the same unit', () => {
    const diff = figureDiff('Revenue was €412 million', 'the press release gives a different figure of €398 million');
    expect(diff).toMatchObject({ diff: 14 });
  });

  it('returns null when units differ', () => {
    expect(figureDiff('Revenue was €412 million', 'Revenue was 398 thousand units')).toBeNull();
  });

  it('works from a raw radar sentence, not just a claim (BUG-5 uncited partner)', () => {
    expect(figureDiff('Revenue was €412 million.', 'Revenue was €398 million.')).toMatchObject({ diff: 14 });
  });
});

describe('formatFigureDiff', () => {
  it('collapses a currency + scale-word figure to a compact suffix (BUG-29)', () => {
    const diff = figureDiff('Revenue was €412 million', 'vs €398 million')!;
    expect(formatFigureDiff(diff)).toBe('€14M');
  });

  it('keeps a bare percentage as a percentage', () => {
    const diff = figureDiff('Emissions fell 41%', 'Emissions fell 34%')!;
    expect(formatFigureDiff(diff)).toBe('7%');
  });

  it('labels an entirely unit-less figure "pts" instead of a naked number', () => {
    const diff = figureDiff('Headcount was 1580', 'Headcount was 1240')!;
    expect(formatFigureDiff(diff)).toBe('340 pts');
  });
});
