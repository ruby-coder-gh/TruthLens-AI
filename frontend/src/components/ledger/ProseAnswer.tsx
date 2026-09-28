// Claim Ledger (Lane D1) — "Read as prose": the answer's own natural-language
// flow, with clickable citation chips and (once verified) a small verdict
// icon after each claim. This is also the live streaming surface — the
// answer always streams as prose, then settles into the Claim Ledger once
// `guardrail.claims` arrive (design brief item 3).
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSourceViewer } from '../../context/SourceViewerContext';
import type { Claim, Source } from '../../api/types';
import { VERDICT_META, type LedgerVerdict } from './verdict';

function CitationChip({ index, source, workspaceId }: { index: number; source: Source | undefined; workspaceId?: string }) {
  const { open: openViewer } = useSourceViewer();
  if (!source) {
    return <sup className="footnote-ref !text-text-dim" title="Source unavailable">{index}</sup>;
  }
  return (
    <button
      type="button"
      onClick={() =>
        workspaceId &&
        openViewer({
          workspaceId,
          documentId: source.document_id,
          chunkId: source.chunk_id,
          documentName: source.document_name,
          pageNumber: source.page_number,
        })
      }
      aria-label={`Open source ${index}${source.document_name ? `, ${source.document_name}` : ''}`}
      className="inline rounded-sm align-baseline hover:brightness-125 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
    >
      <sup className="footnote-ref">{index}</sup>
    </button>
  );
}

const CITE_HREF_RE = /^#cite-(\d+)$/;

// R2-20: the streaming caret used to be a sibling *after* the whole
// <ReactMarkdown> block, so it always started a new line below the last
// paragraph instead of sitting at the end of the text. Appending this
// sentinel image markdown puts it inside the last paragraph's own inline
// content instead — the `img` component override below swaps it for the
// real blinking caret span.
const CARET_HREF = '#tl-caret';
const CARET_MARKDOWN = `![](${CARET_HREF})`;

function StreamingCaret() {
  return (
    <motion.span
      className="ml-0.5 inline-block h-4 w-[3px] rounded-sm bg-primary-soft align-text-bottom"
      animate={{ opacity: [1, 0.3, 1] }}
      transition={{ repeat: Infinity, duration: 0.8, ease: 'easeInOut' }}
    />
  );
}

// R3-5: claim verdict icons used the same trick as BUG-4/R2-20 above in
// reverse — the old "claims present" branch skipped ReactMarkdown entirely
// (plain-text offset splicing into one `<p>`), so a bulleted list in the
// answer rendered as literal `- item` dashes collapsed onto a single line
// instead of an actual `<ul>`. Encoding each claim's end offset as the same
// kind of zero-width sentinel image (`#verdict-N-verdict`) lets the *whole*
// answer make one ReactMarkdown pass — lists, paragraphs, everything — with
// the verdict icon landing inline at the right character offset either way.
const VERDICT_HREF_RE = /^#verdict-(\d+)-([a-z]+)$/;

function VerdictIcon({ verdict }: { verdict: LedgerVerdict }) {
  const meta = VERDICT_META[verdict];
  const Icon = meta.icon;
  return (
    <>
      <Icon size={12} className={clsx('mx-0.5 inline align-baseline', meta.textClass)} aria-hidden="true" />
      <span className="sr-only">({meta.label.toLowerCase()})</span>
    </>
  );
}

/** Splices a `![](#verdict-N-verdict)` sentinel right after each claim's own
 * span, working back-to-front so earlier insertions never shift the offsets
 * later claims were computed against. */
function encodeClaimVerdicts(content: string, claims: Array<{ claim: Claim; index: number }>): string {
  let result = content;
  for (let i = claims.length - 1; i >= 0; i--) {
    const { claim, index } = claims[i];
    result = `${result.slice(0, claim.end)}![](#verdict-${index}-${claim.verdict})${result.slice(claim.end)}`;
  }
  return result;
}

/** Turns a raw `[source:N]` marker into standard markdown link syntax
 * (`[N](#cite-N)`) so a *single* ReactMarkdown parse renders it as an inline
 * element within its sentence's own paragraph — BUG-4's root cause was the
 * opposite approach (splitting the text on the marker and feeding each
 * fragment to its own `<ReactMarkdown>`, which wraps every fragment in a
 * block `<p>`, so the citation — and the punctuation right after it — landed
 * on its own line with an orphan period). */
function encodeCitationLinks(text: string): string {
  return text.replace(/\[source:(\d+)\]/gi, (_m, n: string) => `[${n}](#cite-${n})`);
}

/** ReactMarkdown's `a` renderer: a `#cite-N` href (from `encodeCitationLinks`)
 * renders the citation chip inline; anything else is a normal link. */
function citationAwareLink(sources: Source[], workspaceId: string | undefined) {
  return function CiteLink({ href }: AnchorHTMLAttributes<HTMLAnchorElement>): ReactNode {
    const m = href ? CITE_HREF_RE.exec(href) : null;
    if (!m) return <a href={href} target="_blank" rel="noreferrer">{href}</a>;
    const idx = parseInt(m[1], 10);
    return <CitationChip index={idx} source={sources[idx - 1]} workspaceId={workspaceId} />;
  };
}

/** ReactMarkdown's `img` renderer: the streaming caret and every claim's
 * verdict-icon sentinel both ride in as zero-width images (see
 * `CARET_MARKDOWN` / `encodeClaimVerdicts`) so they land inline at the exact
 * offset they were spliced at, through the same single markdown parse as
 * everything else — a real image would never point at one of these hrefs. */
function sentinelImage({ src }: { src?: string }): ReactNode {
  if (src === CARET_HREF) return <StreamingCaret />;
  const m = src ? VERDICT_HREF_RE.exec(src) : null;
  if (m) return <VerdictIcon verdict={m[2] as LedgerVerdict} />;
  return null;
}

// R3-5: list/heading/paragraph structure needs explicit classes on both
// branches below — Tailwind's preflight strips default `<ul>`/`<ol>` marker
// and spacing styles, same reasoning as `reportMarkdownComponents` in
// InvestigationPage.tsx.
function markdownComponents(sources: Source[], workspaceId: string | undefined) {
  return {
    a: citationAwareLink(sources, workspaceId),
    img: sentinelImage,
    ul: ({ children }: { children?: ReactNode }) => <ul className="ml-5 list-disc space-y-1">{children}</ul>,
    ol: ({ children }: { children?: ReactNode }) => <ol className="ml-5 list-decimal space-y-1">{children}</ol>,
  };
}

export interface ProseAnswerProps {
  content: string;
  sources: Source[];
  /** Present once the guardrail frame lands; absent/empty while streaming or when the answer had no claims. */
  claims?: Claim[] | null;
  workspaceId?: string;
  /** Shows a blinking caret at the end (mid-stream). */
  streaming?: boolean;
}

export function ProseAnswer({ content, sources, claims, workspaceId, streaming = false }: ProseAnswerProps) {
  const claimList = claims ?? [];

  // Non-overlapping, in-bounds claims only (offset-based, matching the
  // guardrail's char offsets into the raw answer text) — same filter as
  // before, now used to splice verdict sentinels instead of slicing spans.
  const placed = claimList
    .map((claim, index) => ({ claim, index }))
    .filter(({ claim }) => claim.start >= 0 && claim.end > claim.start && claim.end <= content.length)
    .sort((a, b) => a.claim.start - b.claim.start);
  const nonOverlapping: typeof placed = [];
  let boundary = 0;
  for (const item of placed) {
    if (item.claim.start >= boundary) {
      nonOverlapping.push(item);
      boundary = item.claim.end;
    }
  }

  // One ReactMarkdown pass over the *whole* answer, claims or not (BUG-4,
  // R2-20, R3-5) — lists, headings and paragraphs all parse correctly
  // instead of the old claims-present branch's plain-text-in-one-`<p>`
  // fallback, which flattened a bulleted list onto a single line.
  const withVerdicts = encodeClaimVerdicts(content, nonOverlapping);
  const displayContent = streaming && claimList.length === 0 ? `${withVerdicts}${CARET_MARKDOWN}` : withVerdicts;

  return (
    <div className="prose-answer text-[15px] leading-7 text-text">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents(sources, workspaceId)}>
        {encodeCitationLinks(displayContent)}
      </ReactMarkdown>
    </div>
  );
}
