// Owning lane: L8 (Viewer FE). This scaffold only stores the requested
// target — the slide-over drawer (PDF.js canvas + highlight rects, page nav,
// text mode) is L8's to build.
//
// Plan spec names this single file as the import path for both the provider
// and the hook, unlike the split context/hook-file convention used elsewhere
// (auth-context.ts, theme-context.ts) — disabling react-refresh's
// single-component-export rule here is deliberate, not an oversight.
/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { SourceViewerDrawer } from '../components/source-viewer/SourceViewerDrawer';

export interface SourceTarget {
  workspaceId: string;
  documentId: string;
  chunkId: string;
  documentName?: string;
  pageNumber?: number | null;
}

interface SourceViewerContextValue {
  open: (target: SourceTarget) => void;
  close: () => void;
  target: SourceTarget | null;
}

const SourceViewerContext = createContext<SourceViewerContextValue | null>(null);

export function SourceViewerProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<SourceTarget | null>(null);

  const open = useCallback((next: SourceTarget) => setTarget(next), []);
  const close = useCallback(() => setTarget(null), []);

  const value = useMemo<SourceViewerContextValue>(() => ({ open, close, target }), [open, close, target]);

  return (
    <SourceViewerContext.Provider value={value}>
      {children}
      <SourceViewerDrawer target={target} onClose={close} />
    </SourceViewerContext.Provider>
  );
}

export function useSourceViewer(): SourceViewerContextValue {
  const ctx = useContext(SourceViewerContext);
  if (!ctx) {
    throw new Error('useSourceViewer must be used within a SourceViewerProvider');
  }
  return ctx;
}
