# Task 2: FRONTEND UI TESTER — TruthLens AI

## Mission
Open the frontend in a browser, verify every page renders correctly, test auth flow, navigation, workspace management, document upload, WebSocket chat, and admin panels. Take screenshots of key pages. Report all working/broken features.

## Environment
- **Frontend URL**: http://localhost:5173
- **Backend API**: Proxied through Vite at `/api/*` (targets http://localhost:8000)
- **WebSocket**: `ws://localhost:5173/api/ws/query` (proxied same way)
- **App Name**: TruthLens AI / VeritasRAG

## Known State
- Already logged-in session may exist in localStorage (check `veritas_access_token` / `veritas_refresh_token`)
- Test users exist in DB but passwords unknown — attempt login with any stored token first
- If no valid session, try register via UI or go directly to API

## Auth Strategy
1. Check if `veritas_access_token` exists in localStorage → load page and see if session persists
2. If no session: navigate to `/signup`, create account via UI
3. Then login, verify redirect to dashboard
4. Clear tokens and test login page edge cases

## Browser Test Plan

### 1. Landing Page (`/`)
```
- Navigate to http://localhost:5173
- [ ] Page loads without console errors
- [ ] Landing page content renders (hero, features, CTA buttons)
- [ ] "Get Started" / "Sign Up" buttons visible and clickable
- [ ] "Login" link visible and navigates to /login
- [ ] Screenshot: landing_page.png
```

### 2. Login Page (`/login`)
```
- Navigate to /login
- [ ] Login form renders (email input, password input, submit button)
- [ ] "Don't have an account? Sign up" link works
- [ ] "Forgot password?" link works
- [ ] Submit empty form → shows validation errors
- [ ] Submit invalid email format → shows validation
- [ ] Submit wrong credentials → shows error message ("Invalid email or password")
- [ ] Screenshot: login_page.png
```

### 3. Registration Page (`/signup` or `/register`)
```
- Navigate to /register
- [ ] Register form renders (email, username, password, confirm?)
- [ ] Submit with existing user → shows "already registered" error
- [ ] Submit with password < 8 chars → shows validation
- [ ] Register new user successfully → redirects to dashboard
- [ ] Screenshot: register_page.png
```

### 4. Dashboard (Post-login) (`/dashboard`)
```
- [ ] Dashboard page loads
- [ ] User info displayed (username, email, role badge)
- [ ] Stats/overview widgets render (if any)
- [ ] Sidebar navigation visible with all menu items
- [ ] Screenshot: dashboard.png
```

### 5. Sidebar Navigation & Layout
```
- [ ] Sidebar shows: Dashboard, Chat History, My Documents, Workspaces, Settings
- [ ] Admin section (if user is admin): Admin Dashboard, Documents, Upload, Users, Analytics, Audit Log, Collections, API Catalog
- [ ] Sidebar collapse/expand works
- [ ] User section at bottom shows avatar, username, email, admin badge
- [ ] "Sign out" button visible and functional
- [ ] Mobile responsive: hamburger menu on small viewport
- [ ] Screenshot: sidebar_nav.png
```

### 6. Chat / Query Pages
```
- Navigate to /chat/new
- [ ] New Chat page loads
- [ ] Workspace selector present (dropdown or picker)
- [ ] Text input for query visible
- [ ] Send button visible
- Try sending a query (requires workspace with documents):
- [ ] WebSocket connection established (check console for ws messages)
- [ ] Response streaming visible (tokens appear progressively)
- [ ] Sources panel appears after response
- [ ] Trust score displays
- Navigate to /chats (Chat History):
- [ ] List of past queries loads
- [ ] Clicking a query navigates to detail
- Navigate to /chat/:queryId (Chat Detail):
- [ ] Query detail loads (query text, response, sources)
- [ ] Screenshot: chat_page.png, chat_history.png
```

### 7. Workspace Management
```
- Navigate to /workspaces
- [ ] Workspace list renders (or empty state)
- [ ] "Create Workspace" button visible
- [ ] Click create → modal or form appears
- [ ] Create workspace (name + description) → succeeds, appears in list
- [ ] Click workspace → navigates to /workspaces/:id
- [ ] Workspace detail shows: name, description, member count, doc count
- [ ] Tabs/sections: Documents, Chat, Investigation, Members
- [ ] Screenshot: workspaces.png, workspace_detail.png
```

### 8. Document Upload & Management
```
- Navigate to workspace detail → Documents section
- [ ] Upload button visible
- [ ] Click upload → file picker opens
- [ ] Upload a .txt file → shows as pending → eventually shows as ready
- [ ] Document table shows: filename, status, type, size, date
- [ ] Document status polling works (pending → processing → ready)
- [ ] Delete document works
- Navigate to /documents (My Documents cross-workspace):
- [ ] All documents list loads
- [ ] Screenshot: document_upload.png, document_list.png
```

### 9. Investigation Page
```
- Navigate to /workspaces/:id/investigate
- [ ] Investigation page loads
- [ ] Query input + submit visible
- [ ] Screenshot: investigation.png
```

### 10. Settings Page
```
- Navigate to /settings
- [ ] Settings page loads
- [ ] User profile settings (email, username) visible
- [ ] Change password section visible
- [ ] Screenshot: settings.png
```

### 11. Admin Pages (if user has admin role)
```
- Navigate to /admin
- [ ] Admin Dashboard loads (stats: users, workspaces, docs, queries)
- Navigate to /admin/documents
- [ ] All documents table loads
- Navigate to /admin/documents/upload
- [ ] Upload page loads
- Navigate to /admin/users
- [ ] Users table loads
- [ ] Invite user button visible
- Navigate to /admin/analytics
- [ ] Charts/metrics load
- Navigate to /admin/audit-log
- [ ] Audit log entries load
- Navigate to /admin/settings
- [ ] Settings form loads
- Navigate to /api-catalog
- [ ] API catalog page renders
- [ ] Screenshot: admin_dashboard.png
```

### 12. Error Pages & Edge Cases
```
- Navigate to /nonexistent-route → redirects to `/` (catch-all)
- Logout, then visit /dashboard → redirects to /login
- Clear tokens → app should redirect to login
- Test browser back/forward navigation
- [ ] Console has NO 404 errors on navigation
- [ ] No uncaught runtime errors
```

### 13. WebSocket Connection Test (via console)
```
- After logging in, execute in browser console:
  ```js
  const ws = new WebSocket(`ws://localhost:5173/api/ws/query`);
  ws.onopen = () => {
    const token = localStorage.getItem('veritas_access_token');
    ws.send(JSON.stringify({type: 'auth', token}));
  };
  ws.onmessage = (e) => console.log('WS:', JSON.parse(e.data));
  ```
- [ ] WebSocket connects successfully
- [ ] Auth success received
- If workspace available, send a query message:
  ```js
  ws.send(JSON.stringify({type: 'query', payload: {workspace_id: '<ID>', query: 'hello', top_k: 3}}));
  ```
- [ ] Query pipeline events stream back (ack, progress, etc.)
```

## Console Monitoring
Throughout all tests, watch the browser console for:
- [ ] No CORS errors
- [ ] No 401/403/500 API errors in console
- [ ] No React rendering warnings
- [ ] WebSocket connection drops/reconnects behave gracefully
- [ ] React Query cache warnings
- [ ] Any unhandled promise rejections

## Reporting Format
For each page/section:
```
=== {Page Name} ===
[PASS|FAIL] {specific test} — {details}
[PASS|FAIL] {specific test} — {details}
Screenshot(s): {filename(s)}
Console errors: {list if any}
```

Final summary:
```
=== FRONTEND TEST SUMMARY ===
Pages tested: N
Full passes:  N
Partial:      N
Broken:       N
Console errors found: [list]
UI bugs: [list visual issues, broken interactions, missing elements]
Screenshots captured: [list all filenames]
```
