import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { rectToViewportBox, type OverlayBox } from './geometry';

interface PdfViewerProps {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  /** Backend rects for the *target* chunk — only drawn while viewing the
   *  page they belong to (`isTargetPage`); prev/next just shows page content. */
  highlightRects: ReadonlyArray<readonly [number, number, number, number]>;
  isTargetPage: boolean;
  onRenderError: (message: string) => void;
}

/** Renders one PDF page to a devicePixelRatio-aware canvas, with the
 *  matched-passage rects overlaid as absolutely-positioned boxes (not drawn
 *  onto the canvas itself, so they stay crisp and hit-testable). */
export function PdfViewer({ pdfDoc, pageNumber, scale, highlightRects, isTargetPage, onRenderError }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const firstBoxRef = useRef<HTMLDivElement>(null);
  const scrolledPageRef = useRef<number | null>(null);
  const [boxes, setBoxes] = useState<OverlayBox[]>([]);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    let cancelled = false;
    let renderTask: RenderTask | null = null;

    (async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) return;

        const dpr = window.devicePixelRatio || 1;
        const cssViewport = page.getViewport({ scale });
        const outputViewport = page.getViewport({ scale: scale * dpr });
        const canvas = canvasRef.current;
        if (!canvas) return;

        canvas.width = outputViewport.width;
        canvas.height = outputViewport.height;
        canvas.style.width = `${cssViewport.width}px`;
        canvas.style.height = `${cssViewport.height}px`;

        renderTask = page.render({ canvas, viewport: outputViewport });
        await renderTask.promise;
        if (cancelled) return;

        setPageSize({ width: cssViewport.width, height: cssViewport.height });
        setBoxes(isTargetPage ? highlightRects.map((rect) => rectToViewportBox(rect, cssViewport)) : []);
      } catch (err) {
        if (!cancelled) onRenderError(err instanceof Error ? err.message : 'Failed to render this page.');
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
    // highlightRects/onRenderError are stable-enough per open; page/scale/doc are the real triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfDoc, pageNumber, scale, isTargetPage]);

  // Scroll the first highlight into view once per page landing, not on every zoom tick.
  useEffect(() => {
    if (boxes.length > 0 && scrolledPageRef.current !== pageNumber) {
      scrolledPageRef.current = pageNumber;
      firstBoxRef.current?.scrollIntoView({ block: 'center' });
    }
  }, [boxes, pageNumber]);

  return (
    <div
      className="relative"
      style={pageSize ? { width: pageSize.width, height: pageSize.height } : undefined}
    >
      <canvas ref={canvasRef} className="block rounded-control border border-border" />
      {boxes.map((box, i) => (
        <motion.div
          key={i}
          ref={i === 0 ? firstBoxRef : undefined}
          data-testid="source-highlight"
          className="pointer-events-none absolute rounded-sm border-2 border-primary bg-primary/25"
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          initial={{ opacity: reduceMotion ? 1 : 0.25 }}
          animate={{ opacity: 1 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.6, repeat: 3, repeatType: 'reverse', ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}
