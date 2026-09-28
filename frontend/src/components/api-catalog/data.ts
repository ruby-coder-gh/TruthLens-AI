import type { ApiGroup, WebSocketStage, CatalogStats } from './types';

// BUG-44. Kept aligned with `backend/app/api/*.py` — every route each
// sub-router actually registers, mounted via `backend/app/api/router.py`
// (no extra prefix: each file's own `APIRouter(prefix=...)` is the full
// path). Regenerate this by re-reading those files, not by guessing.
export const API_GROUPS: ApiGroup[] = [
  {
    id: 'auth',
    name: 'Authentication',
    description: 'Registration, login, token refresh, password recovery, and the demo persona login',
    icon: 'LogIn',
    // Mid-tone accent blues: ≥3:1 as an icon on both themes' surfaces.
    color: '#4F74D9',
    endpoints: [
      {
        method: 'POST',
        path: '/api/auth/register',
        description: 'Create a new user account with username, email, and password',
        auth: 'Optional',
        parameters: [
          { name: 'username', type: 'string', required: true, description: 'Unique username', location: 'body' },
          { name: 'email', type: 'string', required: true, description: 'User email address', location: 'body' },
          { name: 'password', type: 'string', required: true, description: 'Strong password (min 8 chars)', location: 'body' },
        ],
        exampleRequest: JSON.stringify({ username: 'johndoe', email: 'john@example.com', password: 'securePass123' }, null, 2),
        exampleResponse: JSON.stringify({ access_token: 'eyJ...', refresh_token: 'eyJ...', user: { id: 'usr_123', username: 'johndoe', email: 'john@example.com', role: 'user' } }, null, 2),
      },
      {
        method: 'POST',
        path: '/api/auth/login',
        description: 'Authenticate with credentials and receive JWT tokens',
        auth: 'Optional',
        parameters: [
          { name: 'username', type: 'string', required: true, description: 'Username or email', location: 'body' },
          { name: 'password', type: 'string', required: true, description: 'Account password', location: 'body' },
        ],
        exampleRequest: JSON.stringify({ username: 'johndoe', password: 'securePass123' }, null, 2),
        exampleResponse: JSON.stringify({ access_token: 'eyJ...', refresh_token: 'eyJ...', user: { id: 'usr_123', username: 'johndoe', role: 'user' } }, null, 2),
      },
      {
        method: 'POST',
        path: '/api/auth/demo-login',
        description: 'One-click login as a fixed demo persona (analyst/admin) — no credentials',
        auth: 'Optional',
        parameters: [
          { name: 'persona', type: 'string', required: true, description: '"analyst" or "admin"', location: 'body' },
        ],
        exampleRequest: JSON.stringify({ persona: 'analyst' }, null, 2),
      },
      {
        method: 'POST',
        path: '/api/auth/refresh',
        description: 'Exchange a refresh token for a new access token',
        auth: 'Optional',
        parameters: [
          { name: 'refresh_token', type: 'string', required: true, description: 'Valid refresh token', location: 'body' },
        ],
        exampleRequest: JSON.stringify({ refresh_token: 'eyJ...' }, null, 2),
        exampleResponse: JSON.stringify({ access_token: 'eyJ...', refresh_token: 'eyJ...' }, null, 2),
      },
      {
        method: 'POST',
        path: '/api/auth/logout',
        description: 'Revoke the current refresh token session',
        auth: 'Required',
      },
      {
        method: 'POST',
        path: '/api/auth/forgot-password',
        description: 'Request a password reset link by email',
        auth: 'Optional',
        parameters: [
          { name: 'email', type: 'string', required: true, description: 'Account email', location: 'body' },
        ],
      },
      {
        method: 'POST',
        path: '/api/auth/reset-password',
        description: 'Set a new password using a reset token',
        auth: 'Optional',
        parameters: [
          { name: 'token', type: 'string', required: true, description: 'Reset token from the email link', location: 'body' },
          { name: 'new_password', type: 'string', required: true, description: 'New password', location: 'body' },
        ],
      },
      {
        method: 'POST',
        path: '/api/auth/change-password',
        description: 'Change the current password (requires the current one)',
        auth: 'Required',
        parameters: [
          { name: 'current_password', type: 'string', required: true, description: 'Current password', location: 'body' },
          { name: 'new_password', type: 'string', required: true, description: 'New password', location: 'body' },
        ],
      },
      {
        method: 'GET',
        path: '/api/auth/me',
        description: 'Retrieve the currently authenticated user profile',
        auth: 'Required',
      },
      {
        method: 'PATCH',
        path: '/api/auth/me',
        description: 'Update the current user profile fields',
        auth: 'Required',
        parameters: [
          { name: 'username', type: 'string', required: false, description: 'New username', location: 'body' },
          { name: 'email', type: 'string', required: false, description: 'New email address', location: 'body' },
        ],
      },
      {
        method: 'DELETE',
        path: '/api/auth/me',
        description: 'Permanently delete the current user account',
        auth: 'Required',
      },
      {
        method: 'GET',
        path: '/api/health/ready',
        description: 'Whether the model/embedding backend has finished warming up (polled before login)',
        auth: 'Optional',
      },
    ],
  },
  {
    id: 'users',
    name: 'Users',
    description: 'User management and administration — admin only',
    icon: 'Users',
    color: '#3F63C4',
    endpoints: [
      {
        method: 'GET',
        path: '/api/users',
        description: 'List all registered users (paginated)',
        auth: 'Admin',
      },
      {
        method: 'GET',
        path: '/api/users/{id}',
        description: 'Get a specific user by their unique ID',
        auth: 'Admin',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'User ID (uuid)', location: 'path' },
        ],
      },
      {
        method: 'PUT',
        path: '/api/users/{id}',
        description: 'Update user role, status, or profile data',
        auth: 'Admin',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'User ID', location: 'path' },
          { name: 'role', type: 'string', required: false, description: 'New role (user/admin)', location: 'body' },
        ],
      },
      {
        method: 'DELETE',
        path: '/api/users/{id}',
        description: 'Delete a user account permanently',
        auth: 'Admin',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'User ID', location: 'path' },
        ],
      },
    ],
  },
  {
    id: 'workspaces',
    name: 'Workspaces',
    description: 'Workspace CRUD, member management, activity, and suggested questions',
    icon: 'LayoutDashboard',
    color: '#34d399',
    endpoints: [
      {
        method: 'GET',
        path: '/api/workspaces',
        description: 'List all workspaces accessible by the current user',
        auth: 'Required',
      },
      {
        method: 'POST',
        path: '/api/workspaces',
        description: 'Create a new workspace for document collaboration',
        auth: 'Required',
        parameters: [
          { name: 'name', type: 'string', required: true, description: 'Workspace display name', location: 'body' },
          { name: 'description', type: 'string', required: false, description: 'Optional description', location: 'body' },
        ],
        exampleRequest: JSON.stringify({ name: 'Research Project', description: 'AI research papers workspace' }, null, 2),
      },
      {
        method: 'GET',
        path: '/api/workspaces/{id}',
        description: 'Get detailed workspace information',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
        ],
      },
      {
        method: 'PUT',
        path: '/api/workspaces/{id}',
        description: 'Update workspace name or description',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
        ],
      },
      {
        method: 'DELETE',
        path: '/api/workspaces/{id}',
        description: 'Delete a workspace and all associated data',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
        ],
      },
      {
        method: 'GET',
        path: '/api/workspaces/{id}/members',
        description: 'List all members of a workspace',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
        ],
      },
      {
        method: 'POST',
        path: '/api/workspaces/{id}/members',
        description: 'Add a member to the workspace by user id',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'user_id', type: 'string', required: true, description: 'User ID to add', location: 'body' },
          { name: 'role', type: 'string', required: false, description: 'Member role (viewer/editor/admin)', location: 'body' },
        ],
      },
      {
        method: 'PUT',
        path: '/api/workspaces/{id}/members/{userId}',
        description: "Change a member's role",
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'userId', type: 'string', required: true, description: 'Member user ID', location: 'path' },
          { name: 'role', type: 'string', required: true, description: 'New role', location: 'body' },
        ],
      },
      {
        method: 'DELETE',
        path: '/api/workspaces/{id}/members/{userId}',
        description: 'Remove a member from the workspace',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'userId', type: 'string', required: true, description: 'User ID to remove', location: 'path' },
        ],
      },
      {
        method: 'GET',
        path: '/api/workspaces/{id}/activity',
        description: 'Recent audit-log activity scoped to this workspace',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
        ],
      },
      {
        method: 'GET',
        path: '/api/workspaces/{id}/suggestions',
        description: 'Suggested demo questions for this workspace',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
        ],
      },
    ],
  },
  {
    id: 'documents',
    name: 'Documents',
    description: 'Document upload, ingestion pipeline, source-viewer geometry, and content management',
    icon: 'FileText',
    color: '#fbbf24',
    endpoints: [
      {
        method: 'GET',
        path: '/api/workspaces/{id}/documents',
        description: 'List all documents in a workspace',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
        ],
      },
      {
        method: 'POST',
        path: '/api/workspaces/{id}/documents',
        description: 'Upload a document for ingestion (PDF, DOCX, TXT, MD, CSV, JSON)',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'file', type: 'file', required: true, description: 'Document file (multipart upload)', location: 'body' },
        ],
      },
      {
        method: 'GET',
        path: '/api/documents',
        description: 'List documents across every workspace (admin), filterable by status/search/tags',
        auth: 'Admin',
      },
      {
        method: 'GET',
        path: '/api/workspaces/{id}/documents/{docId}',
        description: 'Get document metadata, ingestion status, and its first indexed chunks',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'docId', type: 'string', required: true, description: 'Document ID', location: 'path' },
        ],
      },
      {
        method: 'GET',
        path: '/api/workspaces/{id}/documents/{docId}/status',
        description: 'Poll ingestion pipeline status for a single document',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'docId', type: 'string', required: true, description: 'Document ID', location: 'path' },
        ],
      },
      {
        method: 'GET',
        path: '/api/workspaces/{id}/documents/{docId}/file',
        description: 'Stream the original uploaded file (served as text/plain for non-PDF, never sniffed as HTML)',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'docId', type: 'string', required: true, description: 'Document ID', location: 'path' },
        ],
      },
      {
        method: 'GET',
        path: '/api/workspaces/{id}/documents/{docId}/chunks/{chunkId}/locate',
        description: 'Where a chunk lives in the source file — PDF rects or a text-mode offset, for the source viewer',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'docId', type: 'string', required: true, description: 'Document ID', location: 'path' },
          { name: 'chunkId', type: 'string', required: true, description: 'Chunk ID', location: 'path' },
          { name: 'text', type: 'string', required: false, description: 'Locate this exact sentence, not the whole chunk', location: 'query' },
        ],
      },
      {
        method: 'POST',
        path: '/api/workspaces/{id}/documents/{docId}/reindex',
        description: 'Re-run ingestion for a document (re-chunk, re-embed)',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'docId', type: 'string', required: true, description: 'Document ID', location: 'path' },
        ],
      },
      {
        method: 'DELETE',
        path: '/api/workspaces/{id}/documents/{docId}',
        description: 'Delete a document and its vector embeddings',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'docId', type: 'string', required: true, description: 'Document ID', location: 'path' },
        ],
      },
      {
        method: 'POST',
        path: '/api/admin/documents/bulk',
        description: 'Run delete/reindex/tag/untag across up to 200 documents at once',
        auth: 'Admin',
        parameters: [
          { name: 'action', type: 'string', required: true, description: '"delete" | "reindex" | "tag" | "untag"', location: 'body' },
          { name: 'document_ids', type: 'string[]', required: true, description: 'Up to 200 document IDs', location: 'body' },
          { name: 'tags', type: 'string[]', required: false, description: 'Required for tag/untag', location: 'body' },
        ],
      },
    ],
  },
  {
    id: 'collections',
    name: 'Collections',
    description: 'Group documents into named collections and share access within a workspace',
    icon: 'FolderOpen',
    color: '#34d399',
    endpoints: [
      {
        method: 'GET',
        path: '/api/workspaces/{id}/collections',
        description: 'List collections the current user can see in a workspace',
        auth: 'Required',
        parameters: [{ name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' }],
      },
      {
        method: 'POST',
        path: '/api/workspaces/{id}/collections',
        description: 'Create a collection',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'name', type: 'string', required: true, description: 'Collection name', location: 'body' },
          { name: 'description', type: 'string', required: false, description: 'Optional description', location: 'body' },
        ],
      },
      {
        method: 'GET',
        path: '/api/workspaces/{id}/collections/{collectionId}',
        description: 'Get a collection and its document count',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'collectionId', type: 'string', required: true, description: 'Collection ID', location: 'path' },
        ],
      },
      {
        method: 'PUT',
        path: '/api/workspaces/{id}/collections/{collectionId}',
        description: 'Rename or redescribe a collection',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'collectionId', type: 'string', required: true, description: 'Collection ID', location: 'path' },
        ],
      },
      {
        method: 'DELETE',
        path: '/api/workspaces/{id}/collections/{collectionId}',
        description: 'Delete a collection (documents themselves are not deleted)',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'collectionId', type: 'string', required: true, description: 'Collection ID', location: 'path' },
        ],
      },
      {
        method: 'GET',
        path: '/api/workspaces/{id}/collections/{collectionId}/access',
        description: 'List users granted explicit access to a collection',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'collectionId', type: 'string', required: true, description: 'Collection ID', location: 'path' },
        ],
      },
      {
        method: 'POST',
        path: '/api/workspaces/{id}/collections/{collectionId}/access',
        description: 'Grant a user access to a collection',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'collectionId', type: 'string', required: true, description: 'Collection ID', location: 'path' },
          { name: 'user_id', type: 'string', required: true, description: 'User to grant access to', location: 'body' },
        ],
      },
      {
        method: 'DELETE',
        path: '/api/workspaces/{id}/collections/{collectionId}/access/{userId}',
        description: "Revoke a user's access to a collection",
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'collectionId', type: 'string', required: true, description: 'Collection ID', location: 'path' },
          { name: 'userId', type: 'string', required: true, description: 'User ID', location: 'path' },
        ],
      },
    ],
  },
  {
    id: 'queries',
    name: 'Queries',
    description: 'RAG query execution, history, pinning, comparison, and streaming responses',
    icon: 'MessageSquare',
    color: '#fb923c',
    endpoints: [
      {
        method: 'POST',
        path: '/api/workspaces/{id}/queries',
        description: 'Execute a RAG query against workspace documents (returns query_id for streaming)',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'query', type: 'string', required: true, description: 'Natural language query', location: 'body' },
          { name: 'conversation_id', type: 'string', required: false, description: 'For multi-turn conversations', location: 'body' },
        ],
        exampleRequest: JSON.stringify({ query: 'What are the key findings in the research paper?', conversation_id: 'conv_123' }, null, 2),
      },
      {
        method: 'GET',
        path: '/api/workspaces/{id}/queries',
        description: 'List query history for a workspace, with pagination and filters',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'page', type: 'integer', required: false, description: 'Page number', location: 'query' },
          { name: 'page_size', type: 'integer', required: false, description: 'Items per page', location: 'query' },
        ],
      },
      {
        method: 'GET',
        path: '/api/queries',
        description: "List the current user's own queries across all workspaces",
        auth: 'Required',
        parameters: [
          { name: 'page', type: 'integer', required: false, description: 'Page number', location: 'query' },
          { name: 'page_size', type: 'integer', required: false, description: 'Items per page', location: 'query' },
        ],
      },
      {
        method: 'GET',
        path: '/api/workspaces/{id}/queries/{queryId}',
        description: 'Get full query details, answer, claims, and sources',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'queryId', type: 'string', required: true, description: 'Query ID', location: 'path' },
        ],
      },
      {
        method: 'GET',
        path: '/api/queries/{queryId}',
        description: 'Get full query details by id alone (workspace-agnostic)',
        auth: 'Required',
        parameters: [{ name: 'queryId', type: 'string', required: true, description: 'Query ID', location: 'path' }],
      },
      {
        method: 'GET',
        path: '/api/workspaces/{id}/queries/{queryId}/sources',
        description: 'List the retrieved source chunks behind an answer',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'queryId', type: 'string', required: true, description: 'Query ID', location: 'path' },
        ],
      },
      {
        method: 'GET',
        path: '/api/queries/{queryId}/export',
        description: 'Export a stored answer as a citation-clean Markdown file',
        auth: 'Required',
        parameters: [{ name: 'queryId', type: 'string', required: true, description: 'Query ID', location: 'path' }],
      },
      {
        method: 'POST',
        path: '/api/workspaces/{id}/queries/{queryId}/pin',
        description: 'Pin a query to the sidebar Recent list',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'queryId', type: 'string', required: true, description: 'Query ID', location: 'path' },
        ],
      },
      {
        method: 'DELETE',
        path: '/api/workspaces/{id}/queries/{queryId}/pin',
        description: 'Unpin a query',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'queryId', type: 'string', required: true, description: 'Query ID', location: 'path' },
        ],
      },
      {
        method: 'POST',
        path: '/api/workspaces/{id}/queries/{queryId}/compare',
        description: 'Re-run a stored query and diff the new answer against the original',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'queryId', type: 'string', required: true, description: 'Query ID', location: 'path' },
        ],
      },
      {
        method: 'DELETE',
        path: '/api/workspaces/{id}/queries/{queryId}',
        description: 'Delete a query record',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'queryId', type: 'string', required: true, description: 'Query ID', location: 'path' },
        ],
      },
    ],
  },
  {
    id: 'comparisons',
    name: 'Comparisons',
    description: 'Side-by-side prompt/model comparison runs, streamed over WebSocket',
    icon: 'GitCompareArrows',
    color: '#fb923c',
    endpoints: [
      {
        method: 'POST',
        path: '/api/workspaces/{id}/comparisons',
        description: 'Start a comparison run across two prompt/model configurations',
        auth: 'Required',
        parameters: [{ name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' }],
      },
      {
        method: 'GET',
        path: '/api/workspaces/{id}/comparisons',
        description: 'List past comparison runs',
        auth: 'Required',
        parameters: [{ name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' }],
      },
      {
        method: 'GET',
        path: '/api/workspaces/{id}/comparisons/{comparisonId}',
        description: 'Get a comparison run and both sides of its result',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'comparisonId', type: 'string', required: true, description: 'Comparison ID', location: 'path' },
        ],
      },
      {
        method: 'DELETE',
        path: '/api/workspaces/{id}/comparisons/{comparisonId}',
        description: 'Delete a comparison run',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'comparisonId', type: 'string', required: true, description: 'Comparison ID', location: 'path' },
        ],
      },
    ],
  },
  {
    id: 'investigation',
    name: 'Investigation',
    description: 'Deep multi-step investigative analysis across documents, with a reviewable case file',
    icon: 'Search',
    color: '#fb923c',
    endpoints: [
      {
        method: 'POST',
        path: '/api/workspaces/{id}/investigate',
        description: 'Run a deep investigation with iterative query refinement',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'topic', type: 'string', required: true, description: 'Investigation topic or question', location: 'body' },
          { name: 'depth', type: 'integer', required: false, description: 'Analysis depth (1-5)', location: 'body' },
        ],
        exampleRequest: JSON.stringify({ topic: 'Analyze all mentions of AI safety in our documents', depth: 3 }, null, 2),
      },
      {
        method: 'GET',
        path: '/api/workspaces/{id}/investigations',
        description: 'List past investigation case files',
        auth: 'Required',
        parameters: [{ name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' }],
      },
      {
        method: 'GET',
        path: '/api/workspaces/{id}/investigations/{investigationId}',
        description: 'Get a case file — report, sub-questions, and citations',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'investigationId', type: 'string', required: true, description: 'Investigation ID', location: 'path' },
        ],
      },
      {
        method: 'PATCH',
        path: '/api/workspaces/{id}/investigations/{investigationId}/review',
        description: "Update a case file's review status",
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'investigationId', type: 'string', required: true, description: 'Investigation ID', location: 'path' },
        ],
      },
      {
        method: 'GET',
        path: '/api/workspaces/{id}/investigations/{investigationId}/export',
        description: 'Download a zipped audit bundle for a case file',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'investigationId', type: 'string', required: true, description: 'Investigation ID', location: 'path' },
        ],
      },
    ],
  },
  {
    id: 'review-queue',
    name: 'Review Queue & Quarantine',
    description: 'Human-in-the-loop review of low-trust answers and ingest-time quarantined chunks',
    icon: 'ListChecks',
    color: '#f87171',
    endpoints: [
      {
        method: 'GET',
        path: '/api/workspaces/{id}/review-queue',
        description: 'List answers flagged for human review',
        auth: 'Required',
        parameters: [{ name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' }],
      },
      {
        method: 'GET',
        path: '/api/workspaces/{id}/review-queue/count',
        description: 'Count of items currently awaiting review',
        auth: 'Required',
        parameters: [{ name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' }],
      },
      {
        method: 'PATCH',
        path: '/api/workspaces/{id}/review-queue/settings',
        description: 'Update the trust-score threshold that flags an answer for review',
        auth: 'Required',
        parameters: [{ name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' }],
      },
      {
        method: 'PATCH',
        path: '/api/workspaces/{id}/review-queue/{queryId}',
        description: 'Mark a queued answer reviewed',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'queryId', type: 'string', required: true, description: 'Query ID', location: 'path' },
        ],
      },
      {
        method: 'POST',
        path: '/api/workspaces/{id}/review-queue/{queryId}/promote-golden',
        description: "Promote a reviewed answer into the workspace's golden set (pending admin approval)",
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'queryId', type: 'string', required: true, description: 'Query ID', location: 'path' },
        ],
      },
      {
        method: 'GET',
        path: '/api/workspaces/{id}/review-queue/quarantine',
        description: 'List chunks the injection scanner held back at ingest time (viewers may read)',
        auth: 'Required',
        parameters: [{ name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' }],
      },
      {
        method: 'POST',
        path: '/api/workspaces/{id}/review-queue/quarantine/{quarantineId}/release',
        description: 'Release a quarantined chunk back into the index',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'quarantineId', type: 'string', required: true, description: 'Quarantine entry ID', location: 'path' },
        ],
      },
      {
        method: 'POST',
        path: '/api/workspaces/{id}/review-queue/quarantine/{quarantineId}/dismiss',
        description: 'Permanently dismiss a quarantined chunk',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'quarantineId', type: 'string', required: true, description: 'Quarantine entry ID', location: 'path' },
        ],
      },
      {
        method: 'GET',
        path: '/api/admin/quarantine',
        description: 'Cross-workspace view of every quarantined chunk',
        auth: 'Admin',
      },
    ],
  },
  {
    id: 'annotations',
    name: 'Annotations',
    description: 'Threaded comments on a query, for collaborative review',
    icon: 'MessageCircle',
    color: '#3F63C4',
    endpoints: [
      {
        method: 'GET',
        path: '/api/workspaces/{id}/queries/{queryId}/annotations',
        description: 'List annotations on a query',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'queryId', type: 'string', required: true, description: 'Query ID', location: 'path' },
        ],
      },
      {
        method: 'GET',
        path: '/api/workspaces/{id}/queries/{queryId}/annotations/count',
        description: 'Count of annotations on a query',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'queryId', type: 'string', required: true, description: 'Query ID', location: 'path' },
        ],
      },
      {
        method: 'POST',
        path: '/api/workspaces/{id}/queries/{queryId}/annotations',
        description: 'Add an annotation to a query',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'queryId', type: 'string', required: true, description: 'Query ID', location: 'path' },
          { name: 'content', type: 'string', required: true, description: 'Comment text', location: 'body' },
        ],
      },
      {
        method: 'PATCH',
        path: '/api/workspaces/{id}/queries/{queryId}/annotations/{annotationId}',
        description: 'Edit an annotation',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'queryId', type: 'string', required: true, description: 'Query ID', location: 'path' },
          { name: 'annotationId', type: 'string', required: true, description: 'Annotation ID', location: 'path' },
        ],
      },
      {
        method: 'DELETE',
        path: '/api/workspaces/{id}/queries/{queryId}/annotations/{annotationId}',
        description: 'Delete an annotation',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'queryId', type: 'string', required: true, description: 'Query ID', location: 'path' },
          { name: 'annotationId', type: 'string', required: true, description: 'Annotation ID', location: 'path' },
        ],
      },
    ],
  },
  {
    id: 'receipts',
    name: 'Truth Receipts',
    description: 'Cryptographically sealed, publicly shareable proof of an answer and its sources',
    icon: 'FileCheck2',
    color: '#34d399',
    endpoints: [
      {
        method: 'POST',
        path: '/api/queries/{queryId}/receipts',
        description: 'Seal a receipt for a query (editor role or above)',
        auth: 'Required',
        parameters: [{ name: 'queryId', type: 'string', required: true, description: 'Query ID', location: 'path' }],
      },
      {
        method: 'GET',
        path: '/api/queries/{queryId}/receipts',
        description: 'List receipts sealed for a query',
        auth: 'Required',
        parameters: [{ name: 'queryId', type: 'string', required: true, description: 'Query ID', location: 'path' }],
      },
      {
        method: 'GET',
        path: '/api/receipts/{token}',
        description: 'Public, unauthenticated fetch of a sealed receipt by its share token',
        auth: 'Optional',
        parameters: [{ name: 'token', type: 'string', required: true, description: 'Receipt share token', location: 'path' }],
      },
      {
        method: 'DELETE',
        path: '/api/receipts/{token}',
        description: 'Revoke a sealed receipt',
        auth: 'Required',
        parameters: [{ name: 'token', type: 'string', required: true, description: 'Receipt share token', location: 'path' }],
      },
    ],
  },
  {
    id: 'radar',
    name: 'Contradiction Radar',
    description: 'Cross-document contradiction detection and triage',
    icon: 'AlertTriangle',
    color: '#f87171',
    endpoints: [
      {
        method: 'GET',
        path: '/api/workspaces/{id}/radar',
        description: 'Get the current contradiction state for a workspace',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'status', type: 'string', required: false, description: 'Filter: open/dismissed/resolved', location: 'query' },
        ],
      },
      {
        method: 'POST',
        path: '/api/workspaces/{id}/radar/scans',
        description: 'Kick off a full contradiction scan across the workspace',
        auth: 'Required',
        parameters: [{ name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' }],
      },
      {
        method: 'PATCH',
        path: '/api/workspaces/{id}/radar/contradictions/{contradictionId}',
        description: 'Dismiss, resolve, or reopen a contradiction',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'contradictionId', type: 'string', required: true, description: 'Contradiction ID', location: 'path' },
          { name: 'status', type: 'string', required: true, description: 'open/dismissed/resolved', location: 'body' },
        ],
      },
    ],
  },
  {
    id: 'feedback',
    name: 'Feedback',
    description: 'Thumbs up/down feedback on a query result',
    icon: 'ThumbsUp',
    color: '#34d399',
    endpoints: [
      {
        method: 'POST',
        path: '/api/queries/{queryId}/feedback',
        description: 'Submit thumbs up/down feedback for a query result',
        auth: 'Required',
        parameters: [
          { name: 'queryId', type: 'string', required: true, description: 'Query ID', location: 'path' },
          { name: 'rating', type: 'integer', required: true, description: 'Rating (1-5)', location: 'body' },
          { name: 'comment', type: 'string', required: false, description: 'Optional feedback comment', location: 'body' },
        ],
        exampleRequest: JSON.stringify({ rating: 4, comment: 'Very accurate and well-cited answer' }, null, 2),
      },
      {
        method: 'GET',
        path: '/api/queries/{queryId}/feedback',
        description: 'List all feedback for a specific query',
        auth: 'Required',
        parameters: [{ name: 'queryId', type: 'string', required: true, description: 'Query ID', location: 'path' }],
      },
    ],
  },
  {
    id: 'search',
    name: 'Search',
    description: 'Global search across documents and queries (the ⌘K palette)',
    icon: 'SearchCheck',
    color: '#fbbf24',
    endpoints: [
      {
        method: 'GET',
        path: '/api/search',
        description: 'Search documents and queries the current user can access',
        auth: 'Required',
        parameters: [
          { name: 'q', type: 'string', required: true, description: 'Search text', location: 'query' },
          { name: 'workspace_id', type: 'string', required: false, description: 'Restrict to one workspace', location: 'query' },
        ],
      },
    ],
  },
  {
    id: 'admin',
    name: 'Admin — Core',
    description: 'System stats, settings, audit log, and RAGAS evaluation — admin only',
    icon: 'Shield',
    color: '#f87171',
    endpoints: [
      {
        method: 'GET',
        path: '/api/admin/stats',
        description: 'Users, workspaces, documents, queries, trust and cache counters',
        auth: 'Admin',
      },
      {
        method: 'GET',
        path: '/api/admin/settings',
        description: 'Get current app settings',
        auth: 'Admin',
      },
      {
        method: 'PUT',
        path: '/api/admin/settings',
        description: 'Update upload size, trust thresholds, and rate limiting (in-memory, resets on restart)',
        auth: 'Admin',
        parameters: [
          { name: 'max_upload_size_mb', type: 'integer', required: false, description: '', location: 'body' },
          { name: 'trust_score_high_threshold', type: 'number', required: false, description: '', location: 'body' },
          { name: 'trust_score_low_threshold', type: 'number', required: false, description: '', location: 'body' },
          { name: 'rate_limit_enabled', type: 'boolean', required: false, description: '', location: 'body' },
        ],
      },
      {
        method: 'GET',
        path: '/api/admin/logs',
        description: 'Paginated, filterable system audit log',
        auth: 'Admin',
        parameters: [
          { name: 'action', type: 'string', required: false, description: 'Exact action, e.g. "document.upload"', location: 'query' },
          { name: 'page', type: 'integer', required: false, description: 'Page number', location: 'query' },
        ],
      },
      {
        method: 'GET',
        path: '/api/admin/logs/export',
        description: 'Export the (filtered) audit log as CSV or JSON',
        auth: 'Admin',
        parameters: [{ name: 'format', type: 'string', required: true, description: '"csv" | "json"', location: 'query' }],
      },
      {
        method: 'GET',
        path: '/api/admin/users/{userId}/activity',
        description: "A user's recent activity from the audit log",
        auth: 'Admin',
        parameters: [{ name: 'userId', type: 'string', required: true, description: 'User ID', location: 'path' }],
      },
      {
        method: 'POST',
        path: '/api/admin/users/invite',
        description: 'Invite a new user by email',
        auth: 'Admin',
        parameters: [
          { name: 'email', type: 'string', required: true, description: '', location: 'body' },
          { name: 'username', type: 'string', required: true, description: '', location: 'body' },
        ],
      },
      {
        method: 'PUT',
        path: '/api/admin/users/{userId}/role',
        description: "Change a user's role",
        auth: 'Admin',
        parameters: [{ name: 'userId', type: 'string', required: true, description: 'User ID', location: 'path' }],
      },
      {
        method: 'PUT',
        path: '/api/admin/users/{userId}/status',
        description: 'Activate or deactivate a user',
        auth: 'Admin',
        parameters: [{ name: 'userId', type: 'string', required: true, description: 'User ID', location: 'path' }],
      },
      {
        method: 'GET',
        path: '/api/admin/analytics/flagged-answers',
        description: 'Recent low-trust answers, for the dashboard flag list',
        auth: 'Admin',
      },
      {
        method: 'GET',
        path: '/api/admin/analytics/queries-over-time',
        description: 'Daily query volume for the trend chart',
        auth: 'Admin',
      },
      {
        method: 'GET',
        path: '/api/admin/analytics/trust-score-distribution',
        description: 'Query counts bucketed by trust score',
        auth: 'Admin',
      },
      {
        method: 'GET',
        path: '/api/admin/evaluation',
        description: 'The last written RAGAS evaluation snapshot',
        auth: 'Admin',
      },
      {
        method: 'POST',
        path: '/api/admin/evaluation/run',
        description: 'Queue a golden-set evaluation run (202, async)',
        auth: 'Admin',
      },
      {
        method: 'GET',
        path: '/api/admin/evaluation/history',
        description: 'Past evaluation runs with per-metric scores',
        auth: 'Admin',
      },
    ],
  },
  {
    id: 'prompts',
    name: 'Admin — Prompt Versions',
    description: 'Version, eval-gate, and promote the answer-generation prompt',
    icon: 'GitBranch',
    color: '#f87171',
    endpoints: [
      {
        method: 'GET',
        path: '/api/admin/prompts',
        description: 'List prompt versions, filterable by status',
        auth: 'Admin',
      },
      {
        method: 'POST',
        path: '/api/admin/prompts',
        description: 'Create a draft prompt version',
        auth: 'Admin',
        parameters: [
          { name: 'name', type: 'string', required: true, description: '', location: 'body' },
          { name: 'content', type: 'string', required: true, description: '', location: 'body' },
        ],
      },
      {
        method: 'GET',
        path: '/api/admin/prompts/active',
        description: 'The prompt currently used for generation',
        auth: 'Admin',
        parameters: [{ name: 'name', type: 'string', required: false, description: 'Default "answer"', location: 'query' }],
      },
      {
        method: 'GET',
        path: '/api/admin/prompts/{promptId}',
        description: 'Get one prompt version, with its latest eval summary',
        auth: 'Admin',
        parameters: [{ name: 'promptId', type: 'string', required: true, description: 'Prompt version ID', location: 'path' }],
      },
      {
        method: 'GET',
        path: '/api/admin/prompts/{promptId}/diff',
        description: 'Unified diff of a version against active (or another version)',
        auth: 'Admin',
        parameters: [
          { name: 'promptId', type: 'string', required: true, description: 'Prompt version ID', location: 'path' },
          { name: 'against', type: 'string', required: false, description: 'Default "active"', location: 'query' },
        ],
      },
      {
        method: 'POST',
        path: '/api/admin/prompts/{promptId}/evaluate',
        description: 'Queue a golden-set eval for this version (202, async)',
        auth: 'Admin',
        parameters: [
          { name: 'promptId', type: 'string', required: true, description: 'Prompt version ID', location: 'path' },
          { name: 'subset', type: 'string', required: false, description: '"smoke" | "full"', location: 'query' },
        ],
      },
      {
        method: 'POST',
        path: '/api/admin/prompts/{promptId}/promote',
        description: "Promote a version to active — 409 if it hasn't cleared the eval gate, unless forced",
        auth: 'Admin',
        parameters: [
          { name: 'promptId', type: 'string', required: true, description: 'Prompt version ID', location: 'path' },
          { name: 'force', type: 'boolean', required: false, description: 'Override a failed eval gate', location: 'query' },
        ],
      },
      {
        method: 'POST',
        path: '/api/admin/prompts/{promptId}/rollback',
        description: 'Reactivate a retired version, retiring whatever is active now',
        auth: 'Admin',
        parameters: [{ name: 'promptId', type: 'string', required: true, description: 'Prompt version ID', location: 'path' }],
      },
      {
        method: 'DELETE',
        path: '/api/admin/prompts/{promptId}',
        description: 'Delete a draft or retired prompt version',
        auth: 'Admin',
        parameters: [{ name: 'promptId', type: 'string', required: true, description: 'Prompt version ID', location: 'path' }],
      },
    ],
  },
  {
    id: 'golden',
    name: 'Admin — Golden Set',
    description: 'Approve editor-promoted answers into the shared golden evaluation set',
    icon: 'Award',
    color: '#f87171',
    endpoints: [
      {
        method: 'GET',
        path: '/api/admin/golden',
        description: 'List golden-set entries (builtin and/or promoted, pending/approved)',
        auth: 'Admin',
      },
      {
        method: 'POST',
        path: '/api/admin/golden/{entryId}/approve',
        description: 'Approve a pending promoted entry',
        auth: 'Admin',
        parameters: [{ name: 'entryId', type: 'string', required: true, description: 'Golden entry ID', location: 'path' }],
      },
      {
        method: 'DELETE',
        path: '/api/admin/golden/{entryId}',
        description: 'Reject/remove a golden-set entry',
        auth: 'Admin',
        parameters: [{ name: 'entryId', type: 'string', required: true, description: 'Golden entry ID', location: 'path' }],
      },
    ],
  },
  {
    id: 'usage',
    name: 'Admin — Usage & Cost',
    description: 'Token usage, latency, and estimated cost reporting',
    icon: 'DollarSign',
    color: '#f87171',
    endpoints: [
      {
        method: 'GET',
        path: '/api/admin/usage',
        description: 'Usage rows grouped by user, workspace, or model, with totals',
        auth: 'Admin',
        parameters: [
          { name: 'group_by', type: 'string', required: false, description: '"user" | "workspace" | "model"', location: 'query' },
          { name: 'date_from', type: 'string', required: false, description: 'ISO date', location: 'query' },
          { name: 'date_to', type: 'string', required: false, description: 'ISO date', location: 'query' },
        ],
      },
      {
        method: 'GET',
        path: '/api/admin/usage/pricing',
        description: 'The configured per-model pricing rates used to estimate cost',
        auth: 'Admin',
      },
      {
        method: 'GET',
        path: '/api/admin/usage/export',
        description: 'Export the usage report as CSV',
        auth: 'Admin',
      },
    ],
  },
  {
    id: 'websocket',
    name: 'WebSocket',
    description: 'Real-time streaming pipelines for RAG queries and comparisons',
    icon: 'Radio',
    color: '#f87171',
    endpoints: [
      {
        method: 'WS',
        path: '/api/ws/query',
        description: 'Streaming RAG query — real-time token, source, guardrail, and trust-score events',
        auth: 'Required',
      },
      {
        method: 'WS',
        path: '/api/ws/compare',
        description: 'Streaming side-by-side comparison run',
        auth: 'Required',
      },
    ],
  },
];

export const WS_PIPELINE_STAGES: WebSocketStage[] = [
  { id: 'auth', name: 'Auth', description: 'WebSocket authentication', icon: 'Lock', duration: '~50ms', status: 'idle' },
  { id: 'rewrite', name: 'Query Rewrite', description: 'Query expansion & reformulation', icon: 'Edit3', duration: '~100ms', status: 'active' },
  { id: 'search', name: 'Hybrid Search', description: 'Vector + keyword hybrid retrieval', icon: 'Search', duration: '~200ms', status: 'idle' },
  { id: 'rerank', name: 'Rerank', description: 'Cross-encoder relevance scoring', icon: 'ArrowUpDown', duration: '~150ms', status: 'idle' },
  { id: 'generate', name: 'Generation', description: 'LLM answer generation with citations', icon: 'Brain', duration: '~2s', status: 'idle' },
  { id: 'guardrail', name: 'Guardrail', description: 'Safety & hallucination check', icon: 'Shield', duration: '~100ms', status: 'idle' },
  { id: 'trust', name: 'Trust Score', description: 'Confidence & citation quality scoring', icon: 'Gauge', duration: '~50ms', status: 'idle' },
  { id: 'persist', name: 'Persist', description: 'Save query result to database', icon: 'Database', duration: '~50ms', status: 'idle' },
];

// BUG-44. Endpoint counts are derived from `API_GROUPS` itself so this can
// never go stale again the way the old hardcoded `28` did. There is no real
// uptime/SLA tracking in this app — a fabricated "99% uptime" stat is worse
// than no stat, so it isn't here; `groups` (a real, derived count) takes its
// place in the stat row.
export const CATALOG_STATS: CatalogStats = {
  httpEndpoints: API_GROUPS.reduce(
    (sum, group) => sum + group.endpoints.filter((ep) => ep.method !== 'WS').length,
    0,
  ),
  webSocketCount: API_GROUPS.reduce(
    (sum, group) => sum + group.endpoints.filter((ep) => ep.method === 'WS').length,
    0,
  ),
  backgroundJobs: 2, // ingestion pipeline + golden-set/prompt eval runner — both fire-and-forget, no polling endpoint of their own
  groups: API_GROUPS.length,
};

export const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-green/12 text-green border-green/28',
  POST: 'bg-primary/12 text-primary border-primary/28',
  PUT: 'bg-orange/12 text-orange border-orange/28',
  PATCH: 'bg-orange/12 text-orange border-orange/28',
  DELETE: 'bg-red/10 text-red border-red/28',
  WS: 'bg-accent/15 text-accent border-accent/30',
};
