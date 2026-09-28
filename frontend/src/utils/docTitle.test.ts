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

  it('leaves a name alone when no separator-terminated prefix is shared by all siblings', () => {
    // CORPUS[1] has no " — " (it uses a different construction), so no
    // prefix is common to all three — every title keeps its full text.
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
});
