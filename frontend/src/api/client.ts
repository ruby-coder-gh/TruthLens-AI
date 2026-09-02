import type {
  ActivityEntry,
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  User,
  Workspace,
  WorkspaceMember,
  Document,
  DocumentDetail,
  DocumentStatus,
  QuerySummary,
  QueryDetail,
  Feedback,
  AdminStats,
  AuditLogEntry,
  InvestigationRequest,
  InvestigationResponse,
  InvestigationSummary,
  InvestigationReviewUpdate,
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
  EvalRunResponse,
  EvalRunQueuedResponse,
  SearchResult,
  QueryComparison,
  ReviewQueueItem,
  ReviewQueueCount,
  Annotation,
  BulkDocumentAction,
  BulkDocumentResponse,
  QuarantinedChunk,
  QuarantineStatus,
  QuarantineActionResponse,
  GoldenPromoteRequest,
  GoldenEntryResponse,
  GoldenListResponse,
  UsageQueryParams,
  UsageReportResponse,
  PricingResponse,
  AuditLogFilters,
  AuditLogExportFormat,
  PromptVersion,
  PromptVersionCreate,
  PromptVersionStatus,
  PromptDiffResponse,
  PromptEvalQueued,
  ActivePrompt,
} from './types';

// ─── Configuration ──────────────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_URL || '/api';

// ─── Token management ───────────────────────────────────────────────────────
const ACCESS_KEY = 'veritas_access_token';
const REFRESH_KEY = 'veritas_refresh_token';

export function getStoredAccessToken(): string | null {
  return null;
}

export function setStoredTokens(access: string, refresh: string): void {
  // Tokens now live in HttpOnly cookies only.
  // Keep function for backward-compatible call sites and clear legacy storage.
  void access;
  void refresh;
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function clearStoredTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

// ─── Error type ─────────────────────────────────────────────────────────────
export class ApiError extends Error {
  status: number;
  detail?: string;
  /** Structured payload from the backend's error envelope
   *  (`{ error: { code, message, details } }`). Endpoints that fail with
   *  machine-readable context — e.g. the prompt promote gate's 409, which
   *  carries `{ reason, failed_metrics, thresholds, scores }` — surface it
   *  here; most errors leave it undefined. */
  details?: Record<string, unknown>;

  constructor(message: string, status: number, detail?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.details = details;
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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  return headers;
}

async function parseErrorResponse(res: Response): Promise<ApiError> {
  try {
    const body = await res.json() as Record<string, unknown>;
    const errorBody = body.error as Record<string, unknown> | undefined;
    const message = (errorBody?.message as string) || (body.detail as string) || (body.message as string) || `Request failed (${res.status})`;
    return new ApiError(
      message,
      res.status,
      body.detail as string | undefined,
      errorBody?.details as Record<string, unknown> | undefined,
    );
  } catch {
    return new ApiError(`Request failed (${res.status})`, res.status);
  }
}

// Blob-download endpoints mint their filename server-side (it usually embeds
// a UTC timestamp the client can't reproduce deterministically), so it must
// be read back off the response rather than hardcoded.
function parseFilenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const quotedMatch = /filename="([^"]+)"/i.exec(header);
  if (quotedMatch) return quotedMatch[1];
  const bareMatch = /filename=([^;]+)/i.exec(header);
  return bareMatch ? bareMatch[1].trim() : null;
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

export async function attemptTokenRefresh(): Promise<boolean> {
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        credentials: 'include',
      });
      if (!res.ok) {
        clearStoredTokens();
        return false;
      }
      await res.json().catch(() => null);
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

// Public/unauthenticated auth endpoints — these never carry a session to
// refresh, so a 401 from any of them is always the backend's real, specific
// error (invalid credentials, invalid/expired reset token, etc.), not an
// expired session. Attempting a refresh + generic "Session expired" message
// here would mask that real error (e.g. reset-password showing "Session
// expired. Please log in again." instead of "Invalid or expired reset token").
const PUBLIC_AUTH_PATHS = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
  '/auth/reset-password',
]);

// ─── Core request function (JSON) ───────────────────────────────────────────
async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = { ...getAuthHeaders(), ...(options.headers as Record<string, string> | undefined) };

  let res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  // Auto-refresh on 401 for authenticated flows only.
  // Keep the backend's real 401 message for public/unauthenticated auth endpoints.
  if (res.status === 401 && !PUBLIC_AUTH_PATHS.has(path)) {
    const refreshed = await attemptTokenRefresh();
    if (refreshed) {
      res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
        credentials: 'include',
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

  let res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });

  if (res.status === 401) {
    const refreshed = await attemptTokenRefresh();
    if (refreshed) {
      res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
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

  refresh: (refreshToken?: string): Promise<AuthResponse> =>
    request('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify(refreshToken ? { refresh_token: refreshToken } : {}),
    }),

  me: (): Promise<User> =>
    request('/auth/me'),

  updateMe: (data: UpdateUserRequest): Promise<User> =>
    request('/auth/me', { method: 'PUT', body: JSON.stringify(data) }),

  deleteMe: (): Promise<void> =>
    request('/auth/me', { method: 'DELETE' }),

  forgotPassword: (data: { email: string }): Promise<void> =>
    request('/auth/forgot-password', { method: 'POST', body: JSON.stringify(data) }),

  resetPassword: (data: { token: string; password: string }): Promise<void> =>
    request('/auth/reset-password', { method: 'POST', body: JSON.stringify(data) }),

  changePassword: (data: { current_password: string; new_password: string }): Promise<void> =>
    request('/auth/change-password', { method: 'POST', body: JSON.stringify(data) }),

  logout: (): Promise<void> =>
    request('/auth/logout', { method: 'POST' }),
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
    request(`/workspaces/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

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

  getDetail: (workspaceId: string, documentId: string): Promise<DocumentDetail> =>
    request(`/workspaces/${workspaceId}/documents/${documentId}`),

  status: (workspaceId: string, documentId: string): Promise<DocumentStatus> =>
    request(`/workspaces/${workspaceId}/documents/${documentId}/status`),

  delete: (workspaceId: string, documentId: string): Promise<void> =>
    request(`/workspaces/${workspaceId}/documents/${documentId}`, { method: 'DELETE' }),

  listAll: (params?: { status?: string; search?: string; file_type?: string; tags?: string; page?: number; page_size?: number }): Promise<PaginatedResponse<Document>> =>
    request(`/documents${buildQuery(params as Record<string, unknown> | undefined)}`),

  reindex: (workspaceId: string, docId: string): Promise<void> =>
    request(`/workspaces/${workspaceId}/documents/${docId}/reindex`, { method: 'POST' }),

  bulk: (action: BulkDocumentAction, documentIds: string[], tags?: string[]): Promise<BulkDocumentResponse> =>
    request('/admin/documents/bulk', {
      method: 'POST',
      body: JSON.stringify({ action, document_ids: documentIds, ...(tags ? { tags } : {}) }),
    }),
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

  pin: (workspaceId: string, queryId: string): Promise<unknown> =>
    request(`/workspaces/${workspaceId}/queries/${queryId}/pin`, { method: 'POST' }),

  unpin: (workspaceId: string, queryId: string): Promise<void> =>
    request(`/workspaces/${workspaceId}/queries/${queryId}/pin`, { method: 'DELETE' }),

  compare: (workspaceId: string, queryId: string): Promise<QueryComparison> =>
    request(`/workspaces/${workspaceId}/queries/${queryId}/compare`, { method: 'POST' }),

  listAll: (params?: { pinned?: boolean; page?: number; page_size?: number }): Promise<PaginatedResponse<QuerySummary>> =>
    request(`/queries${buildQuery(params as Record<string, unknown> | undefined)}`),

  // Bespoke fetch — response is raw markdown (Content-Disposition attachment),
  // not JSON, so it can't go through the JSON-locked `request()` helper.
  exportMarkdown: async (queryId: string): Promise<{ blob: Blob; filename: string }> => {
    const res = await fetch(`${API_BASE}/queries/${queryId}/export`, { credentials: 'include' });
    if (!res.ok) throw new ApiError(`Export failed (${res.status})`, res.status);
    return { blob: await res.blob(), filename: `truthlens-query-${queryId}.md` };
  },
};

// ─── Global Search API ──────────────────────────────────────────────────────
export const searchApi = {
  search: (params: { q: string; page?: number; page_size?: number; per_workspace?: number }): Promise<PaginatedResponse<SearchResult>> =>
    request(`/search${buildQuery(params)}`),
};

// ─── Confidence Review Queue API ────────────────────────────────────────────
export const reviewQueueApi = {
  list: (workspaceId: string, params?: { page?: number; page_size?: number }): Promise<PaginatedResponse<ReviewQueueItem>> =>
    request(`/workspaces/${workspaceId}/review-queue${buildQuery(params as Record<string, unknown> | undefined)}`),
  count: (workspaceId: string): Promise<ReviewQueueCount> =>
    request(`/workspaces/${workspaceId}/review-queue/count`),
  review: (workspaceId: string, queryId: string, data: { review_status: 'needs_review' | 'reviewed' | 'dismissed'; review_note?: string }): Promise<ReviewQueueItem> =>
    request(`/workspaces/${workspaceId}/review-queue/${queryId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  settings: (workspaceId: string, reviewQueueEnabled: boolean): Promise<{ review_queue_enabled: boolean }> =>
    request(`/workspaces/${workspaceId}/review-queue/settings`, { method: 'PATCH', body: JSON.stringify({ review_queue_enabled: reviewQueueEnabled }) }),

  // ─── F7b — promote a reviewed answer into the golden set ─────────────────
  promoteGolden: (workspaceId: string, queryId: string, data: GoldenPromoteRequest): Promise<GoldenEntryResponse> =>
    request(`/workspaces/${workspaceId}/review-queue/${queryId}/promote-golden`, { method: 'POST', body: JSON.stringify(data) }),

  // ─── F7a — ingest-time injection quarantine ──────────────────────────────
  quarantine: {
    list: (workspaceId: string, params?: { status?: QuarantineStatus; page?: number; page_size?: number }): Promise<PaginatedResponse<QuarantinedChunk>> =>
      request(`/workspaces/${workspaceId}/review-queue/quarantine${buildQuery(params as Record<string, unknown> | undefined)}`),
    release: (workspaceId: string, quarantineId: string): Promise<QuarantineActionResponse> =>
      request(`/workspaces/${workspaceId}/review-queue/quarantine/${quarantineId}/release`, { method: 'POST' }),
    dismiss: (workspaceId: string, quarantineId: string): Promise<QuarantineActionResponse> =>
      request(`/workspaces/${workspaceId}/review-queue/quarantine/${quarantineId}/dismiss`, { method: 'POST' }),
  },
};

// ─── Collaborative Annotations API ──────────────────────────────────────────
export const annotationApi = {
  list: (workspaceId: string, queryId: string, params?: { source_id?: string; answer_only?: boolean }): Promise<ListResponse<Annotation>> =>
    request(`/workspaces/${workspaceId}/queries/${queryId}/annotations${buildQuery(params as Record<string, unknown> | undefined)}`),
  count: (workspaceId: string, queryId: string, params?: { source_id?: string; answer_only?: boolean }): Promise<{ count: number }> =>
    request(`/workspaces/${workspaceId}/queries/${queryId}/annotations/count${buildQuery(params as Record<string, unknown> | undefined)}`),
  create: (workspaceId: string, queryId: string, data: { body: string; source_id?: string }): Promise<Annotation> =>
    request(`/workspaces/${workspaceId}/queries/${queryId}/annotations`, { method: 'POST', body: JSON.stringify(data) }),
  update: (workspaceId: string, queryId: string, annotationId: string, body: string): Promise<Annotation> =>
    request(`/workspaces/${workspaceId}/queries/${queryId}/annotations/${annotationId}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  delete: (workspaceId: string, queryId: string, annotationId: string): Promise<Annotation> =>
    request(`/workspaces/${workspaceId}/queries/${queryId}/annotations/${annotationId}`, { method: 'DELETE' }),
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

// ─── Admin prompt-version API (F1) ──────────────────────────────────────────
// Declared above `adminApi` because that object literal references it eagerly
// (a `const` declared further down would be in its temporal dead zone).
const adminPromptsApi = {
  list: (params?: { name?: string; status?: PromptVersionStatus }): Promise<ListResponse<PromptVersion>> =>
    request(`/admin/prompts${buildQuery(params as Record<string, unknown> | undefined)}`),

  get: (id: string): Promise<PromptVersion> =>
    request(`/admin/prompts/${id}`),

  active: (name = 'answer'): Promise<ActivePrompt> =>
    request(`/admin/prompts/active${buildQuery({ name })}`),

  create: (body: PromptVersionCreate): Promise<PromptVersion> =>
    request('/admin/prompts', { method: 'POST', body: JSON.stringify(body) }),

  // 202 — the golden-set run happens in the background. Poll `get(id)` and
  // watch `eval.status` flip off `running`.
  evaluate: (id: string, subset: 'smoke' | 'full' = 'smoke'): Promise<PromptEvalQueued> =>
    request(`/admin/prompts/${id}/evaluate${buildQuery({ subset })}`, { method: 'POST' }),

  // 409 when the eval gate refuses; `ApiError.details` then carries
  // `{ reason, failed_metrics, thresholds, scores }`.
  promote: (id: string, force = false): Promise<PromptVersion> =>
    request(`/admin/prompts/${id}/promote${buildQuery(force ? { force: true } : undefined)}`, { method: 'POST' }),

  rollback: (id: string): Promise<PromptVersion> =>
    request(`/admin/prompts/${id}/rollback`, { method: 'POST' }),

  remove: (id: string): Promise<void> =>
    request(`/admin/prompts/${id}`, { method: 'DELETE' }),

  diff: (id: string, against = 'active'): Promise<PromptDiffResponse> =>
    request(`/admin/prompts/${id}/diff${buildQuery({ against })}`),
};

// ─── SEC-2 — golden-entry approval workflow ─────────────────────────────────
// Declared above `adminApi` for the same reason as `adminPromptsApi`: the
// object literal below assigns it eagerly (`golden: adminGoldenApi`), which
// needs the binding initialized first.
const adminGoldenApi = {
  list: (params?: { source?: 'builtin' | 'promoted' | 'all'; status?: 'pending' | 'approved'; page?: number; page_size?: number }): Promise<GoldenListResponse> =>
    request(`/admin/golden${buildQuery(params as Record<string, unknown> | undefined)}`),

  approve: (entryId: string): Promise<GoldenEntryResponse> =>
    request(`/admin/golden/${entryId}/approve`, { method: 'POST' }),

  remove: (entryId: string): Promise<void> =>
    request(`/admin/golden/${entryId}`, { method: 'DELETE' }),
};

// ─── Admin API ──────────────────────────────────────────────────────────────
export const adminApi = {
  prompts: adminPromptsApi,

  stats: (): Promise<AdminStats> =>
    request('/admin/stats'),

  logs: (params?: AuditLogFilters): Promise<PaginatedResponse<AuditLogEntry>> =>
    request(`/admin/logs${buildQuery(params as Record<string, unknown> | undefined)}`),

  evaluation: <T = unknown>(): Promise<T> =>
    request('/admin/evaluation'),

  // Kicks off an async golden-set run; the server responds 202 with a
  // `{ status: "queued", ... }` payload immediately. Results land later in
  // `getEvalHistory` — callers should not expect metrics back synchronously.
  // Generic defaults to the queued-response shape but stays overridable for
  // existing call sites written against the old (synchronous) contract.
  runEvaluation: <T = EvalRunQueuedResponse>(): Promise<T> =>
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
  getEvalHistory: (params?: { page?: number; page_size?: number }): Promise<PaginatedResponse<EvalRunResponse>> =>
    request(`/admin/evaluation/history${buildQuery(params as Record<string, unknown> | undefined)}`),

  // ── Settings ─────────────────────────────────────────────────────────────
  getSettings: (): Promise<Record<string, unknown>> =>
    request('/admin/settings'),

  updateSettings: (data: Record<string, unknown>): Promise<Record<string, unknown>> =>
    request('/admin/settings', { method: 'PUT', body: JSON.stringify(data) }),

  // ── F7a — cross-workspace quarantine list ────────────────────────────────
  getQuarantine: (params?: { status?: QuarantineStatus; workspace_id?: string; page?: number; page_size?: number }): Promise<PaginatedResponse<QuarantinedChunk>> =>
    request(`/admin/quarantine${buildQuery(params as Record<string, unknown> | undefined)}`),

  // ── F7b/SEC-2 — golden-set inventory + approval ──────────────────────────
  golden: adminGoldenApi,

  // Legacy flat accessors — kept for existing call sites (AdminAnalyticsPage);
  // prefer `golden.list` / `golden.remove` in new code. Same implementation,
  // not a duplicate.
  getGolden: adminGoldenApi.list,
  deleteGolden: adminGoldenApi.remove,

  // ── Usage & cost reporting ───────────────────────────────────────────────
  getUsage: (params?: UsageQueryParams): Promise<UsageReportResponse> =>
    request(`/admin/usage${buildQuery(params as Record<string, unknown> | undefined)}`),

  getUsagePricing: (): Promise<PricingResponse> =>
    request('/admin/usage/pricing'),

  // Bespoke fetch — CSV blob (Content-Disposition attachment), not JSON, so
  // it can't go through the JSON-locked `request()` helper.
  exportUsage: async (params?: UsageQueryParams): Promise<{ blob: Blob; filename: string }> => {
    const query = buildQuery({ format: 'csv', ...(params as Record<string, unknown> | undefined) });
    const res = await fetch(`${API_BASE}/admin/usage/export${query}`, { credentials: 'include' });
    if (!res.ok) throw await parseErrorResponse(res);
    const blob = await res.blob();
    const filename = parseFilenameFromContentDisposition(res.headers.get('Content-Disposition'))
      ?? `usage-${params?.group_by ?? 'model'}-export.csv`;
    return { blob, filename };
  },

  // ── Audit log export ─────────────────────────────────────────────────────
  // Bespoke fetch — CSV/JSON blob (Content-Disposition attachment).
  exportLogs: async (
    format: AuditLogExportFormat,
    filters?: AuditLogFilters,
  ): Promise<{ blob: Blob; filename: string }> => {
    const query = buildQuery({ format, ...(filters as Record<string, unknown> | undefined) });
    const res = await fetch(`${API_BASE}/admin/logs/export${query}`, { credentials: 'include' });
    if (!res.ok) throw await parseErrorResponse(res);
    const blob = await res.blob();
    const filename = parseFilenameFromContentDisposition(res.headers.get('Content-Disposition'))
      ?? `audit-log-export.${format}`;
    return { blob, filename };
  },
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

  list: (workspaceId: string, params?: { page?: number; page_size?: number }): Promise<PaginatedResponse<InvestigationSummary>> =>
    request(`/workspaces/${workspaceId}/investigations${buildQuery(params as Record<string, unknown> | undefined)}`),

  get: (workspaceId: string, investigationId: string): Promise<InvestigationResponse> =>
    request(`/workspaces/${workspaceId}/investigations/${investigationId}`),

  review: (workspaceId: string, investigationId: string, data: InvestigationReviewUpdate): Promise<InvestigationResponse> =>
    request(`/workspaces/${workspaceId}/investigations/${investigationId}/review`, { method: 'PATCH', body: JSON.stringify(data) }),

  exportAuditBundle: async (workspaceId: string, investigationId: string): Promise<{ blob: Blob; filename: string }> => {
    const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/investigations/${investigationId}/export`, { credentials: 'include' });
    if (!res.ok) throw await parseErrorResponse(res);
    return { blob: await res.blob(), filename: `truthlens-audit-${investigationId}.zip` };
  },
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
  search: searchApi,
  reviewQueue: reviewQueueApi,
  annotations: annotationApi,
};
