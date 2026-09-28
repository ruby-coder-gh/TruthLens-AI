import { describe, it, expect } from 'vitest';
import { citedSourceIndices } from './citedSources';
import type { Claim } from '../../api/types';

function claim(sourceIndex: number | null): Claim {
  return {
    text: 't', start: 0, end: 1, verdict: 'supported', entailment: 0.9, contradiction: 0.01,
    source_index: sourceIndex, chunk_id: null, document_id: null, document_name: null, page_number: null, evidence: null,
  };
}

describe('citedSourceIndices', () => {
  it('collects source_index from claims', () => {
    expect(citedSourceIndices('answer text', [claim(1), claim(2)])).toEqual(new Set([1, 2]));
  });

  it('also picks up bare [source:N] markers not covered by a claim', () => {
    expect(citedSourceIndices('see [source:3] for detail', [claim(1)])).toEqual(new Set([1, 3]));
  });

  it('returns an empty set for an answer with no citations and no claims', () => {
    expect(citedSourceIndices('no citations here', null)).toEqual(new Set());
  });
});
