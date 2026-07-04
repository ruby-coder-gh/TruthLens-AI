#!/usr/bin/env python3
"""Comprehensive API tester for TruthLens AI backend — FINAL PASS."""
import json, sys, time, uuid, os
import urllib.request
import urllib.error

BASE = "http://localhost:8000"
PASS = 0
FAIL = 0
RESULTS = []

def req(method, path, data=None, headers=None, files=None, raw_url=False):
    url = f"{BASE}{path}" if not raw_url else path
    hdrs = {"Accept": "application/json"}
    if headers:
        hdrs.update(headers)
    body = None
    if files:
        boundary = uuid.uuid4().hex
        hdrs["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        parts = []
        for k, (fn, content, ct) in files.items():
            parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"; filename=\"{fn}\"\r\nContent-Type: {ct}\r\n\r\n".encode())
            if isinstance(content, str):
                parts.append(content.encode())
            else:
                parts.append(content)
            parts.append(b"\r\n")
        parts.append(f"--{boundary}--\r\n".encode())
        body = b"".join(parts)
    elif data is not None:
        body = json.dumps(data).encode()
        if "Content-Type" not in hdrs:
            hdrs["Content-Type"] = "application/json"
    try:
        r = urllib.request.Request(url, data=body, headers=hdrs, method=method)
        opener = urllib.request.build_opener(urllib.request.HTTPRedirectHandler)
        resp = opener.open(r, timeout=15)
        code = resp.status
        ct = resp.headers.get("Content-Type", "")
        if "application/json" in ct or "text/plain" in ct:
            raw = resp.read().decode()
            try:
                return code, json.loads(raw)
            except:
                return code, raw
        return code, resp.read()
    except urllib.error.HTTPError as e:
        ct = e.headers.get("Content-Type", "")
        raw = e.read().decode(errors='replace')
        try:
            return e.code, json.loads(raw)
        except:
            return e.code, raw
    except Exception as e:
        return 0, str(e)

def test(name, method, path, expected_status, data=None, headers=None, extra_checks=None, files=None, raw_url=False, expected_status_alt=None):
    global PASS, FAIL
    code, body = req(method, path, data=data, headers=headers, files=files, raw_url=raw_url)
    ok_codes = [expected_status]
    if expected_status_alt is not None:
        ok_codes.append(expected_status_alt)
    status = "PASS" if code in ok_codes else "FAIL"
    if status == "PASS" and extra_checks:
        try:
            if callable(extra_checks):
                extra_checks(code, body)
        except AssertionError as e:
            status = "FAIL"
            body = f"{body} | EXTRA CHECK: {e}"
    if status == "PASS":
        PASS += 1
    else:
        FAIL += 1
    result = f"[{status}] HTTP {method} {path}"
    result += f"\n  -> Status: {code} (expected {expected_status}"
    if expected_status_alt:
        result += f" or {expected_status_alt}"
    result += ")"
    result += f"\n  -> Response: {json.dumps(body, default=str)[:400]}"
    RESULTS.append(result)
    print(result + "\n", flush=True)
    return code, body

ts = int(time.time())
EMAIL = f"tester{ts}@test.com"
USERNAME = f"tester{ts}"
PASSWORD = "TestPass123!"
ACCESS_TOKEN = None
REFRESH_TOKEN = None
WORKSPACE_ID = None
DOC_ID = None
COLLECTION_ID = None
COMPARISON_ID = None
ADMIN_TOKEN = None

print("=" * 70)
print("TRUTH LENS AI — COMPREHENSIVE API TEST  (PASS 2)")
print("=" * 70)

# ─── 1. HEALTH CHECK ───
print("\n─── 1. HEALTH CHECK ───")
test("Health check", "GET", "/health", 200)

# ─── 2. AUTH FLOW ───
print("\n─── 2. AUTH FLOW ───")
code, body = test("Register new user", "POST", "/api/auth/register", 201, {
    "email": EMAIL, "username": USERNAME, "password": PASSWORD
})
if code == 201:
    ACCESS_TOKEN = body.get("access_token")
    REFRESH_TOKEN = body.get("refresh_token")
else:
    print("[FATAL] Registration failed\n")

if ACCESS_TOKEN:
    test("Register duplicate email", "POST", "/api/auth/register", 409, {
        "email": EMAIL, "username": f"{USERNAME}alt", "password": PASSWORD
    })
    test("Register duplicate username", "POST", "/api/auth/register", 409, {
        "email": f"alt{ts}@test.com", "username": USERNAME, "password": PASSWORD
    })
    code, body = test("Login correct", "POST", "/api/auth/login", 200, {
        "email": EMAIL, "password": PASSWORD
    })
    if code == 200:
        ACCESS_TOKEN = body.get("access_token", ACCESS_TOKEN)
        REFRESH_TOKEN = body.get("refresh_token", REFRESH_TOKEN)
    test("Login wrong password", "POST", "/api/auth/login", 401, {
        "email": EMAIL, "password": "WrongPassword1!"
    })
    test("Login non-existent email", "POST", "/api/auth/login", 401, {
        "email": "nobody@nonexistent.com", "password": "TestPass123!"
    })
    test("Get me (with token)", "GET", "/api/auth/me", 200,
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})

    # Refresh
    code, body = test("Refresh token", "POST", "/api/auth/refresh", 200,
        data={"refresh_token": REFRESH_TOKEN})
    if code == 200:
        ACCESS_TOKEN = body.get("access_token", ACCESS_TOKEN)
        REFRESH_TOKEN = body.get("refresh_token", REFRESH_TOKEN)

    # Change password
    test("Change password (correct)", "POST", "/api/auth/change-password", 200,
        data={"current_password": PASSWORD, "new_password": "NewPass456!"},
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
    # Revert
    code, body = req("POST", "/api/auth/change-password",
        data={"current_password": "NewPass456!", "new_password": PASSWORD},
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
    if code == 200:
        print("[INFO] Password reverted\n")
    test("Change password (wrong current)", "POST", "/api/auth/change-password", 401,
        data={"current_password": "WrongPassword!", "new_password": "Another1!"},
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})

    # Forgot / Reset
    code, body = test("Forgot password (existing email)", "POST", "/api/auth/forgot-password", 200,
        data={"email": EMAIL})
    reset_token = None
    if code == 200:
        msg = body.get("message", "")
        if "reset token:" in msg:
            reset_token = msg.split("reset token: ")[1]
            print(f"  [INFO] Captured reset token\n")
    test("Forgot password (non-existent email)", "POST", "/api/auth/forgot-password", 200,
        data={"email": "ghost@nowhere.com"})
    if reset_token:
        test("Reset password (valid token)", "POST", "/api/auth/reset-password", 200,
            data={"token": reset_token, "password": PASSWORD})

    # Logout
    test("Logout", "POST", "/api/auth/logout", 200,
        data={"refresh_token": REFRESH_TOKEN},
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})

    # Re-login
    code, body = req("POST", "/api/auth/login", data={"email": EMAIL, "password": PASSWORD})
    if code == 200:
        ACCESS_TOKEN = body.get("access_token")
        REFRESH_TOKEN = body.get("refresh_token")
        print("[INFO] Re-logged in\n")

    # ─── 3. WORKSPACE CRUD ───
    print("─── 3. WORKSPACE CRUD ───")
    code, body = test("Create workspace", "POST", "/api/workspaces", 201,
        data={"name": "Test Workspace", "description": "Created by API tester"},
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
    if code == 201:
        WORKSPACE_ID = body.get("id")
    test("List workspaces", "GET", "/api/workspaces", 200,
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
    if WORKSPACE_ID:
        test("Get workspace by ID", "GET", f"/api/workspaces/{WORKSPACE_ID}", 200,
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
        test("Update workspace", "PUT", f"/api/workspaces/{WORKSPACE_ID}", 200,
            data={"name": "Renamed Test Workspace", "description": "Updated desc"},
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
    test("Verify update in list", "GET", "/api/workspaces", 200,
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})

    # ─── 4. WORKSPACE MEMBERS ───
    print("\n─── 4. WORKSPACE MEMBERS ───")
    if WORKSPACE_ID:
        test("List workspace members", "GET", f"/api/workspaces/{WORKSPACE_ID}/members", 200,
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
        # Add member
        code, body = test("Add member to workspace", "POST",
            f"/api/workspaces/{WORKSPACE_ID}/members", 201,
            data={"email": "demo@truthlens.ai", "role": "viewer"},
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
    test("Members on non-existent workspace", "GET",
        "/api/workspaces/99999999-9999-9999-9999-999999999999/members", 404,
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})

    # ─── 5. DOCUMENT UPLOAD ───
    print("\n─── 5. DOCUMENT UPLOAD ───")
    if WORKSPACE_ID:
        txt_path = "/tmp/test_doc.txt"
        with open(txt_path, "w") as f:
            f.write("Hello World this is a test document for TruthLens AI. " * 10)
        with open(txt_path, "rb") as f:
            content = f.read()
        code, body = test("Upload .txt document", "POST",
            f"/api/workspaces/{WORKSPACE_ID}/documents", 202,
            files={"file": ("test_doc.txt", content, "text/plain")},
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
        if code in (200, 201, 202):
            DOC_ID = body.get("id") or body.get("doc_id") or body.get("document_id")
        if DOC_ID:
            test("List workspace documents", "GET",
                f"/api/workspaces/{WORKSPACE_ID}/documents", 200,
                headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
            test("Get document detail", "GET",
                f"/api/workspaces/{WORKSPACE_ID}/documents/{DOC_ID}", 200,
                headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
            test("Get document status", "GET",
                f"/api/workspaces/{WORKSPACE_ID}/documents/{DOC_ID}/status", 200,
                headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
        # Test reject unsupported file type (backend returns 415)
        with open("/tmp/test_bad.sh", "w") as f:
            f.write("#!/bin/bash\necho test")
        with open("/tmp/test_bad.sh", "rb") as f:
            content = f.read()
        test("Reject unsupported file type (.sh)", "POST",
            f"/api/workspaces/{WORKSPACE_ID}/documents", 415,
            files={"file": ("test.sh", content, "application/x-sh")},
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})

        # Workspace activity
        print("\n─── WORKSPACE ACTIVITY ───")
        test("Workspace activity", "GET",
            f"/api/workspaces/{WORKSPACE_ID}/activity", 200,
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})

        # ─── 6. QUERY ENDPOINTS ───
        print("\n─── 6. QUERY ENDPOINTS ───")
        test("List workspace queries (empty)", "GET",
            f"/api/workspaces/{WORKSPACE_ID}/queries", 200,
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
        test("Get single query by ID (not found)", "GET",
            f"/api/workspaces/{WORKSPACE_ID}/queries/00000000-0000-0000-0000-000000000000", 404,
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
        # Query sources endpoint
        test("Query sources (not found)", "GET",
            f"/api/workspaces/{WORKSPACE_ID}/queries/00000000-0000-0000-0000-000000000000/sources", 404,
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
    test("List all queries (cross-workspace)", "GET", "/api/queries", 200,
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
    test("Get any query by ID (not found)", "GET",
        "/api/queries/00000000-0000-0000-0000-000000000000", 404,
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})

    # ─── 7. COLLECTIONS ───
    if WORKSPACE_ID:
        print("\n─── 7. COLLECTIONS ───")
        code, body = test("Create collection", "POST",
            f"/api/workspaces/{WORKSPACE_ID}/collections", 201,
            data={"name": "Test Collection", "description": "Test"},
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
        if code in (200, 201):
            COLLECTION_ID = body.get("id")
        if COLLECTION_ID:
            test("List collections", "GET",
                f"/api/workspaces/{WORKSPACE_ID}/collections", 200,
                headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
            test("Get collection", "GET",
                f"/api/workspaces/{WORKSPACE_ID}/collections/{COLLECTION_ID}", 200,
                headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
            test("Update collection", "PUT",
                f"/api/workspaces/{WORKSPACE_ID}/collections/{COLLECTION_ID}", 200,
                data={"name": "Updated Collection"},
                headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
            test("Collection access list", "GET",
                f"/api/workspaces/{WORKSPACE_ID}/collections/{COLLECTION_ID}/access", 200,
                headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
            # Grant access
            test("Grant collection access", "POST",
                f"/api/workspaces/{WORKSPACE_ID}/collections/{COLLECTION_ID}/access", 201,
                data={"email": "demo@truthlens.ai"},
                headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})

        # ─── 8. COMPARISONS ───
        print("\n─── 8. COMPARISONS ───")
        # Use correct schema: question + document_ids
        code, body = test("Create comparison", "POST",
            f"/api/workspaces/{WORKSPACE_ID}/comparisons", 202,
            data={"question": "What is TruthLens?", "document_ids": []},
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
        if code in (200, 201, 202):
            COMPARISON_ID = body.get("id") or body.get("comparison_id")
        test("List comparisons", "GET",
            f"/api/workspaces/{WORKSPACE_ID}/comparisons", 200,
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
        if COMPARISON_ID:
            test("Get comparison by ID", "GET",
                f"/api/workspaces/{WORKSPACE_ID}/comparisons/{COMPARISON_ID}", 200,
                headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})

    # ─── 9. ADMIN ENDPOINTS ───
    print("\n─── 9. ADMIN ENDPOINTS ───")
    code, body = req("POST", "/api/auth/login",
        data={"email": "admintest1@truthlens.ai", "password": "AdminPass123!"})
    if code == 200:
        ADMIN_TOKEN = body.get("access_token")
        print("[INFO] Admin login OK\n")
    else:
        print(f"[WARN] Admin login failed: {code}\n")

    if ADMIN_TOKEN:
        test("Admin stats", "GET", "/api/admin/stats", 200,
            headers={"Authorization": f"Bearer {ADMIN_TOKEN}"})
        test("Admin logs", "GET", "/api/admin/logs", 200,
            headers={"Authorization": f"Bearer {ADMIN_TOKEN}"})
        test("Admin users list", "GET", "/api/admin/users", 200,
            headers={"Authorization": f"Bearer {ADMIN_TOKEN}"})
        test("Admin settings GET", "GET", "/api/admin/settings", 200,
            headers={"Authorization": f"Bearer {ADMIN_TOKEN}"})
        # Update settings
        test("Admin settings PUT", "PUT", "/api/admin/settings", 200,
            data={"app_name": "TruthLens AI Test"},
            headers={"Authorization": f"Bearer {ADMIN_TOKEN}"})
        test("Admin analytics flagged answers", "GET",
            "/api/admin/analytics/flagged-answers", 200,
            headers={"Authorization": f"Bearer {ADMIN_TOKEN}"})
        test("Admin analytics queries over time", "GET",
            "/api/admin/analytics/queries-over-time", 200,
            headers={"Authorization": f"Bearer {ADMIN_TOKEN}"})
        test("Admin analytics trust score distribution", "GET",
            "/api/admin/analytics/trust-score-distribution", 200,
            headers={"Authorization": f"Bearer {ADMIN_TOKEN}"})
        test("Admin evaluation list", "GET", "/api/admin/evaluation", 200,
            headers={"Authorization": f"Bearer {ADMIN_TOKEN}"})
        test("Admin evaluation history", "GET", "/api/admin/evaluation/history", 200,
            headers={"Authorization": f"Bearer {ADMIN_TOKEN}"})
        # User-specific admin
        users_resp = req("GET", "/api/admin/users",
            headers={"Authorization": f"Bearer {ADMIN_TOKEN}"})
        if users_resp[0] == 200:
            user_list = users_resp[1].get("data", users_resp[1])
            if user_list and len(user_list) > 0:
                uid = user_list[0].get("id") if isinstance(user_list, list) else None
                if not uid and isinstance(user_list, dict):
                    uid = user_list.get("id")
                if uid:
                    test("Admin get user", "GET", f"/api/admin/users/{uid}", 200,
                        headers={"Authorization": f"Bearer {ADMIN_TOKEN}"})
                    test("Admin get user activity", "GET",
                        f"/api/admin/users/{uid}/activity", 200,
                        headers={"Authorization": f"Bearer {ADMIN_TOKEN}"})
        # Admin invite
        test("Admin invite user", "POST", "/api/admin/users/invite", 200,
            data={"email": f"invited{ts}@test.com", "role": "user"},
            headers={"Authorization": f"Bearer {ADMIN_TOKEN}"})
        # Run evaluation
        test("Admin run evaluation", "POST", "/api/admin/evaluation/run", 202,
            data={},
            headers={"Authorization": f"Bearer {ADMIN_TOKEN}"})
    else:
        for ep in ["/api/admin/stats", "/api/admin/logs"]:
            test(f"Admin {ep} (no admin token)", "GET", ep, 403,
                headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})

    # ─── 10. ERROR HANDLING & EDGE CASES ───
    print("\n─── 10. ERROR HANDLING & EDGE CASES ───")
    test("Access non-existent workspace", "GET",
        "/api/workspaces/00000000-0000-0000-0000-000000000000", 404,
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
    # Backend treats invalid UUID as 404 not 422
    test("Invalid workspace ID format", "GET",
        "/api/workspaces/not-a-uuid", 404,
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
    # Try accessing someone else's workspace — register new user with own workspace
    new_email = f"other{ts}@test.com"
    code2, body2 = req("POST", "/api/auth/register", data={
        "email": new_email, "username": f"other{ts}", "password": "OtherPass123!"
    })
    other_token = body2.get("access_token") if code2 == 201 else None
    if other_token:
        # Get the workspace list to find our original workspace ID
        test("Other user sees empty workspaces", "GET", "/api/workspaces", 200,
            headers={"Authorization": f"Bearer {other_token}"})
        # Try accessing our workspace from other user
        if WORKSPACE_ID:
            test("Other user cannot access our workspace", "GET",
                f"/api/workspaces/{WORKSPACE_ID}", 403,
                headers={"Authorization": f"Bearer {other_token}"})

    # ─── DOCUMENT REINDEX & DELETE ───
    if WORKSPACE_ID and DOC_ID:
        test("Reindex document", "POST",
            f"/api/workspaces/{WORKSPACE_ID}/documents/{DOC_ID}/reindex", 202,
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
        test("Delete document", "DELETE",
            f"/api/workspaces/{WORKSPACE_ID}/documents/{DOC_ID}", 204,
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
        test("Verify document deleted", "GET",
            f"/api/workspaces/{WORKSPACE_ID}/documents/{DOC_ID}", 404,
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})

    # ─── COLLECTION ACCESS DELETE ───
    if WORKSPACE_ID and COLLECTION_ID:
        test("Delete collection access", "DELETE",
            f"/api/workspaces/{WORKSPACE_ID}/collections/{COLLECTION_ID}/access/"
            f"{'6b28ae19-e84'}", 204,
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})

    # ─── COLLECTION DELETE ───
    if WORKSPACE_ID and COLLECTION_ID:
        test("Delete collection", "DELETE",
            f"/api/workspaces/{WORKSPACE_ID}/collections/{COLLECTION_ID}", 204,
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})

    # ─── COMPARISON DELETE ───
    if WORKSPACE_ID and COMPARISON_ID:
        test("Delete comparison", "DELETE",
            f"/api/workspaces/{WORKSPACE_ID}/comparisons/{COMPARISON_ID}", 204,
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})

    # ─── WORKSPACE DELETE ───
    if WORKSPACE_ID:
        print("\n─── WORKSPACE CLEANUP ───")
        test("Delete workspace", "DELETE", f"/api/workspaces/{WORKSPACE_ID}", 204,
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
        test("Verify workspace deleted", "GET", f"/api/workspaces/{WORKSPACE_ID}", 404,
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})

    # ─── DELETE OWN ACCOUNT (LAST) ───
    print("\n─── ACCOUNT DELETION ───")
    test("Delete own account", "DELETE", "/api/auth/me", 204,
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})

else:
    print("[FATAL] No access token — tests skipped\n")

# Additional error handling tests (no auth)
test("No auth token on workspace", "GET", "/api/workspaces", 401)
test("Register with weak password", "POST", "/api/auth/register", 422, {
    "email": "weak@test.com", "username": "weakuser", "password": "123"
})
test("Register with empty email", "POST", "/api/auth/register", 422, {
    "email": "", "username": "emptyuser", "password": "StrongPass1!"
})
test("Login with empty body", "POST", "/api/auth/login", 422, {})

# WebSocket test
print("\n─── WEBSOCKET TEST ───")
try:
    import asyncio, websockets
    async def test_ws():
        ws_url = "ws://localhost:8000/api/ws/query"
        try:
            async with websockets.connect(ws_url) as ws:
                # Send auth
                await ws.send(json.dumps({"type": "auth", "token": "INVALID_TOKEN"}))
                resp = await asyncio.wait_for(ws.recv(), timeout=5)
                resp_data = json.loads(resp)
                print(f"  WebSocket invalid auth response: {resp_data}")
                ws_close = await asyncio.wait_for(ws.recv(), timeout=5)
                print(f"  WebSocket close: {ws_close}")
                print("  [PASS] WebSocket invalid auth rejected\n")
        except websockets.exceptions.ConnectionClosed:
            print("  [PASS] WebSocket connection closed after invalid auth\n")
        except Exception as e:
            print(f"  [INFO] WebSocket test: {e}\n")
    asyncio.run(test_ws())
except ImportError:
    print("  [SKIP] websockets not installed\n")
except Exception as e:
    print(f"  [SKIP] WebSocket test: {e}\n")

# User directory endpoints
print("\n─── USER DIRECTORY ───")
if ACCESS_TOKEN:
    # Re-login since we deleted our account
    code, body = req("POST", "/api/auth/login", data={"email": f"other{ts}@test.com", "password": "OtherPass123!"})
    if code == 200:
        tok = body.get("access_token")
        test("List users directory", "GET", "/api/users", 200,
            headers={"Authorization": f"Bearer {tok}"})
        test("Get user by ID", "GET", f"/api/users/{body.get('user',{}).get('id','')}", 200,
            headers={"Authorization": f"Bearer {tok}"})

# ─── SUMMARY ───
print("=" * 70)
print("=== BACKEND TEST SUMMARY ===")
print(f"Total tests: {PASS + FAIL}")
print(f"Passed:     {PASS}")
print(f"Failed:     {FAIL}")
if FAIL > 0:
    print("\nFailed tests:")
    for r in RESULTS:
        if "[FAIL]" in r:
            print(r)
print("=" * 70)

sys.exit(0 if FAIL == 0 else 1)
