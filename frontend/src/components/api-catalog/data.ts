import type { ApiGroup, WebSocketStage, CatalogStats } from './types';

export const API_GROUPS: ApiGroup[] = [
  {
    id: 'auth',
    name: 'Authentication',
    description: 'User registration, login, token management, and session handling',
    icon: 'LogIn',
    color: '#7c5cff',
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
    ],
  },
  {
    id: 'users',
    name: 'Users',
    description: 'User management and administration — admin only',
    icon: 'Users',
    color: '#38bdf8',
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
    description: 'Workspace CRUD, member management, and collaboration',
    icon: 'LayoutDashboard',
    color: '#2dd4bf',
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
        method: 'PATCH',
        path: '/api/workspaces/{id}',
        description: 'Update workspace name, description, or settings',
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
        description: 'Add a member to the workspace',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'user_id', type: 'string', required: true, description: 'User ID to add', location: 'body' },
          { name: 'role', type: 'string', required: false, description: 'Member role (viewer/editor/admin)', location: 'body' },
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
    ],
  },
  {
    id: 'documents',
    name: 'Documents',
    description: 'Document upload, ingestion pipeline, and content management',
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
        description: 'Upload a document for ingestion (PDF, TXT, MD, DOCX)',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'file', type: 'file', required: true, description: 'Document file (multipart upload)', location: 'body' },
        ],
      },
      {
        method: 'GET',
        path: '/api/workspaces/{id}/documents/{docId}',
        description: 'Get document metadata and ingestion status',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'docId', type: 'string', required: true, description: 'Document ID', location: 'path' },
        ],
      },
      {
        method: 'GET',
        path: '/api/workspaces/{id}/documents/{docId}/status',
        description: 'Get detailed document ingestion pipeline status',
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
    ],
  },
  {
    id: 'queries',
    name: 'Queries',
    description: 'RAG query execution, history, and streaming responses',
    icon: 'MessageSquare',
    color: '#a78bfa',
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
        description: 'List query history with pagination and filters',
        auth: 'Required',
        parameters: [
          { name: 'id', type: 'string', required: true, description: 'Workspace ID', location: 'path' },
          { name: 'page', type: 'integer', required: false, description: 'Page number', location: 'query' },
          { name: 'limit', type: 'integer', required: false, description: 'Items per page', location: 'query' },
        ],
      },
      {
        method: 'GET',
        path: '/api/workspaces/{id}/queries/{queryId}',
        description: 'Get full query details, answer, and sources',
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
    id: 'investigation',
    name: 'Investigation',
    description: 'Deep multi-step investigative analysis across documents',
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
    ],
  },
  {
    id: 'feedback',
    name: 'Feedback',
    description: 'Query feedback submission and evaluation management',
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
        parameters: [
          { name: 'queryId', type: 'string', required: true, description: 'Query ID', location: 'path' },
        ],
      },
    ],
  },
  {
    id: 'admin',
    name: 'Admin',
    description: 'System administration, monitoring, and evaluation',
    icon: 'Shield',
    color: '#f87171',
    endpoints: [
      {
        method: 'GET',
        path: '/api/admin/stats',
        description: 'Get comprehensive system statistics and health metrics',
        auth: 'Admin',
      },
      {
        method: 'GET',
        path: '/api/admin/logs',
        description: 'Retrieve paginated system audit logs',
        auth: 'Admin',
        parameters: [
          { name: 'page', type: 'integer', required: false, description: 'Page number', location: 'query' },
          { name: 'limit', type: 'integer', required: false, description: 'Items per page', location: 'query' },
        ],
      },
      {
        method: 'GET',
        path: '/api/admin/evaluation',
        description: 'Get RAG evaluation metrics and benchmark results',
        auth: 'Admin',
      },
      {
        method: 'POST',
        path: '/api/admin/evaluation/run',
        description: 'Trigger a new evaluation run against the test suite',
        auth: 'Admin',
      },
    ],
  },
  {
    id: 'websocket',
    name: 'WebSocket',
    description: 'Real-time streaming pipeline for RAG query execution',
    icon: 'Radio',
    color: '#2dd4bf',
    endpoints: [
      {
        method: 'WS',
        path: 'ws://localhost:8000/ws',
        description: 'WebSocket endpoint for streaming RAG queries with real-time token, source, and pipeline events',
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

export const CATALOG_STATS: CatalogStats = {
  httpEndpoints: 28,
  webSocketCount: 1,
  backgroundJobs: 2,
  uptime: 100,
};

export const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-green-500/15 text-green-400 border-green-500/30',
  POST: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  PUT: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  PATCH: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  DELETE: 'bg-red-500/15 text-red-400 border-red-500/30',
  WS: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
};
