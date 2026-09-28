import { describe, it, expect, vi, beforeAll } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/utils';
import ReceiptPage from './ReceiptPage';
import type { ReceiptView } from '../api/types';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock('../api/client', () => ({
  receiptApi: { get: mockGet },
}));

beforeAll(async () => {
  // jsdom's Crypto implementation doesn't always ship SubtleCrypto — fall
  // back to Node's webcrypto so the seal-verification effect has something
  // to call. (No-op in environments — like this one — that already have it.)
  if (!globalThis.crypto?.subtle) {
    const { webcrypto } = await import('node:crypto');
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  }
});

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function makePayload(): ReceiptView['payload'] {
  return {
    version: '1',
    question: 'What is the termination notice period in the MSA?',
    answer: 'Ninety (90) days written notice is required. [source:1]',
    claims: [
      {
        text: 'Ninety (90) days written notice is required.',
        start: 0,
        end: 44,
        verdict: 'supported',
        entailment: 0.95,
        contradiction: 0.01,
        source_index: 1,
        chunk_id: 'c1',
        document_id: 'd1',
        document_name: 'Vendor MSA.pdf',
        page_number: 14,
        evidence: 'Either party may terminate on ninety (90) days written notice.',
      },
    ],
    sources: [
      {
        index: 1,
        document_name: 'Vendor MSA.pdf',
        page_number: 14,
        excerpt: 'Either party may terminate on ninety (90) days written notice.',
        content_sha256: 'abc123def456abc123def456abc123def456abc123def456abc123def45600',
      },
    ],
    trust: { score: 0.93, components: { grounding: 0.96, coverage: 0.8 } },
    guardrail: { passed: true, score: 0.96 },
    model_used: 'qwen3:4b',
    prompt_version: 'a91f3c2e4b7d',
    workspace_name: 'Q3 Compliance Review',
    asked_at: '2026-09-02T12:34:00Z',
    issued_at: '2026-09-02T12:35:00Z',
    issuer: 'truthlens-local',
  };
}

async function makeView(overrides: Partial<ReceiptView> = {}): Promise<ReceiptView> {
  const payload = overrides.payload ?? makePayload();
  const canonical = JSON.stringify(payload);
  const seal = overrides.seal ?? (await sha256Hex(canonical));
  return {
    payload,
    canonical,
    seal,
    seal_valid: true,
    signature_valid: true,
    issued_at: payload.issued_at,
    revoked: false,
    ...overrides,
  };
}

function apiError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function renderPage(token = 'tok_test1234567890') {
  return renderWithProviders(
    <Routes>
      <Route path="/r/:token" element={<ReceiptPage />} />
    </Routes>,
    { route: `/r/${token}` },
  );
}

describe('ReceiptPage', () => {
  it('verifies the seal in the browser when the recomputed hash matches and the signature is valid', async () => {
    const view = await makeView();
    mockGet.mockResolvedValue(view);

    renderPage();

    expect(await screen.findByText(/seal intact — verified in your browser/i)).toBeInTheDocument();
    expect(screen.getByText(view.payload.question)).toBeInTheDocument();
  });

  it('shows a tampered warning when the recomputed hash does not match the seal', async () => {
    const view = await makeView({ seal: '0'.repeat(64) });
    mockGet.mockResolvedValue(view);

    renderPage();

    expect(await screen.findByText(/tampered or not issued here/i)).toBeInTheDocument();
  });

  it('shows a tampered warning when the seal matches but the signature is invalid', async () => {
    const view = await makeView({ signature_valid: false });
    mockGet.mockResolvedValue(view);

    renderPage();

    expect(await screen.findByText(/tampered or not issued here/i)).toBeInTheDocument();
    expect(screen.getByText(/signature could not be verified/i)).toBeInTheDocument();
  });

  it('shows a revoked state for a 410 response', async () => {
    mockGet.mockRejectedValue(apiError('Gone', 410));

    renderPage();

    expect(await screen.findByText(/receipt revoked/i)).toBeInTheDocument();
  });

  it('shows a revoked state when the payload itself reports revoked', async () => {
    const view = await makeView({ revoked: true });
    mockGet.mockResolvedValue(view);

    renderPage();

    expect(await screen.findByText(/receipt revoked/i)).toBeInTheDocument();
  });

  it('shows a not-found state for a 404 response', async () => {
    mockGet.mockRejectedValue(apiError('Not Found', 404));

    renderPage();

    expect(await screen.findByText(/receipt not found/i)).toBeInTheDocument();
  });

  // BUG-47 regression: status screens (bogus/revoked/errored link) must not
  // be a dead end — brand + a way back to the app.
  it('gives every status screen a brand header and a home link (BUG-47)', async () => {
    mockGet.mockRejectedValue(apiError('Not Found', 404));

    renderPage();

    expect(await screen.findByText(/receipt not found/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^truthlens home$/i })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /go to truthlens home/i })).toHaveAttribute('href', '/');
  });

  it('shows a network-error state for any other failure', async () => {
    mockGet.mockRejectedValue(new Error('boom'));

    renderPage();

    expect(await screen.findByText(/could not load this receipt/i)).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  // BUG-4/BUG-9 regression: citations must stay inline with the sentence
  // they belong to (one paragraph, not one block per segment) and no raw
  // `[source:N]` marker text may leak into the rendered page.
  it('renders inline citations without splitting the sentence into separate paragraphs or leaking raw markers', async () => {
    const payload = makePayload();
    payload.answer =
      'Revenue grew to €412M in 2025 [source:1]. However, the prior estimate was €398M [source:2].';
    payload.sources = [
      ...payload.sources,
      {
        index: 2,
        document_name: 'Press Release.pdf',
        page_number: 1,
        excerpt: 'Analysts had projected €398M for the period.',
        content_sha256: 'def456abc123def456abc123def456abc123def456abc123def456abc12300',
      },
    ];
    const view = await makeView({ payload });
    mockGet.mockResolvedValue(view);

    renderPage();

    await screen.findByText(view.payload.question);

    // No raw marker text anywhere on the page.
    expect(document.body.textContent).not.toMatch(/\[source:\d+\]/i);

    // Both citations render as jump links to their source, inline — not as
    // their own paragraph/block.
    const link1 = screen.getByRole('link', { name: /jump to source 1/i });
    const link2 = screen.getByRole('link', { name: /jump to source 2/i });
    expect(link1.closest('p')).not.toBeNull();
    expect(link1.closest('p')).toBe(link2.closest('p'));

    // The sentence around each citation — including the period right after
    // it — stays in the same paragraph (no orphan-period block).
    const paragraph = link1.closest('p');
    expect(paragraph?.textContent).toContain('Revenue grew to €412M in 2025');
    expect(paragraph?.textContent).toContain('However, the prior estimate was €398M');
  });

  // ─── R2-16 ──────────────────────────────────────────────────────────────

  it('uses the same verdict label as the chat Claim Ledger ("Verified", not "Supported")', async () => {
    const view = await makeView();
    mockGet.mockResolvedValue(view);

    renderPage();

    expect(await screen.findByText('Verified')).toBeInTheDocument();
    expect(screen.queryByText('Supported')).not.toBeInTheDocument();
  });

  it('drops "Verified" from the header when the guardrail failed', async () => {
    const payload = { ...makePayload(), guardrail: { passed: false, score: 0.3 } };
    const view = await makeView({ payload });
    mockGet.mockResolvedValue(view);

    renderPage();

    await screen.findByText(view.payload.question);
    expect(screen.getByText('Unverified Answer Receipt')).toBeInTheDocument();
    expect(screen.queryByText('Verified Answer Receipt')).not.toBeInTheDocument();
    expect(screen.getByText(/guardrail failed/i)).toBeInTheDocument();
  });

  it('keeps "Verified Answer Receipt" when the guardrail passed', async () => {
    const view = await makeView();
    mockGet.mockResolvedValue(view);

    renderPage();

    expect(await screen.findByText('Verified Answer Receipt')).toBeInTheDocument();
  });

  const revenueConflict = {
    a: { document_name: 'Annual Report 2025', page_number: 1, sentence: 'Revenue in 2025 was €412 million.' },
    b: { document_name: 'Q4 2025 Press Release', page_number: 1, sentence: 'Revenue in 2025 was €398 million.' },
    score: 0.9,
  };

  it('shows the K5 conflicts a reader would otherwise never learn about', async () => {
    const base = makePayload();
    const payload = {
      ...base,
      // A claim that's actually about the disputed figure, not just any
      // claim in the answer (R3-6 — see the "unrelated" test below).
      claims: [
        ...base.claims,
        { text: 'The letter states full-year revenue of €412 million.', start: 0, end: 0, verdict: 'supported' as const, entailment: 0.9, contradiction: 0.01, source_index: 1, chunk_id: 'c2', document_id: 'ar', document_name: 'Annual Report 2025', page_number: 1, evidence: 'Full-year revenue reached €412 million for the period.' },
      ],
      conflicts: [revenueConflict],
    };
    const view = await makeView({ payload });
    mockGet.mockResolvedValue(view);

    renderPage();

    expect(await screen.findByText(/sources disagree/i)).toBeInTheDocument();
    expect(screen.getByText(/Revenue in 2025 was €412 million\./)).toBeInTheDocument();
    expect(screen.getByText(/Revenue in 2025 was €398 million\./)).toBeInTheDocument();
    expect(screen.getByText(/€14M/)).toBeInTheDocument();
  });

  it('renders no conflicts section when the answer has none', async () => {
    const view = await makeView();
    mockGet.mockResolvedValue(view);

    renderPage();

    await screen.findByText(view.payload.question);
    expect(screen.queryByText(/sources disagree/i)).not.toBeInTheDocument();
  });

  // R3-6/BUG-R3-6: `open_conflicts_for_chunks` returns every open
  // contradiction touching a cited chunk, not just the ones this answer's
  // claims are actually about — a receipt whose only claim is the notice
  // period must not tell a public reader the (unrelated) revenue figures
  // disagree.
  it('hides a conflict none of the receipt claims are actually about (R3-6)', async () => {
    const payload = { ...makePayload(), conflicts: [revenueConflict] };
    const view = await makeView({ payload });
    mockGet.mockResolvedValue(view);

    renderPage();

    await screen.findByText(view.payload.question);
    expect(screen.queryByText(/sources disagree/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Revenue in 2025 was €412 million\./)).not.toBeInTheDocument();
  });
});
