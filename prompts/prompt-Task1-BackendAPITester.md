# Task 1: BACKEND API TESTER — TruthLens AI

## Mission
Comprehensively test ALL API endpoints on the running FastAPI backend. Report every success and failure with full response data.

## Environment
- **Backend URL**: http://localhost:8000
- **API Prefix**: `/api`
- **API Docs (OpenAPI)**: http://localhost:8000/docs
- **Health Check**: GET http://localhost:8000/health
- **DB**: SQLite at `./data/truthlens.db`
- **Ollama**: localhost:11434 (for query pipeline)

## Known State
- Existing users in DB: `test@test.com`, `demo@truthlens.ai`, `admin@truthlens.ai` — passwords UNKNOWN
- `/api/auth/register` returns 409 CONFLICT for existing emails/usernames
- `/api/auth/login` returns 401 "Invalid email or password" for wrong creds
- JWT access tokens expire in 30 min, refresh tokens in 7 days

## Auth Strategy
1. Try registering a NEW unique user (email: `test-{timestamp}@test.com`, username: `tester-{timestamp}`, password: `TestPass123!`)
2. Use that user's tokens for all subsequent authenticated tests
3. Store tokens: `access_token` in auth header, `refresh_token` for refresh tests
4. If register fails, try brute-force a known user or report the issue

## Endpoint Test Plan

### 1. Health Check
```
GET /health
→ Expect: 200, {"status": "ok", "version": "0.1.0"}
```

### 2. Auth Flow (Full Cycle)
```
POST /api/auth/register  → 201 + tokens  (new user)
POST /api/auth/login     → 200 + tokens  (same new user, correct password)
POST /api/auth/login     → 401            (wrong password)
POST /api/auth/login     → 401            (non-existent email)
GET  /api/auth/me        → 200 + user    (with valid token)
GET  /api/auth/me        → 401            (no token)
POST /api/auth/refresh   → 200 + new tokens (with valid refresh token)
POST /api/auth/change-password → 200      (correct current pwd)
POST /api/auth/change-password → 401      (wrong current pwd)
POST /api/auth/logout    → 200            (with valid token)
POST /api/auth/forgot-password → 200      (for existing email)
POST /api/auth/forgot-password → 200      (for non-existent email — should still return 200)
POST /api/auth/reset-password → 200       (with valid reset token)
DELETE /api/auth/me      → 204            (delete own account)
```

### 3. Workspace CRUD
```
POST /api/workspaces     → 201 + workspace  (create "Test Workspace")
GET  /api/workspaces     → 200 + list        (list user's workspaces)
GET  /api/workspaces/{id} → 200 + workspace  (get by ID)
PUT  /api/workspaces/{id} → 200 + workspace  (rename it)
DELETE /api/workspaces/{id} → 204             (delete it)
GET  /api/workspaces/{id} → 404              (deleted workspace)
```

### 4. Workspace Members
```
GET  /api/workspaces/{id}/members → 200 + list  (members, at least owner)
Test 404 for non-existent workspace
```

### 5. Document Upload & Management
```
POST /api/workspaces/{ws_id}/documents → 202 + doc  (upload a small .txt file)
GET  /api/workspaces/{ws_id}/documents → 200 + list
GET  /api/workspaces/{ws_id}/documents/{doc_id} → 200 + detail (poll until status=ready)
GET  /api/workspaces/{ws_id}/documents/{doc_id}/status → 200
GET  /api/documents → 200 + list (cross-workspace)
DELETE /api/workspaces/{ws_id}/documents/{doc_id} → 204
POST upload -> should reject unsupported file type (e.g. .exe)
POST upload -> should reject oversized file (simulate with large payload)
```

### 6. Query Endpoints (requires documents ingested)
```
GET  /api/workspaces/{ws_id}/queries → 200 + list
GET  /api/queries → 200 + list (cross-workspace)
GET  /api/queries/{q_id} → 200 + detail
GET  /api/workspaces/{ws_id}/queries/{q_id} → 200 + detail
GET  /api/workspaces/{ws_id}/queries/{q_id}/sources → 200 + list
DELETE /api/workspaces/{ws_id}/queries/{q_id} → 204
```

### 7. Feedback API
```
POST /api/queries/{q_id}/feedback → 201 + feedback ({rating: 5, comment: "Great"})
GET  /api/queries/{q_id}/feedback → 200 + list
```

### 8. Comparison API
```
POST /api/workspaces/{ws_id}/comparisons → 202 + comparison_id
GET  /api/workspaces/{ws_id}/comparisons → 200 + list
GET  /api/workspaces/{ws_id}/comparisons/{c_id} → 200 + detail
DELETE /api/workspaces/{ws_id}/comparisons/{c_id} → 204
```

### 9. Admin Endpoints (if admin creds found)
```
GET  /api/admin/stats → 200
GET  /api/admin/logs → 200
GET  /api/admin/users → 200
GET  /api/admin/users/{id} → 200 + detail
PUT  /api/admin/users/{id}/role → 200
PUT  /api/admin/users/{id}/status → 200
POST /api/admin/users/invite → 201
GET  /api/admin/users/{id}/activity → 200
GET  /api/admin/analytics/flagged-answers → 200
GET  /api/admin/analytics/queries-over-time → 200
GET  /api/admin/analytics/trust-score-distribution → 200
GET  /api/admin/evaluation → 200
POST /api/admin/evaluation/run → 202
GET  /api/admin/evaluation/history → 200
GET  /api/admin/settings → 200
PUT  /api/admin/settings → 200
DELETE /api/admin/users/{id} → 204 (test on the user you created)
```

### 10. Error Handling & Edge Cases
```
- Access workspace you don't own → 403
- Access non-existent resource → 404
- Duplicate resource creation → 409
- Unauthorized (no token) → 401
- Invalid input (empty string, negative page) → 422
- Rate limiting test: spam login rapidly → 429
- Large file upload rejection → 413
- Unsupported file type → 422
```

## WebSocket Test
```
ws://localhost:8000/ws/query
1. Connect and send {"type": "auth", "token": "<access_token>"}
   → Expect: {"type": "auth_success"}
2. Send {"type": "query", "payload": {"workspace_id": "<id>", "query": "test", "top_k": 3}}
   → Expect event stream: ack → progress → sources → guardrail → trust_score → complete
3. Test invalid auth: send wrong token → expect error + close

ws://localhost:8000/ws/compare
1. Auth same as above
2. Send {"type": "compare", "payload": {"workspace_id": "<id>", "query": "compare X and Y", "document_ids": ["id1", "id2"], "top_k": 3}}
   → Expect: ack → progress → doc_result(s) → synthesis → trust_score → complete
```

## Reporting Format
For EVERY endpoint test, output:
```
[PASS|FAIL] HTTP {METHOD} {path}
  → Status: {code}
  → Response: {truncated JSON}
  → Notes: {anything unexpected}
```

At end, produce summary:
```
=== BACKEND TEST SUMMARY ===
Total tests: N
Passed:     N
Failed:     N
Broken endpoints: [list]
Issues found: [list any crashes, 500s, wrong status codes, schema mismatches]
```
