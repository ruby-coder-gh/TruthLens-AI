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

// The four contradictions actually planted in the demo corpus (real
// wording, verbatim from backend/app/demo/corpus/*.md) — R2-3's repro case.
const REVENUE_CONTRADICTION = contradiction({
  id: 'revenue',
  a: { document_id: 'ar', document_name: 'Annual Report 2025', chunk_id: 'ar-p1', page_number: 1, sentence: 'Revenue in 2025 was €412 million.' },
  b: { document_id: 'pr', document_name: 'Q4 2025 Press Release', chunk_id: 'pr-p1', page_number: 1, sentence: 'Revenue in 2025 was €398 million.' },
});
const CEO_CONTRADICTION = contradiction({
  id: 'ceo',
  a: { document_id: 'ar', document_name: 'Annual Report 2025', chunk_id: 'ar-p1', page_number: 1, sentence: 'Dana Whitfield became Chief Executive Officer in March 2021.' },
  b: { document_id: 'lt', document_name: 'Leadership Team', chunk_id: 'lt-p1', page_number: 1, sentence: 'Dana Whitfield became Chief Executive Officer in January 2022.' },
});
const EMISSIONS_CONTRADICTION = contradiction({
  id: 'emissions',
  a: { document_id: 'ar', document_name: 'Annual Report 2025', chunk_id: 'ar-p1', page_number: 1, sentence: 'Emissions intensity was 34% below the 2020 baseline.' },
  b: { document_id: 'sr', document_name: 'Sustainability Report 2025', chunk_id: 'sr-p1', page_number: 1, sentence: 'Emissions intensity was 41% below the 2020 baseline.' },
});
const AURORA_CONTRADICTION = contradiction({
  id: 'aurora',
  a: { document_id: 'ar', document_name: 'Annual Report 2025', chunk_id: 'ar-p2', page_number: 2, sentence: 'Aurora is expected to commission in the third quarter of 2027.' },
  b: { document_id: 'bm', document_name: 'Board Memorandum: Aurora', chunk_id: 'bm-p1', page_number: 1, sentence: 'Aurora is now expected to commission in the first quarter of 2028.' },
});

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

  it('still pairs a contradiction when only one side is cited (BUG-5)', () => {
    const claims = [claim({ chunk_id: 'chunk-a', text: 'Revenue was €412 million' })];
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

  it('R2-3: skips a contradiction when the citing claim is about a different fact on the same oversized chunk', () => {
    // The claim cites the AR page-1 chunk, but it's the CEO fact, not revenue.
    const claims = [claim({ chunk_id: 'ar-p1', text: 'Dana Whitfield became Chief Executive Officer in March 2021.' })];
    expect(pairClaimConflicts(claims, [REVENUE_CONTRADICTION])).toHaveLength(0);
  });

  it('R2-3: a revenue answer attaches only the revenue conflict, not every open contradiction on the same page', () => {
    // Real repro: one claim (revenue) cites a chunk that also backs two
    // unrelated open contradictions (CEO date, emissions) on the same page.
    const claims = [claim({ chunk_id: 'ar-p1', text: 'Northwind Renewables reported revenue of €412 million for 2025.', evidence: 'Revenue in 2025 was €412 million.' })];
    const pairs = pairClaimConflicts(claims, [REVENUE_CONTRADICTION, CEO_CONTRADICTION, EMISSIONS_CONTRADICTION]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].contradiction.id).toBe('revenue');
  });

  it('R2-3: an unrelated question (no claim about any contested fact) attaches zero D-rows', () => {
    const claims = [claim({ chunk_id: 'ar-p1', text: 'Installed capacity reached 1.8 GW at the end of 2025.', evidence: 'Installed capacity reached 1.8 GW.' })];
    const pairs = pairClaimConflicts(claims, [REVENUE_CONTRADICTION, CEO_CONTRADICTION, EMISSIONS_CONTRADICTION]);
    expect(pairs).toHaveLength(0);
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

  it('R2-3: skips a bare year and finds the real figure after it', () => {
    expect(extractFigure('Revenue in 2025 was €412 million.')).toMatchObject({ value: 412, unit: '€ million' });
  });

  it('R2-3: returns null for a sentence that only contains a date, not a figure', () => {
    expect(extractFigure('Dana Whitfield became Chief Executive Officer in March 2021.')).toBeNull();
  });

  it('R2-3: never matches a lone comma as a zero-value figure (BUG-29)', () => {
    expect(extractFigure('Reports Fourth-Quarter and Full-Year 2025 Results, primary source.')).toBeNull();
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

  it('R2-3: real revenue sentences diff to 14 (formats to €14M below)', () => {
    expect(figureDiff(REVENUE_CONTRADICTION.a.sentence, REVENUE_CONTRADICTION.b.sentence)).toMatchObject({ diff: 14 });
  });

  it('R2-3: real emissions sentences diff to 7 percentage points', () => {
    expect(figureDiff(EMISSIONS_CONTRADICTION.a.sentence, EMISSIONS_CONTRADICTION.b.sentence)).toMatchObject({ diff: 7 });
  });

  it('R2-3: real CEO date sentences never produce a fake numeric difference', () => {
    expect(figureDiff(CEO_CONTRADICTION.a.sentence, CEO_CONTRADICTION.b.sentence)).toBeNull();
  });

  it('R2-3: real Aurora commissioning-quarter sentences never produce a fake numeric difference', () => {
    expect(figureDiff(AURORA_CONTRADICTION.a.sentence, AURORA_CONTRADICTION.b.sentence)).toBeNull();
  });
});

describe('formatFigureDiff', () => {
  it('collapses a currency + scale-word figure to a compact suffix (BUG-29)', () => {
    const diff = figureDiff('Revenue was €412 million', 'vs €398 million')!;
    expect(formatFigureDiff(diff)).toBe('€14M');
  });

  it('R2-3: the real revenue conflict formats to exactly €14M', () => {
    const diff = figureDiff(REVENUE_CONTRADICTION.a.sentence, REVENUE_CONTRADICTION.b.sentence)!;
    expect(formatFigureDiff(diff)).toBe('€14M');
  });

  it('labels a percentage difference in points, not a further percentage (R2-3)', () => {
    const diff = figureDiff('Emissions fell 41%', 'Emissions fell 34%')!;
    expect(formatFigureDiff(diff)).toBe('7 pts');
  });

  it('R2-3: the real emissions conflict formats to exactly "7 pts"', () => {
    const diff = figureDiff(EMISSIONS_CONTRADICTION.a.sentence, EMISSIONS_CONTRADICTION.b.sentence)!;
    expect(formatFigureDiff(diff)).toBe('7 pts');
  });

  it('labels an entirely unit-less figure "pts" instead of a naked number', () => {
    const diff = figureDiff('Headcount was 1580', 'Headcount was 1240')!;
    expect(formatFigureDiff(diff)).toBe('340 pts');
  });
});
