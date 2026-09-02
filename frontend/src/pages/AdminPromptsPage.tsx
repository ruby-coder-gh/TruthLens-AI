import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { diffLines } from 'diff';
import {
  CheckCircle2,
  FileDiff,
  GitBranch,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react';
import { Badge, Button, Card, EmptyState, Input, Modal, Select, TextArea, type BadgeColor } from '../components/ui';
import { pageTransition, staggerContainer, staggerItem } from '../components/motion';
import { useToast } from '../components/toast-context';
import { PageHeader, PageShell, StateBlock } from '../components/PageWrappers';
import { adminApi } from '../api/client';
import type {
  EvalThresholds,
  PromptEvalSummary,
  PromptGateFailure,
  PromptVersion,
  PromptVersionCreate,
  PromptVersionStatus,
} from '../api/types';

// ─── Constants ──────────────────────────────────────────────────────────────

/** The only prompt the registry threads through generation today. */
const PROMPT_NAME = 'answer';

// Same cadence as the analytics page's golden-set poller: a run takes minutes,
// so back off to 15s and give up after 4 tries rather than polling forever
// (a crashed job lands on `error`, but a wedged one never leaves `running`).
const EVAL_POLL_INTERVAL_MS = 15_000;
const EVAL_POLL_MAX_TRIES = 4;

const PROMPTS_KEY = ['admin', 'prompts'];

const STATUS_COLOR: Record<PromptVersionStatus, BadgeColor> = {
  draft: 'gray',
  staged: 'orange',
  active: 'green',
  retired: 'blue',
};

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'staged', label: 'Staged' },
  { value: 'active', label: 'Active' },
  { value: 'retired', label: 'Retired' },
];

type EvalSubset = 'smoke' | 'full';

type MetricKey = 'faithfulness' | 'trust' | 'context_precision' | 'refusal_accuracy';

interface MetricSpec {
  key: MetricKey;
  label: string;
  threshold: keyof EvalThresholds;
}

/** Gate metrics, paired with the `EVAL_MIN_*` setting each one is scored against. */
const METRICS: MetricSpec[] = [
  { key: 'faithfulness', label: 'faithfulness', threshold: 'min_faithfulness' },
  { key: 'trust', label: 'trust', threshold: 'min_trust' },
  { key: 'context_precision', label: 'context precision', threshold: 'min_context_precision' },
  { key: 'refusal_accuracy', label: 'refusal accuracy', threshold: 'refusal_accuracy_min' },
];

const NEUTRAL_CHIP =
  'inline-flex items-center rounded-full border border-border bg-card-2 px-2 py-0.5 text-[11px] text-text-dim';

const GATE_REASON_TEXT: Record<string, string> = {
  thresholds_not_met: 'Scores below threshold — the golden-set eval did not clear the gate.',
  no_eval_run: 'No eval run yet — run a golden-set eval before promoting this version.',
  eval_incomplete: 'The eval is still running — wait for it to finish before promoting.',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatScore(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';
}

function scoreOf(evalSummary: PromptEvalSummary, key: MetricKey): number | null {
  const value = evalSummary[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function specFor(metric: string): MetricSpec | undefined {
  return METRICS.find((spec) => spec.key === metric);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}

/** Tooltip for the Promote button. A `draft` is promotable: the request is what
 *  runs the eval gate, and a refusal opens the failed-metrics dialog rather
 *  than dead-ending. */
function promoteHint(status: PromptVersionStatus): string | undefined {
  if (status === 'staged') return undefined;
  if (status === 'draft') {
    return 'Runs the eval gate — if it refuses, you can review the failed metrics and force the promotion.';
  }
  return 'Only a draft or staged version can be promoted.';
}

/**
 * The promote gate returns the app's standard error envelope, so the
 * machine-readable body lands on `ApiError.details` rather than on `detail`.
 * Read it structurally — that keeps this independent of the error class and
 * tolerant of a backend that omits fields.
 */
function gateFailureFrom(err: unknown): PromptGateFailure | null {
  if (!err || typeof err !== 'object') return null;
  const candidate = err as { status?: number; details?: unknown };
  if (candidate.status !== 409) return null;
  if (!candidate.details || typeof candidate.details !== 'object') return null;
  return candidate.details as PromptGateFailure;
}

interface DiffLine {
  key: string;
  kind: 'added' | 'removed' | 'context';
  text: string;
}

/** Line-level diff for display. Keys are position-derived, which is stable
 *  because the list is recomputed wholesale whenever either side changes. */
function toDiffLines(from: string, to: string): DiffLine[] {
  const lines: DiffLine[] = [];
  diffLines(from, to).forEach((part, partIndex) => {
    const kind = part.added ? 'added' : part.removed ? 'removed' : 'context';
    const parts = part.value.split('\n');
    // A trailing newline yields an empty final entry — not a real line.
    if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
    parts.forEach((text, lineIndex) => {
      lines.push({ key: `${partIndex}-${lineIndex}`, kind, text });
    });
  });
  return lines;
}

const DIFF_LINE_CLASS: Record<DiffLine['kind'], string> = {
  added: 'text-green bg-green/10',
  removed: 'text-red bg-red/10',
  context: 'text-text-muted',
};

const DIFF_SIGN: Record<DiffLine['kind'], string> = { added: '+', removed: '-', context: ' ' };

// Colour alone can't carry the added/removed distinction — the sign is visible
// and the prefix is announced to screen readers.
const DIFF_LABEL: Record<DiffLine['kind'], string> = {
  added: 'Added: ',
  removed: 'Removed: ',
  context: '',
};

// ─── Presentational pieces ──────────────────────────────────────────────────

function DiffView({ lines }: { lines: DiffLine[] }) {
  if (lines.length === 0) {
    return <p className="text-sm text-text-dim">The two prompts are identical.</p>;
  }
  return (
    <ul className="max-h-80 overflow-y-auto rounded-xl border border-border bg-bg-soft p-3 font-mono text-xs leading-relaxed">
      {lines.map((line) => (
        <li
          key={line.key}
          className={clsx('flex gap-2 whitespace-pre-wrap break-words rounded px-1', DIFF_LINE_CLASS[line.kind])}
        >
          <span aria-hidden="true" className="select-none opacity-60">{DIFF_SIGN[line.kind]}</span>
          {DIFF_LABEL[line.kind] ? <span className="sr-only">{DIFF_LABEL[line.kind]}</span> : null}
          {line.text || ' '}
        </li>
      ))}
    </ul>
  );
}

function MetricChip({ evalSummary, spec }: { evalSummary: PromptEvalSummary; spec: MetricSpec }) {
  const score = scoreOf(evalSummary, spec.key);
  const verdict = evalSummary.verdict;
  const threshold = verdict?.thresholds?.[spec.threshold];

  // The gate's own verdict outranks everything else: a metric it recorded as
  // failed reads "fail" even when the threshold — or the score itself — is
  // absent from the payload. A missing number must never soften a recorded
  // failure into something quieter.
  const failed = verdict?.failed_metrics.includes(spec.key) ?? false;

  // Nothing to judge: the run never scored it and the gate did not fail it.
  if (!failed && score === null) {
    return (
      <span className={NEUTRAL_CHIP}>{spec.label} not scored</span>
    );
  }

  // Scored, but with no threshold it was judged against — a green
  // "pass / min —" would assert an approval that nothing ever computed.
  if (!failed && (!verdict || typeof threshold !== 'number')) {
    return (
      <span className={NEUTRAL_CHIP}>{`${spec.label} ${formatScore(score)} · no threshold`}</span>
    );
  }

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums',
        failed ? 'border-red/30 bg-red/10 text-red' : 'border-green/30 bg-green/10 text-green',
      )}
    >
      {failed ? <XCircle size={11} aria-hidden="true" /> : <CheckCircle2 size={11} aria-hidden="true" />}
      {spec.label} {formatScore(score)} / min {formatScore(threshold)} · {failed ? 'fail' : 'pass'}
    </span>
  );
}

function EvalCell({ version, pending }: { version: PromptVersion; pending: boolean }) {
  if (pending) return <Badge color="blue">Queued</Badge>;

  const evalSummary = version.eval;
  if (!evalSummary) return <span className="text-xs text-text-dim">No eval run</span>;
  if (evalSummary.status === 'running') return <Badge color="blue">Running</Badge>;
  if (evalSummary.status === 'error') return <Badge color="red">Eval error</Badge>;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge color={evalSummary.status === 'passed' ? 'green' : 'red'}>{evalSummary.status}</Badge>
      {evalSummary.subset ? <span className="text-[11px] text-text-dim">{evalSummary.subset}</span> : null}
      {METRICS.map((spec) => (
        <MetricChip key={spec.key} evalSummary={evalSummary} spec={spec} />
      ))}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function AdminPromptsPage() {
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<'' | PromptVersionStatus>('');
  const [subsetById, setSubsetById] = useState<Record<string, EvalSubset>>({});
  const [pendingEvalIds, setPendingEvalIds] = useState<string[]>([]);

  const [draftOpen, setDraftOpen] = useState(false);
  const [draftContent, setDraftContent] = useState('');
  const [draftModel, setDraftModel] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [draftError, setDraftError] = useState('');

  const [gate, setGate] = useState<{ version: PromptVersion; failure: PromptGateFailure } | null>(null);
  const [gateConfirming, setGateConfirming] = useState(false);
  const [diffTarget, setDiffTarget] = useState<PromptVersion | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PromptVersion | null>(null);

  // ── Data ──────────────────────────────────────────────────────────────────
  const promptsQuery = useQuery({
    queryKey: [...PROMPTS_KEY, 'list', statusFilter],
    queryFn: () => adminApi.prompts.list(statusFilter ? { status: statusFilter } : undefined),
  });

  const activeQuery = useQuery({
    queryKey: [...PROMPTS_KEY, 'active', PROMPT_NAME],
    queryFn: () => adminApi.prompts.active(PROMPT_NAME),
  });

  const diffId = diffTarget?.id ?? '';
  const diffQuery = useQuery({
    queryKey: [...PROMPTS_KEY, 'diff', diffId],
    queryFn: () => adminApi.prompts.diff(diffId, 'active'),
    enabled: diffId !== '',
  });

  const versions = promptsQuery.data?.data ?? [];
  const activePrompt = activeQuery.data;

  const invalidatePrompts = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: PROMPTS_KEY });
  }, [queryClient]);

  // ── Eval polling ──────────────────────────────────────────────────────────
  const pollTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pollAttemptsRef = useRef(new Map<string, number>());
  const mountedRef = useRef(true);

  useEffect(() => {
    const timers = pollTimersRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const stopPolling = useCallback((id: string) => {
    const timer = pollTimersRef.current.get(id);
    if (timer) clearTimeout(timer);
    pollTimersRef.current.delete(id);
    pollAttemptsRef.current.delete(id);
    setPendingEvalIds((prev) => prev.filter((pendingId) => pendingId !== id));
  }, []);

  const startPolling = useCallback((id: string) => {
    const timers = pollTimersRef.current;
    const attempts = pollAttemptsRef.current;
    const existing = timers.get(id);
    if (existing) clearTimeout(existing);
    attempts.set(id, 0);

    const attempt = () => {
      const tries = (attempts.get(id) ?? 0) + 1;
      attempts.set(id, tries);
      void (async () => {
        let settled = false;
        try {
          const fresh = await adminApi.prompts.get(id);
          if (!mountedRef.current) return;
          if (fresh.eval && fresh.eval.status !== 'running') {
            settled = true;
            stopPolling(id);
            invalidatePrompts();
            addToast(
              fresh.eval.status === 'passed'
                ? `Eval passed — ${fresh.name} v${fresh.version} is staged.`
                : `Eval ${fresh.eval.status} for ${fresh.name} v${fresh.version}.`,
              fresh.eval.status === 'passed' ? 'success' : 'error',
            );
          }
        } catch {
          // Transient poll failure — keep trying until the attempt budget runs out.
        }
        if (settled || !mountedRef.current) return;
        if (tries < EVAL_POLL_MAX_TRIES) {
          timers.set(id, setTimeout(attempt, EVAL_POLL_INTERVAL_MS));
        } else {
          stopPolling(id);
          invalidatePrompts();
          addToast('Eval is still running — refresh in a minute to see the result.', 'info');
        }
      })();
    };

    timers.set(id, setTimeout(attempt, EVAL_POLL_INTERVAL_MS));
  }, [stopPolling, invalidatePrompts, addToast]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (body: PromptVersionCreate) => adminApi.prompts.create(body),
    onSuccess: (created) => {
      setDraftOpen(false);
      invalidatePrompts();
      addToast(`Draft ${created.name} v${created.version} created.`, 'success');
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  const evaluateMutation = useMutation({
    mutationFn: ({ id, subset }: { id: string; subset: EvalSubset }) => adminApi.prompts.evaluate(id, subset),
    onSuccess: (_queued, variables) => {
      setPendingEvalIds((prev) => (prev.includes(variables.id) ? prev : [...prev, variables.id]));
      startPolling(variables.id);
      addToast(`Golden-set ${variables.subset} eval queued — this can take a few minutes.`, 'info');
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  const promoteMutation = useMutation({
    mutationFn: ({ version, force }: { version: PromptVersion; force: boolean }) =>
      adminApi.prompts.promote(version.id, force),
    onSuccess: (updated) => {
      setGate(null);
      setGateConfirming(false);
      invalidatePrompts();
      addToast(`Promoted ${updated.name} v${updated.version} to active.`, 'success');
    },
    onError: (err, variables) => {
      const failure = gateFailureFrom(err);
      // A gate refusal is a decision point, not a dead end — surface the
      // numbers and let the admin force it. A 409 on a forced promote is a
      // different problem (e.g. already active), so that stays a toast.
      if (failure && !variables.force) {
        setGate({ version: variables.version, failure });
        setGateConfirming(false);
        return;
      }
      addToast(errorMessage(err), 'error');
    },
  });

  const rollbackMutation = useMutation({
    mutationFn: (version: PromptVersion) => adminApi.prompts.rollback(version.id),
    onSuccess: (updated) => {
      invalidatePrompts();
      addToast(`Rolled back to ${updated.name} v${updated.version}.`, 'success');
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (version: PromptVersion) => adminApi.prompts.remove(version.id),
    onSuccess: (_void, version) => {
      setDeleteTarget(null);
      invalidatePrompts();
      addToast(`Deleted ${version.name} v${version.version}.`, 'success');
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  // ── Handlers ──────────────────────────────────────────────────────────────
  function openDraft() {
    setDraftContent(activePrompt?.content ?? '');
    setDraftModel(activePrompt?.model_name ?? '');
    setDraftNotes('');
    setDraftError('');
    setDraftOpen(true);
  }

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    const content = draftContent.trim();
    if (!content) {
      setDraftError('Prompt content is required.');
      return;
    }
    setDraftError('');
    const model = draftModel.trim();
    const notes = draftNotes.trim();
    createMutation.mutate({
      name: PROMPT_NAME,
      content,
      ...(model ? { model_name: model } : {}),
      ...(notes ? { notes } : {}),
    });
  }

  function closeGate() {
    setGate(null);
    setGateConfirming(false);
  }

  // Line-level colouring is computed client-side from the two prompt bodies —
  // but only when the loaded active prompt is the *same* prompt name as the
  // row. For any other name the server's unified diff is the only correct
  // baseline (it resolves that name's own active row).
  const diffLinesForTarget = diffTarget && activePrompt && activePrompt.name === diffTarget.name
    ? toDiffLines(activePrompt.content, diffTarget.content)
    : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <motion.div variants={pageTransition} initial="initial" animate="animate">
      <PageShell>
        <motion.div variants={staggerItem}>
          <PageHeader
            title="Prompt versions"
            description="Stage a prompt, clear the golden-set eval gate, then promote it. Every answer records the hash that produced it."
            actions={(
              <Button size="sm" onClick={openDraft}>
                <Plus size={14} />
                New draft
              </Button>
            )}
          />
        </motion.div>

        {/* Active prompt context — what a diff and a new draft are based on. */}
        {activeQuery.isError ? (
          <StateBlock tone="danger" role="alert">
            Could not load the active prompt: {errorMessage(activeQuery.error)}
          </StateBlock>
        ) : activePrompt ? (
          <motion.div variants={staggerItem}>
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-soft">
                  <ShieldCheck size={16} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text">
                    Active prompt · <code className="font-mono text-xs">{activePrompt.content_hash}</code>
                  </p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {activePrompt.is_default
                      ? 'No promoted version yet — answers use the built-in default prompt.'
                      : `${activePrompt.name} v${activePrompt.version}`}
                    {activePrompt.model_name ? ` · pinned to ${activePrompt.model_name}` : ' · no model pinned'}
                  </p>
                </div>
              </div>
            </Card>
          </motion.div>
        ) : null}

        <motion.div variants={staggerItem} className="flex flex-wrap items-end gap-3">
          <div className="w-full max-w-xs">
            <Select
              label="Status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as '' | PromptVersionStatus)}
              options={STATUS_OPTIONS}
            />
          </div>
          {/* An eval finishing in the background is the common reason this list
              goes stale between polls. */}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void promptsQuery.refetch()}
            loading={promptsQuery.isFetching}
          >
            <RefreshCw size={14} aria-hidden="true" />
            Refresh
          </Button>
        </motion.div>

        {promptsQuery.isPending ? (
          <StateBlock role="status">Loading prompt versions…</StateBlock>
        ) : promptsQuery.isError ? (
          <StateBlock tone="danger" role="alert" className="space-y-3">
            <p>{errorMessage(promptsQuery.error)}</p>
            <Button variant="secondary" size="sm" onClick={() => void promptsQuery.refetch()}>
              Retry
            </Button>
          </StateBlock>
        ) : versions.length === 0 ? (
          <EmptyState
            icon={<GitBranch size={24} />}
            title="No prompt versions"
            description={statusFilter
              ? 'No version has that status yet.'
              : 'Create a draft to start versioning the answer prompt.'}
            action={<Button size="sm" onClick={openDraft}><Plus size={14} />New draft</Button>}
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border glass">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-card-2/80">
                  <th scope="col" className="px-4 py-3 font-medium text-text-muted">Name</th>
                  <th scope="col" className="px-4 py-3 font-medium text-text-muted">Version</th>
                  <th scope="col" className="px-4 py-3 font-medium text-text-muted">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium text-text-muted">Hash</th>
                  <th scope="col" className="px-4 py-3 font-medium text-text-muted">Model</th>
                  <th scope="col" className="px-4 py-3 font-medium text-text-muted">Eval vs thresholds</th>
                  <th scope="col" className="px-4 py-3 font-medium text-text-muted">Promoted</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium text-text-muted">Actions</th>
                </tr>
              </thead>
              <motion.tbody variants={staggerContainer} initial="initial" animate="animate">
                {versions.map((version) => {
                  const label = `${version.name} v${version.version}`;
                  const subset = subsetById[version.id] ?? 'smoke';
                  const canEvaluate = version.status === 'draft' || version.status === 'staged';
                  // The server's eval gate is the gate — not this button. Gating
                  // it on `staged` made the 409 (and therefore the failed-metrics
                  // modal and Force promote behind it) unreachable, because a
                  // failing eval is exactly what keeps a version on `draft`.
                  // `active`/`retired` never render the button at all.
                  const canPromote = version.status === 'draft' || version.status === 'staged';
                  const evaluating = evaluateMutation.isPending && evaluateMutation.variables?.id === version.id;
                  const promoting = promoteMutation.isPending && promoteMutation.variables?.version.id === version.id;
                  const rollingBack = rollbackMutation.isPending && rollbackMutation.variables?.id === version.id;

                  return (
                    <motion.tr
                      key={version.id}
                      variants={staggerItem}
                      className="border-b border-border last:border-b-0 transition-colors hover:bg-card-2/50"
                    >
                      <td className="px-4 py-3 text-text">{version.name}</td>
                      <td className="px-4 py-3 tabular-nums text-text-muted">v{version.version}</td>
                      <td className="px-4 py-3">
                        <Badge color={STATUS_COLOR[version.status]}>{version.status}</Badge>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-text-dim">{version.content_hash}</td>
                      <td className="px-4 py-3 text-xs text-text-muted">
                        {version.model_name || 'default model'}
                      </td>
                      <td className="px-4 py-3">
                        <EvalCell version={version} pending={pendingEvalIds.includes(version.id)} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-text-dim">
                        {version.promoted_at ? formatDate(version.promoted_at) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {canEvaluate ? (
                            <>
                              <select
                                aria-label={`Eval subset for ${label}`}
                                value={subset}
                                onChange={(event) => setSubsetById((prev) => ({
                                  ...prev,
                                  [version.id]: event.target.value as EvalSubset,
                                }))}
                                className="glass-input rounded-lg px-2 py-1.5 text-xs text-text focus:outline-none"
                              >
                                <option value="smoke">smoke</option>
                                <option value="full">full</option>
                              </select>
                              <Button
                                size="sm"
                                variant="secondary"
                                aria-label={`Run eval for ${label}`}
                                loading={evaluating}
                                onClick={() => evaluateMutation.mutate({ id: version.id, subset })}
                              >
                                <Zap size={13} />
                                Run eval
                              </Button>
                              <Button
                                size="sm"
                                aria-label={`Promote ${label}`}
                                disabled={!canPromote}
                                loading={promoting}
                                title={promoteHint(version.status)}
                                onClick={() => promoteMutation.mutate({ version, force: false })}
                              >
                                <ShieldCheck size={13} />
                                Promote
                              </Button>
                            </>
                          ) : null}

                          {version.status === 'retired' ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              aria-label={`Roll back to ${label}`}
                              loading={rollingBack}
                              onClick={() => rollbackMutation.mutate(version)}
                            >
                              <RotateCcw size={13} />
                              Rollback
                            </Button>
                          ) : null}

                          {version.status !== 'active' ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Diff ${label} against active`}
                              onClick={() => setDiffTarget(version)}
                            >
                              <FileDiff size={13} />
                              Diff vs active
                            </Button>
                          ) : null}

                          {version.status === 'draft' || version.status === 'retired' ? (
                            <Button
                              size="sm"
                              variant="danger"
                              aria-label={`Delete ${label}`}
                              onClick={() => setDeleteTarget(version)}
                            >
                              <Trash2 size={13} />
                              Delete
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </motion.tbody>
            </table>
          </div>
        )}

        {/* ── New draft ─────────────────────────────────────────────────── */}
        <Modal open={draftOpen} onClose={() => setDraftOpen(false)} title="New prompt draft" className="max-w-2xl">
          <form onSubmit={handleCreate} className="space-y-4">
            <p className="text-xs text-text-dim">
              Prefilled from the active prompt
              {activePrompt ? ` (${activePrompt.content_hash})` : ''}. A draft changes nothing until it
              clears an eval and is promoted.
            </p>
            <TextArea
              label="Prompt content"
              value={draftContent}
              onChange={(event) => setDraftContent(event.target.value)}
              error={draftError}
              rows={10}
              required
            />
            <Input
              label="Model name (optional)"
              value={draftModel}
              onChange={(event) => setDraftModel(event.target.value)}
              placeholder="e.g. llama3.2:3b — leave blank to use the configured default"
            />
            <TextArea
              label="Notes (optional)"
              value={draftNotes}
              onChange={(event) => setDraftNotes(event.target.value)}
              placeholder="Why this change?"
              rows={2}
            />
            <div className="flex gap-3">
              <Button type="submit" size="sm" loading={createMutation.isPending}>
                <Plus size={14} />
                Create draft
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setDraftOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>

        {/* ── Eval gate refusal ─────────────────────────────────────────── */}
        <Modal open={gate !== null} onClose={closeGate} title="Promotion blocked" className="max-w-xl">
          {gate ? (
            <div className="space-y-4">
              <p className="text-sm text-text-muted">
                {GATE_REASON_TEXT[gate.failure.reason ?? ''] ?? 'The eval gate refused this promotion.'}
              </p>
              <p className="text-xs text-text-dim">
                {gate.version.name} v{gate.version.version} · {gate.version.content_hash}
              </p>

              {(gate.failure.failed_metrics ?? []).length > 0 ? (
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border bg-card-2/80">
                        <th scope="col" className="px-3 py-2 font-medium text-text-muted">Metric</th>
                        <th scope="col" className="px-3 py-2 font-medium text-text-muted">Score</th>
                        <th scope="col" className="px-3 py-2 font-medium text-text-muted">Threshold</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(gate.failure.failed_metrics ?? []).map((metric) => {
                        const spec = specFor(metric);
                        const threshold = spec ? gate.failure.thresholds?.[spec.threshold] : undefined;
                        return (
                          <tr key={metric} className="border-b border-border last:border-b-0">
                            <td className="px-3 py-2 text-text">{spec?.label ?? metric}</td>
                            <td className="px-3 py-2 font-medium tabular-nums text-red">
                              {formatScore(gate.failure.scores?.[metric])}
                            </td>
                            <td className="px-3 py-2 tabular-nums text-text-muted">{formatScore(threshold)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {gateConfirming ? (
                <div className="space-y-3 rounded-xl border border-red/30 bg-red/10 p-3">
                  <p className="text-sm text-red">
                    Force-promoting ships a prompt that failed the gate to every user. The override is audited.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setGateConfirming(false)}>
                      Back
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      loading={promoteMutation.isPending}
                      onClick={() => promoteMutation.mutate({ version: gate.version, force: true })}
                    >
                      Confirm force promote
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={closeGate}>
                    Cancel
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => setGateConfirming(true)}>
                    Force promote
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </Modal>

        {/* ── Diff vs active ────────────────────────────────────────────── */}
        <Modal open={diffTarget !== null} onClose={() => setDiffTarget(null)} title="Diff vs active" className="max-w-3xl">
          {diffTarget ? (
            <div className="space-y-3">
              <p className="text-xs text-text-dim">
                {diffQuery.data
                  ? `${diffQuery.data.from_label} → ${diffQuery.data.to_label}`
                  : `active → ${diffTarget.name} v${diffTarget.version}`}
              </p>
              {diffLinesForTarget ? (
                <DiffView lines={diffLinesForTarget} />
              ) : diffQuery.isError ? (
                <StateBlock tone="danger" role="alert">{errorMessage(diffQuery.error)}</StateBlock>
              ) : diffQuery.data ? (
                <pre className="max-h-80 overflow-auto rounded-xl border border-border bg-bg-soft p-3 font-mono text-xs text-text-muted">
                  {diffQuery.data.diff}
                </pre>
              ) : (
                <StateBlock role="status">Loading diff…</StateBlock>
              )}
            </div>
          ) : null}
        </Modal>

        {/* ── Delete confirmation ───────────────────────────────────────── */}
        <Modal open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Delete prompt version">
          {deleteTarget ? (
            <div className="space-y-4">
              <p className="text-sm text-text-muted">
                Delete {deleteTarget.name} v{deleteTarget.version} ({deleteTarget.content_hash})? Answers
                already stamped with this hash keep their provenance, but the version itself is gone.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => setDeleteTarget(null)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  loading={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(deleteTarget)}
                >
                  <Trash2 size={14} />
                  Delete version
                </Button>
              </div>
            </div>
          ) : null}
        </Modal>
      </PageShell>
    </motion.div>
  );
}
