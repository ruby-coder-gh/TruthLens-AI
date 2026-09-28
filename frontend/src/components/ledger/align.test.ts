import { describe, it, expect } from 'vitest';
import { alignTokens } from './align';

describe('alignTokens', () => {
  it('matches every word shared with the evidence sentence', () => {
    const tokens = alignTokens(
      'Growth came from a full year of the Kestrel Ridge onshore expansion.',
      'Revenue growth was driven by a full year of contribution from the Kestrel Ridge onshore expansion.',
    );
    const kestrel = tokens.find((t) => t.text === 'Kestrel');
    expect(kestrel?.matched).toBe(true);
  });

  it('flags a claim word the evidence never said', () => {
    const tokens = alignTokens(
      'Growth came mainly from a full year of the Kestrel Ridge onshore expansion.',
      'Revenue growth was driven by a full year of contribution from the Kestrel Ridge onshore expansion.',
    );
    const mainly = tokens.find((t) => t.text === 'mainly');
    expect(mainly?.matched).toBe(false);
  });

  it('is case-insensitive', () => {
    const tokens = alignTokens('REVENUE was strong', 'revenue grew');
    expect(tokens.find((t) => t.text === 'REVENUE')?.matched).toBe(true);
  });

  it('preserves punctuation and whitespace as non-word tokens', () => {
    const tokens = alignTokens('€412 million, up 12%.', '€412 million was reported.');
    expect(tokens.some((t) => !t.isWord && t.text === ', ')).toBe(true);
  });
});
