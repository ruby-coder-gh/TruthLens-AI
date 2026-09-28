// Owning lane: L4 (Receipt FE). Public "Ledger and Seal" view — no Layout, no
// auth required. Renders against `receiptApi.get(token)` and re-derives the
// seal client-side via WebCrypto so "verified" is never just the server's word.
import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { clsx } from 'clsx';
import {
  ShieldCheck,
  ShieldAlert,
  Loader2,
  Printer,
  Copy,
  FileX,
  Ban,
  WifiOff,
  FileText,
  Hash,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
} from 'lucide-react';
import { Card, Badge, Button, Skeleton, EmptyState, ProgressBar, type BadgeColor } from '../components/ui';
import { useToast } from '../components/toast-context';
import { pageTransition } from '../components/motion';
import Logo from '../components/Logo';
import { QrCode } from '../components/receipt/QrCode';
import { TrustGauge } from '../components/receipt/TrustGauge';
import { receiptApi } from '../api/client';
import type { ReceiptView, ClaimVerdict } from '../api/types';

type PageState = 'loading' | 'loaded' | 'not_found' | 'revoked' | 'error';

const VERDICT_META: Record<ClaimVerdict, { label: string; color: BadgeColor; Icon: ComponentType<{ size?: number }> }> = {
  supported: { label: 'Supported', color: 'green', Icon: CheckCircle2 },
  partial: { label: 'Partially supported', color: 'orange', Icon: AlertTriangle },
  unsupported: { label: 'Unsupported', color: 'gray', Icon: HelpCircle },
  contradicted: { label: 'Contradicted', color: 'red', Icon: XCircle },
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Backend cites sources inline as literal `[source:N]` markers (1-indexed).
 * On this static page a citation is a plain in-page anchor to the sources
 * list below — no hover card, no live retrieval, just #source-N.
 *
 * The whole answer renders through a *single* `ReactMarkdown` pass: markers
 * are rewritten to markdown links first, so citations stay inline with the
 * surrounding sentence. The previous approach split the text on each marker
 * and rendered every segment in its own `<ReactMarkdown>`, which produced a
 * block-level `<p>` per segment — every citation landed on its own line and
 * left orphan periods behind (BUG-4), and a marker sitting at a segment
 * boundary could render on its own with nothing to visually tie it to the
 * sentence it belonged to (BUG-9). */
function renderAnswer(answer: string, sourceCount: number) {
  const withCitationLinks = answer.replace(/\[source:(\d+)\]/gi, (_match, numStr: string) => {
    const n = parseInt(numStr, 10);
    return n >= 1 && n <= sourceCount ? `[${n}](#source-${n})` : `[${n}](#unavailable)`;
  });
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) =>
          href === '#unavailable' ? (
            <sup className="footnote-ref !text-text-dim" title="Source unavailable">
              {children}
            </sup>
          ) : (
            <a href={href} aria-label={`Jump to source ${children}`}>
              <sup className="footnote-ref">{children}</sup>
            </a>
          ),
      }}
    >
      {withCitationLinks}
    </ReactMarkdown>
  );
}

// BUG-47: these dead-end status screens (bogus/revoked/errored receipt
// links) previously had no brand and no way back into the app — a visitor
// who lands here from a stale or bogus link is stuck. Every status screen
// now carries the same brand header as the loaded receipt and a link home.
function ReceiptStatusScreen({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-6 bg-bg px-4">
      <div className="bg-grid" />
      <Link to="/" className="relative z-10 flex items-center gap-2.5" aria-label="TruthLens home">
        <Logo size={26} className="text-primary" />
        <span className="text-[17px] font-semibold tracking-[-0.01em] text-text">TruthLens</span>
      </Link>
      <div className="relative z-10 w-full max-w-md">
        <Card className="p-2">
          <EmptyState icon={icon} title={title} description={description} />
        </Card>
        <div className="mt-4 text-center">
          <Link to="/" className="text-[13px] font-medium text-primary-soft hover:underline">
            Go to TruthLens home
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ReceiptPage() {
  const { token } = useParams<{ token: string }>();
  const { addToast } = useToast();
  // Lazily seeded so the "no token" case never has to reset state from
  // inside an effect — a missing token is a render-time fact, not an async one.
  const [state, setState] = useState<PageState>(() => (token ? 'loading' : 'not_found'));
  const [data, setData] = useState<ReceiptView | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sealMatches, setSealMatches] = useState<boolean | null>(null);
  // Starts true: the only moment `data` exists but hasn't been hash-checked
  // yet is the instant it arrives, so "verifying" is the correct first paint.
  const [verifying, setVerifying] = useState(true);

  // Fetch the receipt.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    receiptApi
      .get(token)
      .then((view) => {
        if (cancelled) return;
        if (view.revoked) {
          setState('revoked');
          return;
        }
        setData(view);
        setState('loaded');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const status = (err as { status?: number } | undefined)?.status;
        if (status === 404) setState('not_found');
        else if (status === 410) setState('revoked');
        else {
          setErrorMessage(err instanceof Error ? err.message : 'A network error occurred.');
          setState('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Re-derive the seal client-side — "verified" is never just the server's word.
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    sha256Hex(data.canonical)
      .then((hex) => {
        if (!cancelled) setSealMatches(hex === data.seal);
      })
      .catch(() => {
        if (!cancelled) setSealMatches(null);
      })
      .finally(() => {
        if (!cancelled) setVerifying(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data]);

  useEffect(() => {
    document.title =
      state === 'loaded' && data ? `Truth Receipt — ${data.payload.question.slice(0, 60)}` : 'Truth Receipt — TruthLens';
  }, [state, data]);

  const handleCopy = useCallback(
    async (text: string, successMessage: string) => {
      try {
        await navigator.clipboard.writeText(text);
        addToast(successMessage, 'success');
      } catch {
        addToast('Could not copy to clipboard', 'error');
      }
    },
    [addToast],
  );

  if (state === 'loading') {
    return (
      <div className="relative min-h-screen bg-bg px-4 py-14">
        <div className="bg-grid" />
        <div className="relative z-10 mx-auto w-full max-w-3xl space-y-4">
          <Skeleton height={26} width={220} />
          <Skeleton height={110} />
          <Skeleton height={200} />
          <Skeleton height={140} />
        </div>
      </div>
    );
  }

  if (state === 'not_found') {
    return (
      <ReceiptStatusScreen
        icon={<FileX size={26} />}
        title="Receipt not found"
        description="This link doesn't match a sealed receipt. It may be mistyped, or it may never have existed."
      />
    );
  }

  if (state === 'revoked') {
    return (
      <ReceiptStatusScreen
        icon={<Ban size={26} />}
        title="Receipt revoked"
        description="Whoever sealed this answer has revoked public access to it."
      />
    );
  }

  if (state === 'error' || !data) {
    return (
      <ReceiptStatusScreen
        icon={<WifiOff size={26} />}
        title="Could not load this receipt"
        description={errorMessage ?? 'A network error occurred. Please try again.'}
      />
    );
  }

  const { payload, seal, signature_valid, issued_at } = data;
  const verified = sealMatches === true && signature_valid;
  const sourceCount = payload.sources.length;
  const pageUrl = typeof window !== 'undefined' ? window.location.href : '';
  const trustComponents = payload.trust.components ? Object.entries(payload.trust.components) : [];

  return (
    <div className="relative min-h-screen bg-bg px-4 py-10 sm:py-14 print:px-0 print:py-6">
      <div className="bg-grid" />

      <motion.div
        className="relative z-10 mx-auto w-full max-w-3xl space-y-5 print:max-w-none print:space-y-4"
        variants={pageTransition}
        initial="initial"
        animate="animate"
      >
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-3 break-inside-avoid">
          <div className="flex items-center gap-2.5">
            <Logo size={26} className="text-primary" />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-dim">Verified Answer Receipt</p>
              <p className="text-[17px] font-semibold tracking-[-0.01em] text-text">TruthLens</p>
            </div>
          </div>
          <Button variant="secondary" size="sm" className="print:hidden" onClick={() => window.print()}>
            <Printer size={14} /> Download PDF
          </Button>
        </header>

        {/* Verification banner */}
        <Card
          className={clsx(
            'flex items-start gap-3 p-4 break-inside-avoid',
            verifying ? '' : verified ? 'border-green/30 bg-green/8' : 'border-red/35 bg-red/10',
          )}
        >
          {verifying ? (
            <Loader2 size={20} className="mt-0.5 shrink-0 animate-spin text-text-dim" />
          ) : verified ? (
            <ShieldCheck size={20} className="mt-0.5 shrink-0 text-green" />
          ) : (
            <ShieldAlert size={20} className="mt-0.5 shrink-0 text-red" />
          )}
          <div className="min-w-0 space-y-1">
            <p className={clsx('text-[14px] font-semibold', verifying ? 'text-text' : verified ? 'text-green' : 'text-red')}>
              {verifying ? 'Verifying seal in your browser…' : verified ? 'Seal intact — verified in your browser' : 'Tampered or not issued here'}
            </p>
            {!verifying && (
              <p className="text-[12px] leading-relaxed text-text-muted">
                {verified
                  ? 'Issued by this TruthLens instance. The content below matches its cryptographic seal exactly.'
                  : sealMatches === false
                    ? "This page's content, hashed in your browser, doesn't match the seal on record — it may have been altered after issuance."
                    : 'The content matches its seal, but the signature could not be verified as issued by this TruthLens instance.'}
              </p>
            )}
          </div>
        </Card>

        {/* Question + Answer */}
        <Card className="space-y-3 p-5 break-inside-avoid">
          <div className="flex flex-wrap items-center gap-2">
            <Badge color="blue">Question</Badge>
            {payload.guardrail.passed !== null && (
              <Badge color={payload.guardrail.passed ? 'green' : 'red'}>
                Guardrail {payload.guardrail.passed ? 'passed' : 'failed'}
                {payload.guardrail.score !== null ? ` — ${Math.round(payload.guardrail.score * 100)}%` : ''}
              </Badge>
            )}
          </div>
          <p className="text-[16px] font-semibold leading-snug text-text">{payload.question}</p>
          <div className="file-rule" />
          <div className="space-y-2 text-[14px] leading-[1.7] text-text">{renderAnswer(payload.answer, sourceCount)}</div>
        </Card>

        {/* Claim ledger */}
        {payload.claims.length > 0 && (
          <Card className="space-y-3 p-5 break-inside-avoid">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-dim">Claim ledger</p>
            <ul className="space-y-2.5">
              {payload.claims.map((claim, i) => {
                const meta = VERDICT_META[claim.verdict];
                const Icon = meta.Icon;
                return (
                  <li key={i} className="rounded-control border border-border bg-card-2 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge color={meta.color}>
                        <Icon size={11} /> {meta.label}
                      </Badge>
                      {claim.source_index !== null && (
                        <a href={`#source-${claim.source_index}`} className="text-[11px] font-medium text-primary-soft hover:underline">
                          Source {claim.source_index}
                        </a>
                      )}
                      {claim.page_number !== null && <span className="text-[11px] text-text-dim">p. {claim.page_number}</span>}
                    </div>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-text">{claim.text}</p>
                    {claim.evidence && (
                      <p className="font-quote mt-1.5 text-[13px] italic leading-relaxed text-text-muted">&ldquo;{claim.evidence}&rdquo;</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        {/* Trust gauge + components */}
        <Card className="grid gap-5 p-5 break-inside-avoid sm:grid-cols-[auto_1fr]">
          <div className="flex justify-center sm:justify-start">
            <TrustGauge score={payload.trust.score} size={104} />
          </div>
          <div className="space-y-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-dim">Trust components</p>
            {trustComponents.length > 0 ? (
              trustComponents.map(([key, value]) => (
                <ProgressBar key={key} value={value * 100} size="sm" label={key.replace(/_/g, ' ')} />
              ))
            ) : (
              <p className="text-[12px] text-text-dim">No component breakdown recorded.</p>
            )}
          </div>
        </Card>

        {/* Sources */}
        {sourceCount > 0 && (
          <Card className="space-y-3 p-5 break-inside-avoid">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-dim">Cited sources</p>
            <ol className="space-y-3">
              {payload.sources.map((s) => (
                <li key={s.index} id={`source-${s.index}`} className="scroll-mt-20 rounded-control border border-border bg-card-2 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-[12px] font-semibold text-text">
                      <FileText size={13} className="shrink-0 text-text-dim" />
                      <span className="truncate">
                        [{s.index}] {s.document_name}
                      </span>
                      {s.page_number !== null && <span className="shrink-0 font-normal text-text-dim">p. {s.page_number}</span>}
                    </span>
                    <span
                      className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] text-text-dim"
                      title="SHA-256 of this excerpt"
                    >
                      <Hash size={10} /> {s.content_sha256.slice(0, 10)}
                    </span>
                  </div>
                  <p className="font-quote mt-1.5 text-[13px] italic leading-relaxed text-text-muted">&ldquo;{s.excerpt}&rdquo;</p>
                </li>
              ))}
            </ol>
          </Card>
        )}

        {/* Metadata + seal */}
        <Card className="space-y-4 p-5 break-inside-avoid">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[12px] sm:grid-cols-3">
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-text-dim">Workspace</dt>
              <dd className="mt-0.5 truncate font-medium text-text">{payload.workspace_name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-text-dim">Model</dt>
              <dd className="mt-0.5 truncate font-mono text-text">{payload.model_used ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-text-dim">Prompt version</dt>
              <dd className="mt-0.5 truncate font-mono text-text" title={payload.prompt_version ?? undefined}>
                {payload.prompt_version ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-text-dim">Asked</dt>
              <dd className="mt-0.5 text-text">{formatDateTime(payload.asked_at)}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-text-dim">Issued</dt>
              <dd className="mt-0.5 text-text">{formatDateTime(issued_at)}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-text-dim">Issuer</dt>
              <dd className="mt-0.5 truncate text-text" title={payload.issuer}>
                {payload.issuer}
              </dd>
            </div>
          </dl>

          <div className="file-rule" />

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-dim">Seal (SHA-256)</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-text sm:flex-initial">{seal}</code>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="print:hidden"
                  aria-label="Copy seal hash"
                  onClick={() => void handleCopy(seal, 'Seal copied')}
                >
                  <Copy size={12} />
                </Button>
              </div>
            </div>
            <QrCode value={pageUrl} size={92} className="shrink-0" />
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
