# L4 — Truth Receipt frontend

Owned: `frontend/src/components/SealReceiptButton.tsx` (scaffold stub), `frontend/src/pages/ReceiptPage.tsx` (scaffold stub),
new `frontend/src/components/receipt/*`, tests. Uses `receiptApi` from client.ts and the `qrcode` package (already installed).

Build:
1. `SealReceiptButton({queryId})`: button "Seal receipt" (stamp/shield icon). Click → modal:
   - Explain plainly: creates a public link; anyone with it can view the question, answer, claim verdicts and cited excerpts
     (≤1200 chars each) from your documents; you can revoke it anytime.
   - Confirm → `receiptApi.create` → success: full link (`window.location.origin + url_path`), copy button (toast), QR code
     (qrcode → data URL), "Open receipt" (new tab), short seal (first 12 hex).
   - Existing receipts for this query (`listForQuery`) with view counts + Revoke.
   - Error/loading states; Esc closes; focus trap; mobile full-width sheet.
2. `ReceiptPage` (`/r/:token`, public, outside Layout): an official, certificate-like "Verified Answer Receipt"
   (take cues from `artifacts/ui-prototypes/` ledger-and-seal prototype; stay consistent with Grounded Glass tokens).
   - Verification banner: compute `crypto.subtle.digest('SHA-256', TextEncoder(canonical))` hex and compare to `seal` →
     "Seal intact — verified in your browser"; plus `signature_valid` → "Issued by this TruthLens instance".
     Any mismatch → prominent red "Tampered or not issued here".
   - Question, answer (markdown; `[source:N]` → anchors to the source list), claims with verdict chips + evidence,
     trust gauge + components, sources (doc name, page, excerpt, content hash short), metadata (model, prompt version,
     workspace, asked/issued), QR code of this page, seal hash in full (monospace, copyable).
   - "Download PDF" → `window.print()` with `@media print` CSS (hide buttons, white bg, black text, page breaks sane).
   - States: loading skeleton, 404 not found, 410 revoked, network error. Mobile-friendly. `<title>` set.
3. No auth assumptions on ReceiptPage (works logged out, no Layout, no AuthContext requirement beyond what App provides).

Tests: ReceiptPage verified / tampered (seal mismatch) / signature invalid / revoked / not found (mock `receiptApi`; if jsdom lacks
`crypto.subtle`, polyfill from node `webcrypto` in the test). SealReceiptButton: confirm → create → link + QR shown; revoke calls API.
