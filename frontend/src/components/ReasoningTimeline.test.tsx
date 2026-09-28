import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReasoningTimeline } from './ReasoningTimeline';
import type { InvestigationReasoningStep, InvestigationSubQuestion } from '../api/types';

const step: InvestigationReasoningStep = {
  phase: 'investigate',
  title: 'Investigate revenue',
  description: 'Retrieved and checked the revenue figure.',
  details: {},
};

const subQuestion: InvestigationSubQuestion = {
  id: 'sq-1',
  question: 'What was 2025 revenue?',
  partial_answer: '**Revenue** was €412 million [source:2], per the annual report.',
  citations: [{ chunk_id: 'c1', text: 'Revenue in 2025 was €412 million.' }],
};

describe('ReasoningTimeline', () => {
  it('renders a sub-answer as markdown with stripped citation markers, not raw text (BUG-10)', async () => {
    const user = userEvent.setup();
    render(<ReasoningTimeline trace={[step]} subQuestions={[subQuestion]} />);

    await user.click(screen.getByRole('button', { name: /investigate revenue/i }));

    // Real markdown: "Revenue" is bold, not the literal "**Revenue**".
    expect(screen.getByText('Revenue').tagName).toBe('STRONG');
    // Citation reads as the ledger's bracketed form, not the raw marker.
    expect(screen.getByText(/€412 million \[2\], per the annual report\./)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\*\*/);
    expect(document.body.textContent).not.toMatch(/\[source:\d+\]/i);
  });
});
