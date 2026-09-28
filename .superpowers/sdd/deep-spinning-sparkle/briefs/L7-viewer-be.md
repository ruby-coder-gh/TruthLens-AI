# L7 — Source viewer backend

Owned: `backend/app/api/documents.py` (two new routes only — lane L5 adds a small post-ingest hook in the same file; don't touch
`process_document_background`), optional helper module `backend/app/ingestion/locate.py`, tests.

Facts: files saved at `settings.upload_path / doc.filename`; Document has `original_filename`, `mime_type`; SQLite `Chunk` has
`id, document_id, index, content` but NO page; Chroma metadata has `page_number` (id `f"{document_id}:{index}"`,
`get_workspace_collection(ws)`); `check_workspace_access_or_admin` dep (core/deps.py:139); security middleware sets
`X-Frame-Options: DENY` (frontend uses pdf.js fetch, so fine).

Build:
1. `GET /api/workspaces/{wid}/documents/{doc_id}/file` — access_or_admin; doc must belong to workspace; file must exist (404 otherwise).
   `FileResponse` inline. `Content-Disposition: inline; filename*=UTF-8''<quoted original_filename>`, `Cache-Control: private, max-age=300`,
   `X-Content-Type-Options: nosniff`. Serve md/csv/json/txt as `text/plain; charset=utf-8` (never HTML) to avoid stored XSS;
   pdf as `application/pdf`; docx as its mime.
2. `GET /api/workspaces/{wid}/documents/{doc_id}/chunks/{chunk_id}/locate` — access_or_admin; chunk must belong to doc.
   - PDF: page from Chroma metadata (fallback: search every page). Open with PyMuPDF in `asyncio.to_thread`. Split chunk content into
     fragments (sentences; long sentences into ~10-word windows); `page.search_for(fragment)` → collect rects; if none, try first/last
     6 words; merge overlapping line rects; cap 200. Return `{mode:"pdf", page_number, page_count, page_width, page_height,
     rects:[[x0,y0,x1,y1]] (PDF points, top-left origin), content, context_before:null, context_after:null}`.
     If the chunk spans onto the next page (no hits on page), also try page+1 and report the page where hits were found.
   - Non-PDF: `{mode:"text", page_number:null, page_count:null, page_width:null, page_height:null, rects:[], content,
     context_before: prev chunk last 600 chars | null, context_after: next chunk first 600 chars | null}`.
   - File missing → still return text mode from chunk content (don't 500).
3. Response schemas in `schemas/document.py` (additive).

Tests: build a 2-page PDF with fitz in the test, Document + Chunk rows, monkeypatch the Chroma page lookup → locate returns correct
page + non-empty rects inside page bounds; fallback page search; text mode with neighbours; file endpoint content-type for pdf/md,
headers, 404 missing file, wrong workspace 404, non-member 403/404 (match existing convention).
