import { useEffect, useRef } from 'react';

interface TextPassageProps {
  contextBefore?: string | null;
  content: string;
  contextAfter?: string | null;
  /** K2: character offsets of the cited span within `content` — when given,
   *  only that span is marked (BUG-17); otherwise the whole content is, same
   *  as before `text=` locate existed. */
  highlight?: { start: number; end: number } | null;
}

/** Text-mode fallback: surrounding context (muted) around the matched
 *  passage (highlighted `<mark>`), scrolled into view on mount. Used both
 *  for non-PDF documents and as the PDF-load-failure fallback. */
export function TextPassage({ contextBefore, content, contextAfter, highlight }: TextPassageProps) {
  const markRef = useRef<HTMLElement>(null);

  useEffect(() => {
    markRef.current?.scrollIntoView({ block: 'center' });
  }, [content, highlight]);

  const validSpan =
    highlight != null && highlight.start >= 0 && highlight.end > highlight.start && highlight.end <= content.length;

  return (
    <div className="whitespace-pre-wrap p-5 text-sm leading-relaxed text-text-muted">
      {contextBefore && <span className="text-text-dim">{contextBefore} </span>}
      {validSpan ? (
        <>
          <span>{content.slice(0, highlight.start)}</span>
          <mark ref={markRef} className="evidence-mark evidence-mark-sweep text-text">
            {content.slice(highlight.start, highlight.end)}
          </mark>
          <span>{content.slice(highlight.end)}</span>
        </>
      ) : (
        <mark ref={markRef} className="evidence-mark evidence-mark-sweep text-text">
          {content}
        </mark>
      )}
      {contextAfter && <span className="text-text-dim"> {contextAfter}</span>}
    </div>
  );
}
