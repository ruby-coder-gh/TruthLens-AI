import type {
  ActivityEntry,
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  User,
  Workspace,
  WorkspaceMember,
  Document,
  DocumentStatus,
  QuerySummary,
  QueryDetail,
  Feedback,
  AdminStats,
  AuditLogEntry,
  Collection,
  InvestigationRequest,
  InvestigationResponse,
  PaginatedResponse,
  ListResponse,
  CreateWorkspaceRequest,
  UpdateWorkspaceRequest,
  AddMemberRequest,
  SubmitFeedbackRequest,
  UpdateUserRequest,
  ComparisonSummary,
  ComparisonDetail,
  ComparisonCreateRequest,
  ComparisonCreateResponse,
} from './types';

// ─── Configuration ──────────────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_URL || '/api';

// ─── Token management ───────────────────────────────────────────────────────
const ACCESS_KEY = 'veritas_access_token';
const REFRESH_KEY = 'veritas_refresh_token';

export function getStoredAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

function getStoredRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function setStoredTokens(access: string, refresh: string): void {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearStoredTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

// ─── Error type ─────────────────────────────────────────────────────────────
export class ApiError extends Error {
  status: number;
  detail?: string;

  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function buildQuery(params?: Record<string, unknown>): string {
  if (!params) return '';
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.append(key, String(value));
    }
  }
  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
}

function getAuthHeaders(): Record<string, string> {
  const token = getStoredAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function parseErrorResponse(res: Response): Promise<ApiError> {
  try {
    const body = await res.json() as Record<string, unknown>;
    const errorBody = body.error as Record<string, unknown> | undefined;
    const message = (errorBody?.message as string) || (body.detail as string) || (body.message as string) || `Request failed (${res.status})`;
    return new ApiError(message, res.status, body.detail as string | undefined);
  } catch {
    return new ApiError(`Request failed (${res.status})`, res.status);
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

// ─── Token refresh (with dedup) ─────────────────────────────────────────────
let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;
let refreshSubscribers: Array<(token: string) => void> = [];

function onRefreshed(token: string): void {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

async function attemptTokenRefresh(): Promise<boolean> {
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return false;

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) {
        clearStoredTokens();
        return false;
      }
      const data = (await res.json()) as AuthResponse;
      setStoredTokens(data.access_token, data.refresh_token);
      onRefreshed(data.access_token);
      return true;
    } catch {
      clearStoredTokens();
      return false;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// ─── Core request function (JSON) ───────────────────────────────────────────
async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = { ...getAuthHeaders(), ...(options.headers as Record<string, string> | undefined) };

  let res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  // Auto-refresh on 401
  if (res.status === 401) {
    const refreshed = await attemptTokenRefresh();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${getStoredAccessToken()}`;
      res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
      });
    } else {
      clearStoredTokens();
      throw new ApiError(
        'Session expired. Please log in again.',
        401,
        'token_expired',
      );
    }
  }

  return handleResponse<T>(res);
}

// ─── Core request function (FormData / file upload) ─────────────────────────
async function uploadFile<T>(path: string, file: File): Promise<T> {
  const formData = new FormData();
  formData.append('file', file);

  const token = getStoredAccessToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  // Do NOT set Content-Type — browser sets it with boundary for FormData

  let res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (res.status === 401) {
    const refreshed = await attemptTokenRefresh();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${getStoredAccessToken()}`;
      res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers,
        body: formData,
      });
    } else {
      clearStoredTokens();
      throw new ApiError('Session expired. Please log in again.', 401, 'token_expired');
    }
  }

  return handleResponse<T>(res);
}

// ─── Auth API ───────────────────────────────────────────────────────────────
export const authApi = {
  register: (data: RegisterRequest): Promise<AuthResponse> =>
    request('/auth/register', { method: 'POST', body: JSON.stringify(data) }),

  login: (data: LoginRequest): Promise<AuthResponse> =>
    request('/auth/login', { method: 'POST', body: JSON.stringify(data) }),

  refresh: (refreshToken: string): Promise<AuthResponse> =>
    request('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    }),

  me: (): Promise<User> =>
    request('/auth/me'),

  updateMe: (data: UpdateUserRequest): Promise<User> =>
    request('/auth/me', { method: 'PATCH', body: JSON.stringify(data) }),

  deleteMe: (): Promise<void> =>
    request('/auth/me', { method: 'DELETE' }),

  forgotPassword: (data: { email: string }): Promise<void> =>
    request('/auth/forgot-password', { method: 'POST', body: JSON.stringify(data) }),

  resetPassword: (data: { token: string; password: string }): Promise<void> =>
    request('/auth/reset-password', { method: 'POST', body: JSON.stringify(data) }),

  changePassword: (data: { current_password: string; new_password: string }): Promise<void> =>
    request('/auth/change-password', { method: 'POST', body: JSON.stringify(data) }),

  logout: (data?: { refresh_token?: string }): Promise<void> =>
    request('/auth/logout', { method: 'POST', body: JSON.stringify(data || {}) }),
};

// ─── Workspace API ──────────────────────────────────────────────────────────
export const workspaceApi = {
  list: (): Promise<ListResponse<Workspace>> =>
    request('/workspaces'),

  create: (data: CreateWorkspaceRequest): Promise<Workspace> =>
    request('/workspaces', { method: 'POST', body: JSON.stringify(data) }),

  get: (id: string): Promise<Workspace> =>
    request(`/workspaces/${id}`),

  update: (id: string, data: UpdateWorkspaceRequest): Promise<Workspace> =>
    request(`/workspaces/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  delete: (id: string): Promise<void> =>
    request(`/workspaces/${id}`, { method: 'DELETE' }),

  listMembers: (id: string): Promise<ListResponse<WorkspaceMember>> =>
    request(`/workspaces/${id}/members`),

  addMember: (id: string, data: AddMemberRequest): Promise<WorkspaceMember> =>
    request(`/workspaces/${id}/members`, { method: 'POST', body: JSON.stringify(data) }),

  removeMember: (workspaceId: string, userId: string): Promise<void> =>
    request(`/workspaces/${workspaceId}/members/${userId}`, { method: 'DELETE' }),

  activity: (id: string): Promise<ListResponse<ActivityEntry>> =>
    request(`/workspaces/${id}/activity`),
};

// ─── Document API ───────────────────────────────────────────────────────────
export const documentApi = {
  list: (workspaceId: string): Promise<ListResponse<Document>> =>
    request(`/workspaces/${workspaceId}/documents`),

  upload: (workspaceId: string, file: File): Promise<Document> =>
    uploadFile(`/workspaces/${workspaceId}/documents`, file),

  get: (workspaceId: string, documentId: string): Promise<Document> =>
    request(`/workspaces/${workspaceId}/documents/${documentId}`),

  status: (workspaceId: string, documentId: string): Promise<DocumentStatus> =>
    request(`/workspaces/${workspaceId}/documents/${documentId}/status`),

  delete: (workspaceId: string, documentId: string): Promise<void> =>
    request(`/workspaces/${workspaceId}/documents/${documentId}`, { method: 'DELETE' }),

  listAll: (params?: { status?: string; page?: number; page_size?: number }): Promise<PaginatedResponse<Document>> =>
    request(`/documents${buildQuery(params as Record<string, unknown> | undefined)}`),

  reindex: (workspaceId: string, docId: string): Promise<void> =>
    request(`/workspaces/${workspaceId}/documents/${docId}/reindex`, { method: 'POST' }),
};

// ─── Query API ──────────────────────────────────────────────────────────────
export const queryApi = {
  list: (
    workspaceId: string,
    params?: Record<string, unknown>,
  ): Promise<PaginatedResponse<QuerySummary>> =>
    request(`/workspaces/${workspaceId}/queries${buildQuery(params)}`),

  get: (workspaceId: string, queryId: string): Promise<QueryDetail> =>
    request(`/workspaces/${workspaceId}/queries/${queryId}`),

  getAnywhere: (queryId: string): Promise<QueryDetail> =>
    request(`/queries/${queryId}`),

  delete: (workspaceId: string, queryId: string): Promise<void> =>
    request(`/workspaces/${workspaceId}/queries/${queryId}`, { method: 'DELETE' }),

  listAll: (params?: { page?: number; page_size?: number }): Promise<PaginatedResponse<QuerySummary>> =>
    request(`/queries${buildQuery(params as Record<string, unknown> | undefined)}`),
};

// ─── Comparison API ─────────────────────────────────────────────────────────
export const comparisonApi = {
  create: (
    workspaceId: string,
    data: ComparisonCreateRequest,
  ): Promise<ComparisonCreateResponse> =>
    request(`/workspaces/${workspaceId}/comparisons`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  list: (
    workspaceId: string,
    params?: { page?: number; page_size?: number },
  ): Promise<PaginatedResponse<ComparisonSummary>> =>
    request(`/workspaces/${workspaceId}/comparisons${buildQuery(params as Record<string, unknown> | undefined)}`),

  get: (workspaceId: string, comparisonId: string): Promise<ComparisonDetail> =>
    request(`/workspaces/${workspaceId}/comparisons/${comparisonId}`),

  delete: (workspaceId: string, comparisonId: string): Promise<void> =>
    request(`/workspaces/${workspaceId}/comparisons/${comparisonId}`, { method: 'DELETE' }),
};

// ─── Feedback API ───────────────────────────────────────────────────────────
export const feedbackApi = {
  submit: (queryId: string, data: SubmitFeedbackRequest): Promise<Feedback> =>
    request(`/queries/${queryId}/feedback`, { method: 'POST', body: JSON.stringify(data) }),

  list: (queryId: string): Promise<ListResponse<Feedback>> =>
    request(`/queries/${queryId}/feedback`),
};

// ─── Admin API ──────────────────────────────────────────────────────────────
export const adminApi = {
  stats: (): Promise<AdminStats> =>
    request('/admin/stats'),

  logs: (params?: Record<string, unknown>): Promise<PaginatedResponse<AuditLogEntry>> =>
    request(`/admin/logs${buildQuery(params)}`),

  evaluation: <T = unknown>(): Promise<T> =>
    request('/admin/evaluation'),

  runEvaluation: <T = unknown>(): Promise<T> =>
    request('/admin/evaluation/run', { method: 'POST' }),

  // ── User management ──────────────────────────────────────────────────────
  listUsers: (params?: { page?: number; page_size?: number }): Promise<PaginatedResponse<User>> =>
    request(`/admin/users${buildQuery(params as Record<string, unknown> | undefined)}`),

  inviteUser: (data: { email: string; username: string; role?: string }): Promise<User> =>
    request('/admin/users/invite', { method: 'POST', body: JSON.stringify(data) }),

  getUser: (userId: string): Promise<User> =>
    request(`/admin/users/${userId}`),

  updateUserRole: (userId: string, role: string): Promise<User> =>
    request(`/admin/users/${userId}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),

  updateUserStatus: (userId: string, isActive: boolean): Promise<User> =>
    request(`/admin/users/${userId}/status`, { method: 'PUT', body: JSON.stringify({ is_active: isActive }) }),

  deleteUser: (userId: string): Promise<void> =>
    request(`/admin/users/${userId}`, { method: 'DELETE' }),

  getUserActivity: (userId: string, params?: { page?: number; page_size?: number }): Promise<PaginatedResponse<AuditLogEntry>> =>
    request(`/admin/users/${userId}/activity${buildQuery(params as Record<string, unknown> | undefined)}`),

  // ── Analytics ────────────────────────────────────────────────────────────
  getFlaggedAnswers: (params?: { page?: number; page_size?: number }): Promise<PaginatedResponse<unknown>> =>
    request(`/admin/analytics/flagged-answers${buildQuery(params as Record<string, unknown> | undefined)}`),

  getQueriesOverTime: (): Promise<unknown> =>
    request('/admin/analytics/queries-over-time'),

  getTrustScoreDistribution: (): Promise<unknown> =>
    request('/admin/analytics/trust-score-distribution'),

  // ── Evaluation ───────────────────────────────────────────────────────────
  getEvalHistory: (params?: { page?: number; page_size?: number }): Promise<PaginatedResponse<unknown>> =>
    request(`/admin/evaluation/history${buildQuery(params as Record<string, unknown> | undefined)}`),

  // ── Settings ─────────────────────────────────────────────────────────────
  getSettings: (): Promise<Record<string, unknown>> =>
    request('/admin/settings'),

  updateSettings: (data: Record<string, unknown>): Promise<Record<string, unknown>> =>
    request('/admin/settings', { method: 'PUT', body: JSON.stringify(data) }),
};

// ─── Collection API ─────────────────────────────────────────────────────────
export const collectionApi = {
  list: (workspaceId: string): Promise<ListResponse<unknown>> =>
    request(`/workspaces/${workspaceId}/collections`),

  create: (workspaceId: string, data: { name: string; description?: string }): Promise<unknown> =>
    request(`/workspaces/${workspaceId}/collections`, { method: 'POST', body: JSON.stringify(data) }),

  get: (workspaceId: string, collectionId: string): Promise<unknown> =>
    request(`/workspaces/${workspaceId}/collections/${collectionId}`),

  update: (workspaceId: string, collectionId: string, data: { name?: string; description?: string }): Promise<unknown> =>
    request(`/workspaces/${workspaceId}/collections/${collectionId}`, { method: 'PUT', body: JSON.stringify(data) }),

  delete: (workspaceId: string, collectionId: string): Promise<void> =>
    request(`/workspaces/${workspaceId}/collections/${collectionId}`, { method: 'DELETE' }),

  grantAccess: (workspaceId: string, collectionId: string, userId: string): Promise<unknown> =>
    request(`/workspaces/${workspaceId}/collections/${collectionId}/access`, { method: 'POST', body: JSON.stringify({ user_id: userId }) }),

  revokeAccess: (workspaceId: string, collectionId: string, userId: string): Promise<void> =>
    request(`/workspaces/${workspaceId}/collections/${collectionId}/access/${userId}`, { method: 'DELETE' }),

  listAccess: (workspaceId: string, collectionId: string): Promise<ListResponse<unknown>> =>
    request(`/workspaces/${workspaceId}/collections/${collectionId}/access`),
};

// ─── Investigation API ──────────────────────────────────────────────────────
export const investigationApi = {
  run: (workspaceId: string, data: InvestigationRequest): Promise<InvestigationResponse> =>
    request(`/workspaces/${workspaceId}/investigate`, { method: 'POST', body: JSON.stringify(data) }),
};

// ─── Unified API object ─────────────────────────────────────────────────────
export const api = {
  auth: authApi,
  workspaces: workspaceApi,
  documents: documentApi,
  queries: queryApi,
  feedback: feedbackApi,
  admin: adminApi,
  investigation: investigationApi,
  collections: collectionApi,
  comparisons: comparisonApi,
};
