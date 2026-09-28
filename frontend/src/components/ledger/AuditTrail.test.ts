import { describe, it, expect } from 'vitest';
import { stepStatus, effectivePhaseFor, auditSummary, type StepStatus } from './AuditTrail';

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

describe('effectivePhaseFor', () => {
  it('treats a finished, verified answer as having reached the last phase even with no progress history (BUG-50: cached replay)', () => {
    expect(effectivePhaseFor(null, false, false, true)).toBe('guardrail');
  });

  it('leaves the phase alone while running, stopped, or not yet verified', () => {
    expect(effectivePhaseFor('ranking', true, false, false)).toBe('ranking');
    expect(effectivePhaseFor('generation', false, true, false)).toBe('generation');
    expect(effectivePhaseFor(null, false, false, false)).toBeNull();
  });
});

describe('auditSummary', () => {
  it('names the step being stopped mid-way instead of just the count before it (BUG-50)', () => {
    const statuses: StepStatus[] = ['done', 'done', 'stopped', 'pending'];
    expect(auditSummary(statuses, false, true, 0)).toBe('Stopped during step 3 of 4');
  });

  it('falls back to a done-count when the run was stopped before any step became active', () => {
    const statuses: StepStatus[] = ['pending', 'pending', 'pending', 'pending'];
    expect(auditSummary(statuses, false, true, 0)).toBe('Stopped after 0 of 4 steps');
  });

  it('reports all 4 steps for a finished, verified answer (BUG-50: cached replay used to show "1 steps")', () => {
    const statuses: StepStatus[] = ['done', 'done', 'done', 'done'];
    expect(auditSummary(statuses, false, false, 1234)).toBe('4 steps, 1.2 s');
  });

  it('shows the live elapsed clock while running', () => {
    const statuses: StepStatus[] = ['active', 'pending', 'pending', 'pending'];
    expect(auditSummary(statuses, true, false, 2500)).toBe('2.5 s elapsed');
  });
});
