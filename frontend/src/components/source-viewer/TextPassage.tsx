import { useEffect, useRef } from 'react';

interface TextPassageProps {
  contextBefore?: string | null;
  content: string;
  contextAfter?: string | null;
}

/** Text-mode fallback: surrounding context (muted) around the matched
 *  passage (highlighted `<mark>`), scrolled into view on mount. Used both
 *  for non-PDF documents and as the PDF-load-failure fallback. */
export function TextPassage({ contextBefore, content, contextAfter }: TextPassageProps) {
  const markRef = useRef<HTMLElement>(null);

  useEffect(() => {
    markRef.current?.scrollIntoView({ block: 'center' });
  }, [content]);

  return (
    <div className="whitespace-pre-wrap p-5 text-sm leading-relaxed text-text-muted">
      {contextBefore && <span className="text-text-dim">{contextBefore} </span>}
      <mark ref={markRef} className="evidence-mark evidence-mark-sweep text-text">
        {content}
      </mark>
      {contextAfter && <span className="text-text-dim"> {contextAfter}</span>}
    </div>
  );
}
