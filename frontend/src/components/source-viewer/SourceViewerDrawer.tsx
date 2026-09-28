import { useEffect, useRef, useState, type RefObject } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  FileWarning,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Button, EmptyState, Skeleton } from '../ui';
import { documentApi } from '../../api/client';
import type { ChunkLocation } from '../../api/types';
import type { SourceTarget } from '../../context/SourceViewerContext';
import { loadPdfJs } from './pdfjsLoader';
import { PdfViewer } from './PdfViewer';
import { TextPassage } from './TextPassage';

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const DEFAULT_SCALE = 1.15;
const ZOOM_STEP = 0.25;

// BUG-17 / C1: `documentApi.locate` (api/client.ts) doesn't take the `text`
// query param C1 adds to the locate endpoint, and this lane's edits to
// api/client.ts are scoped to the receipts-list unwrap only (see
// FIX-round1.md). So the "highlight one cited sentence" request is made
// directly here, against the same endpoint and auth convention
// (credentials: 'include'), falling back to `documentApi.locate` (whole
// chunk) whenever there's no highlight text. Once client.ts grows first-class
// `text` support this local call can be dropped in favor of it.
const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function locateChunk(
  workspaceId: string,
  documentId: string,
  chunkId: string,
  highlightText: string | undefined,
): Promise<ChunkLocation> {
  if (!highlightText) return documentApi.locate(workspaceId, documentId, chunkId);

  const url = `${API_BASE}/workspaces/${workspaceId}/documents/${documentId}/chunks/${chunkId}/locate?text=${encodeURIComponent(highlightText)}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    let message = `Failed to locate this passage (${res.status}).`;
    try {
      const body: unknown = await res.json();
      if (body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string') {
        message = body.detail;
      }
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    throw new Error(message);
  }
  return res.json() as Promise<ChunkLocation>;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

type PdfCache = Map<string, PDFDocumentProxy>;

interface SourceViewerPanelContentProps {
  target: SourceTarget;
  onClose: () => void;
  pdfCacheRef: RefObject<PdfCache>;
}

/**
 * Owns the fetch/render state for a single open target. Mounted fresh (via a
 * `key` on the target's identity, see `SourceViewerDrawer`) every time a new
 * source is opened, so every piece of per-open state — `location`, `page`,
 * `scale`, `pdfDoc` — simply starts at its correct initial value instead of
 * being reset by hand from a previous open.
 */
function SourceViewerPanelContent({ target, onClose, pdfCacheRef }: SourceViewerPanelContentProps) {
  const [location, setLocation] = useState<ChunkLocation | null>(null);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [page, setPage] = useState<number | null>(null);
  const [scale, setScale] = useState(DEFAULT_SCALE);

  // Fetch the chunk's location once, on mount. Passes `highlightText` (C1) so
  // the backend returns rects for just the cited sentence instead of the
  // whole chunk (BUG-17).
  useEffect(() => {
    let cancelled = false;
    locateChunk(target.workspaceId, target.documentId, target.chunkId, target.highlightText)
      .then((result) => {
        if (cancelled) return;
        setLocation(result);
        setPage(result.page_number ?? 1);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setLocateError(err.message || 'This passage could not be located.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target.workspaceId, target.documentId, target.chunkId, target.highlightText]);

  // Once locate resolves to PDF mode, reuse a cached document or lazy-load
  // pdf.js and open it. The cache lookup happens here (inside the effect),
  // not during render, since refs are only safe to read outside render.
  useEffect(() => {
    if (!location || location.mode !== 'pdf') return;
    let cancelled = false;
    (async () => {
      try {
        const cached = pdfCacheRef.current.get(target.documentId);
        if (cached) {
          if (!cancelled) setPdfDoc(cached);
          return;
        }
        const pdfjs = await loadPdfJs();
        const doc = await pdfjs.getDocument({
          url: documentApi.fileUrl(target.workspaceId, target.documentId),
          withCredentials: true,
        }).promise;
        if (cancelled) return;
        pdfCacheRef.current.set(target.documentId, doc);
        setPdfDoc(doc);
      } catch (err) {
        if (!cancelled) setPdfError(err instanceof Error ? err.message : 'Failed to load the PDF.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location, target.documentId, target.workspaceId, pdfCacheRef]);

  const pageCount = location?.page_count ?? null;
  const displayMode: 'pdf' | 'text' | null = !location ? null : location.mode === 'pdf' && !pdfError ? 'pdf' : 'text';
  const canGoPrev = page !== null && page > 1;
  const canGoNext = page !== null && pageCount !== null && page < pageCount;
  const title = target.documentName || 'Source document';

  return (
    <>
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-text">{title}</p>
          {displayMode === 'pdf' && page !== null && (
            <p className="text-xs text-text-dim">
              Page {page}
              {pageCount ? ` / ${pageCount}` : ''}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {displayMode === 'pdf' && (
            <>
              <Button size="sm" variant="ghost" aria-label="Previous page" disabled={!canGoPrev} onClick={() => setPage((p) => (p && p > 1 ? p - 1 : p))}>
                <ChevronLeft size={14} />
              </Button>
              <Button size="sm" variant="ghost" aria-label="Next page" disabled={!canGoNext} onClick={() => setPage((p) => (p && pageCount && p < pageCount ? p + 1 : p))}>
                <ChevronRight size={14} />
              </Button>
              <Button size="sm" variant="ghost" aria-label="Zoom out" disabled={scale <= MIN_SCALE} onClick={() => setScale((s) => Math.max(MIN_SCALE, +(s - ZOOM_STEP).toFixed(2)))}>
                <ZoomOut size={14} />
              </Button>
              <Button size="sm" variant="ghost" aria-label="Zoom in" disabled={scale >= MAX_SCALE} onClick={() => setScale((s) => Math.min(MAX_SCALE, +(s + ZOOM_STEP).toFixed(2)))}>
                <ZoomIn size={14} />
              </Button>
            </>
          )}
          <a
            href={documentApi.fileUrl(target.workspaceId, target.documentId)}
            download
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-text-muted transition-colors hover:bg-card-2 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <Download size={13} /> Download original
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close source viewer"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-text-muted transition-colors hover:bg-card-2 hover:text-text"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="space-y-3 p-5">
            <Skeleton height={20} width="60%" />
            <Skeleton height={480} />
          </div>
        )}

        {!loading && locateError && (
          <EmptyState icon={<AlertTriangle size={22} />} title="Source unavailable" description={locateError} className="m-5" />
        )}

        {!loading && !locateError && location && displayMode === 'text' && (
          <>
            {location.mode === 'pdf' && pdfError && (
              <div className="mx-5 mt-4 flex items-center gap-2 rounded-control border border-orange/30 bg-orange/10 px-3 py-2 text-xs text-orange">
                <FileWarning size={14} /> Couldn&apos;t render the PDF page — showing the matched text instead.
              </div>
            )}
            <TextPassage contextBefore={location.context_before} content={location.content} contextAfter={location.context_after} highlight={location.highlight} />
          </>
        )}

        {!loading && !locateError && location && displayMode === 'pdf' && pdfDoc && page !== null && (
          <div className="flex justify-center p-5">
            <PdfViewer
              pdfDoc={pdfDoc}
              pageNumber={page}
              scale={scale}
              highlightRects={location.rects}
              pageHeight={location.page_height ?? 0}
              isTargetPage={page === location.page_number}
              onRenderError={setPdfError}
            />
          </div>
        )}

        {!loading && !locateError && location && displayMode === 'pdf' && !pdfDoc && !pdfError && (
          <div className="p-5">
            <Skeleton height={480} />
          </div>
        )}
      </div>
    </>
  );
}

interface SourceViewerDrawerProps {
  target: SourceTarget | null;
  onClose: () => void;
}

/** Right-side slide-over: PDF.js canvas + pulsing highlight, page nav, zoom,
 *  download; falls back to a highlighted text passage for non-PDF documents
 *  or when the PDF itself fails to load/render. */
export function SourceViewerDrawer({ target, onClose }: SourceViewerDrawerProps) {
  // Keyed by documentId, lives as long as this component does (mounted once
  // by SourceViewerProvider) — reopening the same document skips the PDF.js
  // load+parse round-trip.
  const pdfCacheRef = useRef<PdfCache>(new Map());
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const targetKey = target ? `${target.workspaceId}:${target.documentId}:${target.chunkId}` : null;

  // Esc to close.
  useEffect(() => {
    if (!target) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [target, onClose]);

  // Focus trap + return-focus (mirrors ui.tsx's Modal; kept local since this
  // drawer lives outside ui.tsx's ownership).
  useEffect(() => {
    if (!target) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusFirst = () => {
      const focusable = panel?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      (focusable && focusable.length > 0 ? focusable[0] : panel)?.focus();
    };
    const raf = requestAnimationFrame(focusFirst);

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !panelRef.current.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !panelRef.current.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleTab);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', handleTab);
      previouslyFocusedRef.current?.focus?.();
      previouslyFocusedRef.current = null;
    };
  }, [target]);

  return (
    <AnimatePresence>
      {target && (
        <motion.div
          initial={{ opacity: 0.99 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0.99 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex justify-end"
        >
          <motion.div
            className="absolute inset-0 bg-black/45 backdrop-blur-[6px]"
            onClick={onClose}
            aria-hidden="true"
            initial={{ opacity: 0.99 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0.99 }}
          />

          <motion.div
            ref={panelRef}
            tabIndex={-1}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300, mass: 0.8 }}
            className="relative z-10 flex h-full w-full flex-col border-l border-border bg-solid shadow-e3 focus:outline-none md:w-[720px]"
            role="dialog"
            aria-modal="true"
            aria-label={`Source: ${target.documentName || 'Source document'}`}
          >
            <SourceViewerPanelContent key={targetKey} target={target} onClose={onClose} pdfCacheRef={pdfCacheRef} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
