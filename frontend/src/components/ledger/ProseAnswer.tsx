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
import { VERDICT_META } from './verdict';

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

// ponytail: plain text, not markdown, for text sitting inline beside a claim's
// verdict icon (running full ReactMarkdown there would wrap it in a block
// `<p>`, breaking the inline flow) — same limitation the old Truth Lens
// overlay had while its lens was on. Upgrade to an offset-aware markdown-AST
// walker if bold/italic inside a claim turns out to matter for the demo corpus.
function withCitationsInline(text: string, sources: Source[], workspaceId: string | undefined, keySeed: string): ReactNode {
  const parts = text.split(/(\[source:\d+\])/gi);
  if (parts.length <= 1) return text;
  return parts.map((part, i) => {
    const m = part.match(/\[source:(\d+)\]/i);
    if (!m) return <span key={`${keySeed}-t${i}`}>{part}</span>;
    const idx = parseInt(m[1], 10);
    return <CitationChip key={`${keySeed}-c${i}`} index={idx} source={sources[idx - 1]} workspaceId={workspaceId} />;
  });
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

  // No claims yet (streaming, or an answer that had none) — full markdown
  // with clickable citation chips, same as before Truth Lens existed. One
  // ReactMarkdown pass over the whole answer (BUG-4) keeps citations inline
  // within their own sentence instead of splitting the text into a
  // paragraph-per-fragment.
  if (claimList.length === 0) {
    const displayContent = streaming ? `${content}${CARET_MARKDOWN}` : content;
    return (
      <div className="prose-answer text-[15px] leading-7 text-text">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: citationAwareLink(sources, workspaceId),
            img: ({ src }) => (src === CARET_HREF ? <StreamingCaret /> : null),
          }}
        >
          {encodeCitationLinks(displayContent)}
        </ReactMarkdown>
      </div>
    );
  }

  // Claims present — walk the text once, inserting a small verdict icon
  // right after each claim's own span (offset-based, matches the guardrail's
  // char offsets into the raw answer text).
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

  const nodes: ReactNode[] = [];
  let cursor = 0;
  nonOverlapping.forEach(({ claim, index }, i) => {
    if (claim.start > cursor) {
      nodes.push(<span key={`plain${i}`}>{withCitationsInline(content.slice(cursor, claim.start), sources, workspaceId, `plain${i}`)}</span>);
    }
    const meta = VERDICT_META[claim.verdict];
    const Icon = meta.icon;
    nodes.push(
      <span key={`claim${index}`}>
        {withCitationsInline(content.slice(claim.start, claim.end), sources, workspaceId, `claim${index}`)}
        <Icon size={12} className={clsx('mx-0.5 inline align-baseline', meta.textClass)} aria-hidden="true" />
        <span className="sr-only">({meta.label.toLowerCase()})</span>
      </span>,
    );
    cursor = claim.end;
  });
  if (cursor < content.length) {
    nodes.push(<span key="tail">{withCitationsInline(content.slice(cursor), sources, workspaceId, 'tail')}</span>);
  }

  return <div className="prose-answer text-[15px] leading-7 text-text"><p>{nodes}</p></div>;
}
