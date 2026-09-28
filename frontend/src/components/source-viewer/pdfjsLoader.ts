import type * as PdfJsModule from 'pdfjs-dist';

// pdfjs-dist is a large parser (~1MB) — fetched, and its worker pointed at
// the bundled worker asset, only the first time the viewer actually needs
// to render a PDF page, not on every app load (bundle-dynamic-imports).
let loadPromise: Promise<typeof PdfJsModule> | null = null;

export function loadPdfJs(): Promise<typeof PdfJsModule> {
  if (!loadPromise) {
    loadPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }
  return loadPromise;
}
