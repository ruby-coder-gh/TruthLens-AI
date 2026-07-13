// ─── Auth ───────────────────────────────────────────────────────────────────
export interface User {
  id: string;
  email: string;
  username: string;
  role: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuthResponse {
  user: User;
  token_type: string;
  expires_in: number;
  message: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
}

// ─── Workspace ──────────────────────────────────────────────────────────────
export interface Workspace {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  member_count: number;
  document_count: number;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  member_count: number;
  document_count: number;
  created_at: string;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: string;
  username: string;
  email: string;
  joined_at: string;
}

// ─── Document ───────────────────────────────────────────────────────────────
export interface Document {
  id: string;
  workspace_id: string;
  filename: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  page_count?: number;
  chunk_count?: number;
  status: string;
  error_message?: string;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
}

export interface DocumentStatus {
  id: string;
  status: string;
  chunk_count?: number;
  error_message?: string;
}

// ─── Query ──────────────────────────────────────────────────────────────────
export interface QuerySummary {
  id: string;
  workspace_id: string;
  query_text: string;
  trust_score?: number;
  guardrail_passed?: boolean;
  model_used?: string;
  created_at: string;
}

export interface QueryDetail {
  id: string;
  workspace_id: string;
  query_text: string;
  rewritten_query?: string;
  response_text?: string;
  response_sources?: Source[];
  trust_score?: number;
  guardrail_score?: number;
  guardrail_passed?: boolean;
  model_used?: string;
  latency_ms?: number;
  token_count?: number;
  created_at: string;
}

export interface Source {
  chunk_id: string;
  document_id: string;
  document_name?: string;
  excerpt: string;
  relevance_score: number;
  rerank_score?: number;
  page_number?: number;
  confidence?: number;
  matched_chunks?: number;
  explanation?: string;
  updated_at?: string;
  file_type?: string;
}

// ─── Feedback ───────────────────────────────────────────────────────────────
export interface Feedback {
  id: string;
  query_id: string;
  user_id: string;
  rating: number;
  comment?: string;
  created_at: string;
}

// ─── Admin ──────────────────────────────────────────────────────────────────
export interface AdminStats {
  total_users: number;
  total_workspaces: number;
  total_documents: number;
  total_queries: number;
  total_chunks: number;
  avg_trust_score?: number;
  avg_rating?: number;
  total_feedback: number;
}

export interface AuditLogEntry {
  id: string;
  user_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  details?: Record<string, unknown>;
  ip_address?: string;
  created_at: string;
}

// ─── Investigation ──────────────────────────────────────────────────────────
export interface InvestigationRequest {
  query: string;
  top_k?: number;
  filters?: Record<string, unknown>;
}

export interface InvestigationResponse {
  final_report: string;
  trust_score?: number;
  trust_components?: Record<string, number>;
  reasoning_trace?: string[];
  sub_questions?: string[];
  latency_ms: number;
  error?: string;
}

// ─── Comparison ──────────────────────────────────────────────────────────────
export interface ComparisonSource {
  chunk_id: string;
  document_id: string;
  document_name: string;
  excerpt: string;
  relevance_score: number;
  rerank_score?: number;
  confidence?: number;
  matched_chunks?: number;
}

export interface ComparisonResult {
  id: string;
  document_id: string;
  document_name: string;
  answer_text: string;
  sources: ComparisonSource[];
  trust_score?: number;
  stance: 'supports' | 'contradicts' | 'silent';
  created_at: string;
}

export interface ComparisonSummary {
  id: string;
  workspace_id: string;
  question: string;
  document_count: number;
  agreement_score?: number;
  trust_score?: number;
  created_at: string;
}

export interface ComparisonDetail {
  id: string;
  workspace_id: string;
  question: string;
  document_ids: string[];
  synthesis_text?: string;
  agreement_score?: number;
  trust_score?: number;
  results: ComparisonResult[];
  created_at: string;
}

export interface ComparisonCreateRequest {
  question: string;
  document_ids: string[];
}

export interface ComparisonCreateResponse {
  comparison_id: string;
  status: 'processing' | 'completed' | 'failed';
  message: string;
}

// ─── WebSocket ──────────────────────────────────────────────────────────────
export interface WSMessage {
  type: string;
  payload: unknown;
}

export interface WSToken {
  type: 'token';
  content: string;
}

export interface WSSource {
  type: 'source';
  chunk_id: string;
  document_id: string;
  document_name?: string;
  excerpt: string;
  score: number;
  confidence?: number;
  matched_chunks?: number;
}

export interface WSGuardrail {
  type: 'guardrail';
  passed: boolean;
  score: number;
  details: string;
}

export interface WSTrustScore {
  type: 'trust_score';
  score: number;
  components: Record<string, number>;
}

export interface WSComplete {
  type: 'complete';
  query_id: string;
  latency_ms: number;
  model_used: string;
  token_count: number;
}

export interface WSError {
  type: 'error';
  code: string;
  message: string;
}

// ─── Collection ─────────────────────────────────────────────────────────────
export interface Collection {
  id: string;
  name: string;
  description: string;
  workspace_id: string;
  document_count: number;
  created_at: string;
}

// ─── Generic API response wrappers ──────────────────────────────────────────
export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    page_size: number;
    total: number;
  };
}

export interface ListResponse<T> {
  data: T[];
}

// ─── Helper type for workspace create/update payloads ───────────────────────
export interface CreateWorkspaceRequest {
  name: string;
  description?: string;
}

export interface UpdateWorkspaceRequest {
  name?: string;
  description?: string;
}

export interface AddMemberRequest {
  user_id: string;
  role?: string;
}

export interface SubmitFeedbackRequest {
  rating: number;
  comment?: string;
}

export interface UpdateUserRequest {
  email?: string;
  username?: string;
}

export interface ActivityEntry {
  id: string;
  type: 'query' | 'document_upload' | 'member_joined' | 'workspace_created';
  description: string;
  user_name: string | null;
  timestamp: string;
  metadata: Record<string, unknown> | null;
}

// ─── Evaluation (RAGAS / golden-set) ─────────────────────────────────────────
export interface EvalRunResponse {
  id: string;
  run_at: string;
  faithfulness: number | null;
  context_precision: number | null;
  context_recall: number | null;
  answer_relevance: number | null;
  answer_correctness: number | null;
  refusal_accuracy: number | null;
  golden_set_version: string | null;
  // JSON-encoded string; may be absent on older rows. Parse defensively —
  // shape is `{ per_category?: {...}, thresholds?: {...} }`.
  notes?: string | null;
}

export interface EvalRunQueuedResponse {
  status: 'queued';
  message: string;
  limit?: number;
}

export interface EvalCategoryBreakdown {
  count: number;
  faithfulness?: number | null;
  trust?: number | null;
  context_precision?: number | null;
  context_recall?: number | null;
  answer_relevance?: number | null;
  refusal_accuracy?: number | null;
  [key: string]: number | null | undefined;
}

export interface EvalThresholds {
  min_faithfulness?: number | null;
  min_trust?: number | null;
  min_context_precision?: number | null;
  refusal_accuracy_min?: number | null;
}

export interface EvalRunNotes {
  per_category?: {
    answerable?: EvalCategoryBreakdown;
    unanswerable?: EvalCategoryBreakdown;
    ambiguous?: EvalCategoryBreakdown;
    [category: string]: EvalCategoryBreakdown | undefined;
  };
  thresholds?: EvalThresholds;
  [key: string]: unknown;
}
