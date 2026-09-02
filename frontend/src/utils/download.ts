/**
 * Trigger a browser download for an in-memory Blob.
 *
 * Creates a temporary object URL, "clicks" a detached `<a download>` anchor,
 * then revokes the URL. Shared by every export flow that receives a
 * `{ blob, filename }` pair from the API client's bespoke-fetch endpoints
 * (e.g. `queryApi.exportMarkdown`, `investigationApi.exportAuditBundle`,
 * `adminApi.exportUsage`, `adminApi.exportLogs`) as well as flows that build
 * a Blob from local content (e.g. `ReportBuilderWizard`'s Markdown export).
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
