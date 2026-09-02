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

export interface DocumentDetail {
  id: string;
  workspace_id: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  page_count?: number;
  chunk_count: number;
  status: string;
  created_at: string;
  updated_at: string;
  chunks: Array<{ id: string; index: number; content: string; token_count: number; created_at: string }>;
}

// ─── Query ──────────────────────────────────────────────────────────────────
export interface QuerySummary {
  id: string;
  workspace_id: string;
  query_text: string;
  trust_score?: number;
  guardrail_passed?: boolean;
  model_used?: string;
  /** 12-char content hash of the system prompt that produced the answer.
   *  Null for rows written before F1. */
  prompt_version?: string;
  is_pinned: boolean;
  compared_to_query_id?: string;
  review_status: 'needs_review' | 'reviewed' | 'dismissed';
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
  /** 12-char content hash of the system prompt that produced the answer.
   *  Null for rows written before F1. */
  prompt_version?: string;
  latency_ms?: number;
  token_count?: number;
  prompt_tokens?: number;
  is_pinned: boolean;
  compared_to_query_id?: string;
  trust_components?: Record<string, number>;
  review_status: 'needs_review' | 'reviewed' | 'dismissed';
  review_note?: string;
  reviewed_by?: string;
  reviewed_at?: string;
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



export interface QuerySourceDiff {
  new_sources: Source[];
  dropped_sources: Source[];
  shared_sources: Source[];
}

export interface QueryComparison {
  original: QueryDetail;
  rerun: QueryDetail;
  trust_score_delta?: number;
  source_diff: QuerySourceDiff;
  trust_components?: Record<string, number>;
}

export interface SearchResult {
  id: string;
  resource_type: 'query' | 'document';
  workspace_id: string;
  workspace_name: string;
  title: string;
  snippet: string;
  score: number;
}

export interface ReviewQueueItem {
  id: string;
  workspace_id: string;
  query_text: string;
  response_text?: string;
  response_sources: Source[];
  trust_score?: number;
  trust_components: Record<string, number>;
  guardrail_score?: number;
  guardrail_passed?: boolean;
  review_status: 'needs_review' | 'reviewed' | 'dismissed';
  review_note?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  created_at: string;
}

export interface ReviewQueueCount {
  count: number;
  review_queue_enabled: boolean;
}

export interface Annotation {
  id: string;
  workspace_id: string;
  query_id?: string;
  source_id?: string;
  user_id?: string;
  author_name?: string;
  body?: string;
  is_deleted: boolean;
  can_edit: boolean;
  created_at: string;
  updated_at: string;
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
  query_cache_hits: number;
  query_cache_hit_rate?: number;
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
export type InvestigationReviewStatus = 'draft' | 'in_review' | 'approved' | 'needs_changes';

export interface InvestigationCitation {
  text: string;
  chunk_id: string;
  start_index?: number;
  end_index?: number;
}

export interface InvestigationSubQuestion {
  id: string;
  question: string;
  purpose?: string;
  partial_answer?: string;
  citations?: InvestigationCitation[];
  trust_score?: number;
  guardrail_passed?: boolean;
  latency_ms?: number;
  retrieved_chunks?: Source[];
}

export interface InvestigationReasoningStep {
  phase: string;
  title: string;
  description: string;
  details?: Record<string, unknown>;
  timestamp_ms?: number;
}

export interface InvestigationRequest {
  query: string;
  top_k?: number;
  filters?: Record<string, unknown>;
}

export interface InvestigationResponse {
  id: string;
  workspace_id: string;
  query: string;
  final_report: string;
  trust_score?: number;
  trust_components?: Record<string, number>;
  reasoning_trace?: InvestigationReasoningStep[];
  sub_questions?: InvestigationSubQuestion[];
  latency_ms: number;
  error?: string;
  review_status: InvestigationReviewStatus;
  review_note?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface InvestigationSummary {
  id: string;
  workspace_id: string;
  query: string;
  trust_score?: number;
  review_status: InvestigationReviewStatus;
  created_at: string;
  updated_at: string;
}

export interface InvestigationReviewUpdate {
  review_status: InvestigationReviewStatus;
  review_note?: string;
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
  from_cache?: boolean;
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
    workspace_count?: number;
    per_workspace_limit?: number;
    enabled?: boolean;
    threshold?: number;
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
  // ── F1 additions (rows written before migration 010 leave these null) ──
  status?: string | null;
  prompt_version_id?: string | null;
  model_used?: string | null;
  subset?: string | null;
  /** JSON-encoded string here (unlike `PromptEvalSummary.verdict`) — parse it
   *  defensively, exactly like `notes`. */
  verdict?: string | null;
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

// ─── Prompt versions (F1: pinning + eval-gated promotion) ────────────────────
export type PromptVersionStatus = 'draft' | 'staged' | 'active' | 'retired';

/** Terminal states are `passed` / `failed` / `error` — a crashed job lands on
 *  `error`, so pollers must stop on anything that is not `running`. */
export type PromptEvalStatus = 'running' | 'passed' | 'failed' | 'error';

export interface PromptEvalVerdict {
  passed: boolean;
  failed_metrics: string[];
  thresholds: EvalThresholds;
}

/** The `eval` sub-object on `PromptVersionResponse`. Unlike `EvalRunResponse`,
 *  `verdict` here is already parsed (the history endpoint returns a string). */
export interface PromptEvalSummary {
  id: string;
  status: PromptEvalStatus;
  subset?: string | null;
  model_used?: string | null;
  golden_set_version?: string | null;
  faithfulness: number | null;
  context_precision: number | null;
  context_recall: number | null;
  answer_relevance: number | null;
  answer_correctness: number | null;
  refusal_accuracy: number | null;
  /** Trust lives in the eval run's `notes` JSON, so the API surfaces it here. */
  trust: number | null;
  verdict?: PromptEvalVerdict | null;
  run_at?: string | null;
}

export interface PromptVersion {
  id: string;
  name: string;
  version: number;
  content: string;
  content_hash: string;
  status: PromptVersionStatus;
  model_name?: string | null;
  created_by?: string | null;
  promoted_at?: string | null;
  eval_run_id?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  eval?: PromptEvalSummary | null;
}

export interface PromptVersionCreate {
  name: string;
  content: string;
  model_name?: string;
  notes?: string;
}

export interface ActivePrompt {
  name: string;
  content: string;
  content_hash: string;
  model_name: string | null;
  version: number | null;
  version_id: string | null;
  /** True when no row is active and the code default is being served. */
  is_default: boolean;
}

export interface PromptDiffResponse {
  from_id: string | null;
  from_label: string;
  to_id: string;
  to_label: string;
  /** `difflib.unified_diff` text. */
  diff: string;
}

export interface PromptEvalQueued {
  eval_run_id: string;
  prompt_version_id: string;
  subset: string;
  status: string;
}

/** Body of the promote gate's 409, read from `ApiError.details`. */
export interface PromptGateFailure {
  detail?: string;
  reason?: 'no_eval_run' | 'eval_incomplete' | 'thresholds_not_met';
  failed_metrics?: string[];
  thresholds?: EvalThresholds;
  scores?: Record<string, number | null>;
}
