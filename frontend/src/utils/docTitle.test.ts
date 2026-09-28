import { describe, it, expect } from 'vitest';
import { shortDocTitle } from './docTitle';

const CORPUS = [
  'Northwind Renewables — Annual Report 2025.pdf',
  'Northwind Renewables Reports Fourth-Quarter and Full-Year 2025 Results.pdf',
  'Northwind Renewables — 2025 Sustainability Report.pdf',
];

describe('shortDocTitle', () => {
  it('strips the extension when there is no sibling list', () => {
    expect(shortDocTitle('Board memo: Aurora update.docx')).toBe('Board memo: Aurora update');
  });

  it('strips a prefix shared by every sibling name', () => {
    const siblings = [CORPUS[0], CORPUS[2]];
    expect(shortDocTitle(CORPUS[0], siblings)).toBe('Annual Report 2025');
    expect(shortDocTitle(CORPUS[2], siblings)).toBe('2025 Sustainability Report');
  });

  it('keeps the full title when stripping the shared prefix would leave no separator (BUG-8 R2)', () => {
    // CORPUS[1] has no " — " after "Northwind Renewables" (it uses a
    // different, verb-first construction) — blindly stripping the shared
    // words left a subject-less fragment, "Reports Fourth-Quarter and
    // Full-Year 2025 Results", that reads like a grammar error. Since there's
    // no separator to cut at, the whole title is kept instead.
    expect(shortDocTitle(CORPUS[1], CORPUS)).toBe(
      'Northwind Renewables Reports Fourth-Quarter and Full-Year 2025 Results',
    );
  });

  it('is a no-op with a single document (nothing to disambiguate)', () => {
    expect(shortDocTitle('Northwind Renewables — Annual Report 2025.pdf', [CORPUS[0]])).toBe(
      'Northwind Renewables — Annual Report 2025',
    );
  });

  it('falls back to a placeholder for an empty name', () => {
    expect(shortDocTitle('')).toBe('Untitled document');
    expect(shortDocTitle(null)).toBe('Untitled document');
    expect(shortDocTitle(undefined)).toBe('Untitled document');
  });

  it('never returns an empty string when a name strips down to only the prefix', () => {
    expect(shortDocTitle('Northwind Renewables — ', CORPUS)).toBe('Northwind Renewables —');
  });

  it('leaves a name with no shared words at all fully alone (real demo corpus, BUG-8)', () => {
    // The full six-document demo manifest: the board memo shares no words
    // with the other five, so it keeps its own full (still distinct) title
    // instead of being mangled by a prefix meant for its siblings.
    const manifest = [
      ...CORPUS.map((n) => n.replace(/\.pdf$/, '')),
      'Board Memorandum: Aurora Offshore Wind Project Update',
      'Northwind Renewables — Leadership Team',
      'Northwind Renewables — Project Pipeline',
    ];
    expect(shortDocTitle(manifest[3], manifest)).toBe('Board Memorandum: Aurora Offshore Wind Project Update');
    expect(shortDocTitle(manifest[4], manifest)).toBe('Leadership Team');
    expect(shortDocTitle(manifest[0], manifest)).toBe('Annual Report 2025');
  });
});
