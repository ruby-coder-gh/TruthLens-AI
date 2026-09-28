import { describe, it, expect } from 'vitest';
import { stepStatus } from './AuditTrail';

describe('stepStatus', () => {
  it('marks every step pending before the first progress frame', () => {
    expect(stepStatus('search', null, false, false)).toBe('pending');
    expect(stepStatus('verify', null, false, false)).toBe('pending');
  });

  it('marks earlier phases done and the current phase active', () => {
    expect(stepStatus('search', 'ranking', false, false)).toBe('done');
    expect(stepStatus('rank', 'ranking', false, false)).toBe('active');
    expect(stepStatus('write', 'ranking', false, false)).toBe('pending');
  });

  it('marks verify done the instant claims land, regardless of the last progress phase', () => {
    // Backend never emits a "verify" progress frame — the guardrail frame
    // arriving *is* the done signal.
    expect(stepStatus('verify', 'guardrail', true, false)).toBe('done');
  });

  it('marks the in-flight step stopped when the run was cancelled', () => {
    expect(stepStatus('write', 'generation', false, true)).toBe('stopped');
    // A step that never started stays pending even after a stop.
    expect(stepStatus('verify', 'generation', false, true)).toBe('pending');
  });
});
