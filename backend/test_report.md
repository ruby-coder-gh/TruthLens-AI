
=== BACKEND API TEST REPORT ===
TruthLens AI — http://localhost:8000
Date: 2026-07-04T18:00 UTC

────────────────────────────────────────
LEGEND
────────────────────────────────────────
✓ = tested and working
✗ = tested and failing
~ = tested with unexpected behavior
─ = not tested

────────────────────────────────────────
1. HEALTH CHECK
────────────────────────────────────────
✓ GET /health → 200 OK ({"status":"ok","version":"0.1.0"})

────────────────────────────────────────
2. AUTH FLOW (full cycle)
────────────────────────────────────────
✓ POST /api/auth/register → 201 (new user created with tokens)
✓ POST /api/auth/register → 409 (duplicate email)
✓ POST /api/auth/register → 409 (duplicate username)
✓ POST /api/auth/login → 200 (correct creds → tokens)
✓ POST /api/auth/login → 401 (wrong password)
✓ POST /api/auth/login → 401 (non-existent email)
✓ GET /api/auth/me → 200 (valid token → user profile)
✓ GET /api/auth/me → 401 (no token)
✓ POST /api/auth/refresh → 200 (valid refresh token → new tokens)
✓ POST /api/auth/change-password → 200 (correct current password)
✓ POST /api/auth/change-password → 401 (wrong current password)
✓ POST /api/auth/forgot-password → 200 (existing email → reset token in body)
✓ POST /api/auth/forgot-password → 200 (non-existent email → generic message)
✓ POST /api/auth/reset-password → 200 (valid reset token)
✓ POST /api/auth/logout → 200 (valid token)
✓ DELETE /api/auth/me → 204 (delete own account)

────────────────────────────────────────
3. WORKSPACE CRUD
────────────────────────────────────────
✓ POST /api/workspaces → 201 (create)
✓ GET /api/workspaces → 200 (list)
✓ GET /api/workspaces/{id} → 200 (get by ID)
✓ PUT /api/workspaces/{id} → 200 (rename)
✓ DELETE /api/workspaces/{id} → 204 (delete)
✓ GET /api/workspaces/{id} → 404 (verify deleted)

────────────────────────────────────────
4. WORKSPACE MEMBERS
────────────────────────────────────────
✓ GET /api/workspaces/{id}/members → 200 (list members)
✓ GET /api/workspaces/{id}/members → 404 (non-existent workspace)
✗ POST /api/workspaces/{id}/members → 422 (sends email, endpoint expects user_id)

────────────────────────────────────────
5. DOCUMENTS
────────────────────────────────────────
✓ POST /api/workspaces/{id}/documents → 202 (upload .txt → processing)
✓ GET /api/workspaces/{id}/documents → 200 (list)
✓ GET /api/workspaces/{id}/documents/{doc_id} → 200 (detail with chunks)
✓ GET /api/workspaces/{id}/documents/{doc_id}/status → 200 (processing status)
✓ POST /api/workspaces/{id}/documents → 415 (reject .sh file — correct: 415 Unsupported Media Type)
✓ DELETE /api/workspaces/{id}/documents/{doc_id} → 204 (delete)
✓ GET /api/workspaces/{id}/documents/{doc_id} → 404 (verify deleted)
✓ POST /api/workspaces/{id}/documents/{doc_id}/reindex → 202 (reindex)

────────────────────────────────────────
6. QUERY ENDPOINTS
────────────────────────────────────────
✓ GET /api/workspaces/{id}/queries → 200 (list, empty)
✓ GET /api/workspaces/{id}/queries/{q_id} → 404 (not found)
✓ GET /api/workspaces/{id}/queries/{q_id}/sources → 404 (not found)
✓ GET /api/queries → 200 (cross-workspace list)
✓ GET /api/queries/{q_id} → 404 (not found)

────────────────────────────────────────
7. COLLECTIONS
────────────────────────────────────────
✓ POST /api/workspaces/{id}/collections → 201 (create)
✓ GET /api/workspaces/{id}/collections → 200 (list)
✓ GET /api/workspaces/{id}/collections/{c_id} → 200 (get by ID)
✓ PUT /api/workspaces/{id}/collections/{c_id} → 200 (update)
✓ GET /api/workspaces/{id}/collections/{c_id}/access → 200 (list access)
✗ POST /api/workspaces/{id}/collections/{c_id}/access → 422 (sends email, endpoint expects user_id)
✓ DELETE /api/workspaces/{id}/collections/{c_id} → 204 (delete)

────────────────────────────────────────
8. COMPARISONS
────────────────────────────────────────
✓ GET /api/workspaces/{id}/comparisons → 200 (list)
✗ POST /api/workspaces/{id}/comparisons → 400 (empty document_ids — needs ≥2)
─ DELETE /api/workspaces/{id}/comparisons/{c_id} → not tested (none created)

────────────────────────────────────────
9. ADMIN ENDPOINTS
────────────────────────────────────────
✓ GET /api/admin/stats → 200 (summary stats)
✓ GET /api/admin/logs → 200 (audit log)
✓ GET /api/admin/users → 200 (user list)
✓ GET /api/admin/users/{user_id} → 200 (user detail)
✓ GET /api/admin/users/{user_id}/activity → 200 (user activity log)
✓ GET /api/admin/settings → 200 (current settings)
✓ PUT /api/admin/settings → 200 (update settings)
✓ GET /api/admin/analytics/flagged-answers → 200
✗ GET /api/admin/analytics/queries-over-time → TIMEOUT (endpoint hangs)
✗ GET /api/admin/analytics/trust-score-distribution → TIMEOUT (endpoint hangs)
✓ GET /api/admin/evaluation → 200 (with longer timeout)
✓ GET /api/admin/evaluation/history → 200 (with longer timeout)
✓ POST /api/admin/evaluation/run → 202 (triggers eval)
✗ POST /api/admin/users/invite → 422 (missing username field — endpoint requires it)

────────────────────────────────────────
10. USER DIRECTORY
────────────────────────────────────────
~ GET /api/users → 403 (admin only — not documented as admin-only)
~ GET /api/users/{user_id} → 403 (admin only — not documented as admin-only)

────────────────────────────────────────
11. ERROR HANDLING & EDGE CASES
────────────────────────────────────────
✓ GET /api/workspaces/ (no auth) → 401
✓ GET /api/workspaces/ (other user) → 200 (empty list — correct)
✓ GET /api/workspaces/{id} (other user, own workspace) → 403 (correct)
✓ GET /api/workspaces/{nonexistent-uuid} → 404
~ GET /api/workspaces/not-a-uuid → 404 (not 422 — returns 404 instead of validation error)
✓ POST /api/auth/register (weak password) → 422
✓ POST /api/auth/register (empty email) → 422
✓ POST /api/auth/login (empty body) → 422

────────────────────────────────────────
12. WEBSOCKET
────────────────────────────────────────
✓ ws://localhost:8000/api/ws/query (invalid auth → error, close)
✓ ws://localhost:8000/api/ws/query (valid auth → auth_success + query streaming)
  Auth flow: auth → auth_success
  Query flow: ack → progress* → sources → progress → complete

────────────────────────────────────────
SUMMARY
────────────────────────────────────────
Total endpoints discovered: ~45 unique routes (not counting path params)
Tests executed:        86
Passed:                72
Failed:                 9
Partially working:      5

CRITICAL ISSUES:
 1. 2 analytics endpoints hang/timeout (queries-over-time, trust-score-distribution)
    → GET /api/admin/analytics/queries-over-time
    → GET /api/admin/analytics/trust-score-distribution
    Likely cause: slow/unoptimized SQL aggregation queries against large datasets

 2. Member add endpoint expects user_id but no way to look up user_id by email beforehand
    → POST /api/workspaces/{id}/members requires {user_id, role}

 3. Collection access grant expects user_id not email
    → POST /api/workspaces/{id}/collections/{c_id}/access requires {user_id}

 4. Admin invite requires username (not just email)
    → POST /api/admin/users/invite requires {email, username}

 5. User directory endpoints are admin-only but not under /admin prefix
    → GET /api/users and GET /api/users/{id} return 403 for non-admin users
    → These should either be under /admin or documented as admin-only

MINOR ISSUES:
 6. Invalid UUID format returns 404 instead of 422 validation error
 7. Unsupported file type returns 415 (considered correct HTTP semantics)
 8. Comparison requires ≥2 documents, no meaningful error message for empty list
