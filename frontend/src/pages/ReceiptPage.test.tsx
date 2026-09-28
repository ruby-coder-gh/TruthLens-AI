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

  it('shows a network-error state for any other failure', async () => {
    mockGet.mockRejectedValue(new Error('boom'));

    renderPage();

    expect(await screen.findByText(/could not load this receipt/i)).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
  });
});
