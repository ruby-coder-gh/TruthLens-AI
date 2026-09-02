import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  CheckCircle2,
  ClipboardCheck,
  RefreshCw,
  ShieldAlert,
  ShieldX,
  Sparkles,
  XCircle,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  ProgressBar,
  Select,
  Skeleton,
  Tabs,
  TextArea,
} from '../components/ui';
import { PageHeader, PageShell } from '../components/PageWrappers';
import { reviewQueueApi, workspaceApi } from '../api/client';
import type { GoldenCategory, QuarantinedChunk, ReviewQueueItem } from '../api/types';
import { useAuth } from '../context/auth-context';
import { useToast } from '../components/toast-context';
import { getTrustBadgeColor } from '../utils/relevance';

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORY_OPTIONS: { value: GoldenCategory; label: string }[] = [
  { value: 'answerable', label: 'Answerable — the documents support this answer' },
  { value: 'unanswerable', label: 'Unanswerable — the model should refuse' },
  { value: 'ambiguous', label: 'Ambiguous — the question is underspecified' },
];

const DIFFICULTY_OPTIONS = [
  { value: '1', label: '1 — Easy' },
  { value: '2', label: '2 — Moderate' },
  { value: '3', label: '3 — Hard' },
];

const CONTENT_PREVIEW_CHARS = 400;

function severityColor(severity: string): 'red' | 'orange' | 'gray' {
  const normalized = severity.toLowerCase();
  if (normalized === 'high' || normalized === 'critical') return 'red';
  if (normalized === 'medium' || normalized === 'moderate') return 'orange';
  return 'gray';
}

// ─── Trust breakdown ─────────────────────────────────────────────────────────

function TrustBreakdown({ item }: { item: ReviewQueueItem }) {
  const entries = Object.entries(item.trust_components || {});
  return (
    <div className="mt-3 space-y-2">
      {entries.length === 0 ? (
        <p className="text-xs text-text-dim">
          No persisted signal breakdown is available for this historical answer.
        </p>
      ) : (
        entries.map(([name, value]) => (
          <ProgressBar
            key={name}
            value={value * 100}
            size="sm"
            label={`${name.replace(/_/g, ' ')} ${(value * 100).toFixed(0)}%`}
          />
        ))
      )}
    </div>
  );
}

// ─── Quarantined chunk row ───────────────────────────────────────────────────

/**
 * SECURITY: `chunk.content` is the injection payload itself — attacker-authored
 * text that reached the corpus. It is rendered as a plain React text node only
 * (never markdown, never `dangerouslySetInnerHTML`), and truncated client-side
 * rather than trusting any server-supplied excerpt.
 */
function QuarantineRow({
  chunk,
  busy,
  onRelease,
  onDismiss,
}: {
  chunk: QuarantinedChunk;
  busy: boolean;
  onRelease: () => void;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = chunk.content.length > CONTENT_PREVIEW_CHARS;
  const shown = expanded || !isLong ? chunk.content : `${chunk.content.slice(0, CONTENT_PREVIEW_CHARS)}…`;

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldX size={16} className="text-red" aria-hidden="true" />
            <p className="font-medium text-text">{chunk.document_name || chunk.document_id}</p>
            <span className="text-xs text-text-dim">passage {chunk.chunk_index + 1}</span>
            <Badge color={severityColor(chunk.severity)}>{chunk.severity}</Badge>
            <Badge color="gray">{chunk.pattern}</Badge>
          </div>

          <p className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-text-muted">
            {shown}
          </p>
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="mt-1 rounded text-xs font-medium text-primary-soft underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              aria-expanded={expanded}
            >
              {expanded ? 'Show less' : 'Show full text'}
            </button>
          )}
        </div>

        <div className="flex w-full flex-wrap gap-2 sm:max-w-xs sm:flex-col sm:items-stretch">
          <Button size="sm" variant="secondary" disabled={busy} onClick={onRelease}>
            <CheckCircle2 size={13} /> Release
          </Button>
          <Button size="sm" variant="ghost" loading={busy} onClick={onDismiss}>
            <XCircle size={13} /> Dismiss chunk
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ─── Promote-to-golden modal ─────────────────────────────────────────────────

function PromoteGoldenModal({
  item,
  submitting,
  onClose,
  onSubmit,
}: {
  item: ReviewQueueItem;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: { category: GoldenCategory; reference_answer: string; difficulty: number; notes?: string }) => void;
}) {
  const [category, setCategory] = useState<GoldenCategory>('answerable');
  const [referenceAnswer, setReferenceAnswer] = useState(item.response_text ?? '');
  const [difficulty, setDifficulty] = useState('1');
  const [notes, setNotes] = useState('');
  const [touched, setTouched] = useState(false);

  const answerError = touched && !referenceAnswer.trim() ? 'A reference answer is required.' : undefined;

  return (
    <Modal open onClose={onClose} title="Promote to golden set">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (!referenceAnswer.trim()) return;
          onSubmit({
            category,
            reference_answer: referenceAnswer.trim(),
            difficulty: Number(difficulty),
            notes: notes.trim() || undefined,
          });
        }}
      >
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.06em] text-text-dim">Question</p>
          <p className="mt-1 text-sm text-text">{item.query_text}</p>
          <p className="mt-1 text-xs text-text-dim">
            The question is copied verbatim from the query and cannot be edited.
          </p>
        </div>

        <Select
          id="golden-category"
          label="Category"
          value={category}
          onChange={(event) => setCategory(event.target.value as GoldenCategory)}
          options={CATEGORY_OPTIONS}
        />

        <TextArea
          id="golden-reference-answer"
          label="Reference answer"
          rows={5}
          value={referenceAnswer}
          error={answerError}
          onChange={(event) => setReferenceAnswer(event.target.value)}
          placeholder="Correct the answer before promoting it…"
        />

        <Select
          id="golden-difficulty"
          label="Difficulty"
          value={difficulty}
          onChange={(event) => setDifficulty(event.target.value)}
          options={DIFFICULTY_OPTIONS}
        />

        <TextArea
          id="golden-notes"
          label="Notes"
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Why this belongs in the regression set (optional)…"
        />

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={submitting}>
            Promote
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ReviewQueuePage() {
  const { id: workspaceId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { addToast } = useToast();

  const [activeTab, setActiveTab] = useState('queue');
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [quarantine, setQuarantine] = useState<QuarantinedChunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [quarantineLoading, setQuarantineLoading] = useState(true);
  const [quarantineError, setQuarantineError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [workspaceOwner, setWorkspaceOwner] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [acting, setActing] = useState<string | null>(null);
  const [quarantineActing, setQuarantineActing] = useState<string | null>(null);
  const [releaseTarget, setReleaseTarget] = useState<QuarantinedChunk | null>(null);
  const [promoteTarget, setPromoteTarget] = useState<ReviewQueueItem | null>(null);
  const [promoting, setPromoting] = useState(false);

  useEffect(() => {
    if (!workspaceId) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      Promise.all([reviewQueueApi.list(workspaceId), workspaceApi.get(workspaceId)])
        .then(([queue, workspace]) => {
          if (cancelled) return;
          setItems(queue.data);
          setEnabled(Boolean(queue.meta.enabled));
          setWorkspaceOwner(workspace.owner_id);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [workspaceId]);

  // Quarantine is its own request so a 403 (viewer role) or a disabled scanner
  // never blanks the main review queue.
  useEffect(() => {
    if (!workspaceId) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setQuarantineLoading(true);
      reviewQueueApi.quarantine
        .list(workspaceId, { status: 'quarantined' })
        .then((response) => {
          if (cancelled) return;
          setQuarantine(response.data);
          setQuarantineError(null);
        })
        .catch((reason: Error) => {
          if (cancelled) return;
          setQuarantine([]);
          setQuarantineError(reason.message || 'Could not load quarantined content.');
        })
        .finally(() => {
          if (!cancelled) setQuarantineLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [workspaceId]);

  const review = useCallback(
    async (item: ReviewQueueItem, status: 'reviewed' | 'dismissed') => {
      if (!workspaceId) return;
      setActing(item.id);
      try {
        await reviewQueueApi.review(workspaceId, item.id, {
          review_status: status,
          review_note: notes[item.id]?.trim() || undefined,
        });
        setItems((current) => current.filter((entry) => entry.id !== item.id));
      } finally {
        setActing(null);
      }
    },
    [workspaceId, notes],
  );

  const toggleEnabled = useCallback(async () => {
    if (!workspaceId) return;
    const next = !enabled;
    setEnabled(next);
    try {
      await reviewQueueApi.settings(workspaceId, next);
      if (!next) setItems([]);
    } catch {
      setEnabled(!next);
    }
  }, [workspaceId, enabled]);

  const confirmRelease = useCallback(async () => {
    if (!workspaceId || !releaseTarget) return;
    const target = releaseTarget;
    setQuarantineActing(target.id);
    try {
      await reviewQueueApi.quarantine.release(workspaceId, target.id);
      setQuarantine((current) => current.filter((entry) => entry.id !== target.id));
      setReleaseTarget(null);
      addToast('Chunk released and re-indexed.', 'success');
    } catch (reason) {
      addToast(reason instanceof Error ? reason.message : 'Could not release this chunk.', 'error');
    } finally {
      setQuarantineActing(null);
    }
  }, [workspaceId, releaseTarget, addToast]);

  const dismissChunk = useCallback(
    async (chunk: QuarantinedChunk) => {
      if (!workspaceId) return;
      setQuarantineActing(chunk.id);
      try {
        await reviewQueueApi.quarantine.dismiss(workspaceId, chunk.id);
        setQuarantine((current) => current.filter((entry) => entry.id !== chunk.id));
        addToast('Chunk dismissed — it stays out of retrieval.', 'success');
      } catch (reason) {
        addToast(reason instanceof Error ? reason.message : 'Could not dismiss this chunk.', 'error');
      } finally {
        setQuarantineActing(null);
      }
    },
    [workspaceId, addToast],
  );

  const promote = useCallback(
    async (payload: { category: GoldenCategory; reference_answer: string; difficulty: number; notes?: string }) => {
      if (!workspaceId || !promoteTarget) return;
      const target = promoteTarget;
      setPromoting(true);
      try {
        const entry = await reviewQueueApi.promoteGolden(workspaceId, target.id, payload);
        setItems((current) =>
          current.map((item) => (item.id === target.id ? { ...item, golden_entry_id: entry.id } : item)),
        );
        setPromoteTarget(null);
        addToast('Promoted to the golden set.', 'success');
      } catch (reason) {
        addToast(
          reason instanceof Error ? reason.message : 'Could not promote this answer.',
          'error',
        );
      } finally {
        setPromoting(false);
      }
    },
    [workspaceId, promoteTarget, addToast],
  );

  // The count rides in the tab label (rather than a separate pill) so screen
  // readers announce it with the tab name and `ui.tsx`'s shared `Tabs` — which
  // other lanes also depend on — needs no signature change.
  const tabs = useMemo(
    () => [
      { id: 'queue', label: 'Review queue', icon: <ClipboardCheck size={14} /> },
      {
        id: 'quarantine',
        label: quarantine.length > 0 ? `Quarantined content (${quarantine.length})` : 'Quarantined content',
        icon: <ShieldX size={14} />,
      },
    ],
    [quarantine.length],
  );

  // Never leave a confirm/promote dialog armed for a row the user has navigated away from.
  const changeTab = useCallback((tabId: string) => {
    setReleaseTarget(null);
    setPromoteTarget(null);
    setActiveTab(tabId);
  }, []);

  return (
    <div className="mx-auto max-w-5xl py-6">
      <PageShell>
        <PageHeader
          title="Review Queue"
          description="Low-trust answers needing a human decision, sorted from lowest confidence first."
          actions={
            workspaceOwner === user?.id ? (
              <Button size="sm" variant="secondary" onClick={() => void toggleEnabled()}>
                {enabled ? 'Pause queue' : 'Enable queue'}
              </Button>
            ) : undefined
          }
        />

        <Tabs tabs={tabs} activeTab={activeTab} onChange={changeTab} className="mb-4" />

        {activeTab === 'queue' ? (
          loading ? (
            <div className="space-y-3">
              <Skeleton height={150} />
              <Skeleton height={150} />
            </div>
          ) : !enabled ? (
            <EmptyState
              icon={<ShieldAlert size={24} />}
              title="Review queue is paused for this workspace"
              description="The workspace owner opted out of automatic low-confidence review."
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 size={24} />}
              title="Nothing needs review right now"
              description="No pending answers are below the configured trust threshold."
            />
          ) : (
            <div className="space-y-4">
              {items.map((item) => (
                <Card key={item.id} className="p-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <ClipboardCheck size={16} className="text-orange" aria-hidden="true" />
                        <p className="font-medium text-text">{item.query_text}</p>
                        {item.golden_entry_id ? <Badge color="green">Golden ✓</Badge> : null}
                        <span
                          className={`ml-auto rounded-full px-2 py-0.5 text-xs ${
                            getTrustBadgeColor(item.trust_score ?? 0) === 'red'
                              ? 'bg-red/15 text-red'
                              : 'bg-orange/15 text-orange'
                          }`}
                        >
                          {item.trust_score == null
                            ? 'Unscored'
                            : `${(item.trust_score * 100).toFixed(0)}% trust`}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-text-muted">
                        {item.response_text || 'No answer text was persisted.'}
                      </p>
                      <TrustBreakdown item={item} />
                    </div>

                    <div className="w-full space-y-2 sm:max-w-xs">
                      <TextArea
                        rows={2}
                        value={notes[item.id] || ''}
                        onChange={(event) =>
                          setNotes((current) => ({ ...current, [item.id]: event.target.value }))
                        }
                        placeholder="Review note (optional)…"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" loading={acting === item.id} onClick={() => void review(item, 'reviewed')}>
                          <CheckCircle2 size={13} /> Mark reviewed
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={acting === item.id}
                          onClick={() => void review(item, 'dismissed')}
                        >
                          <XCircle size={13} /> Dismiss
                        </Button>
                        {!item.golden_entry_id && (
                          <Button size="sm" variant="ghost" onClick={() => setPromoteTarget(item)}>
                            <Sparkles size={13} /> Promote to golden set
                          </Button>
                        )}
                        <Link to={`/workspaces/${workspaceId}/queries/${item.id}?compare=true`}>
                          <Button size="sm" variant="ghost">
                            <RefreshCw size={13} /> Re-run query
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )
        ) : quarantineLoading ? (
          <div className="space-y-3">
            <Skeleton height={120} />
            <Skeleton height={120} />
          </div>
        ) : quarantineError ? (
          <EmptyState
            icon={<ShieldAlert size={24} />}
            title="Quarantined content unavailable"
            description={quarantineError}
          />
        ) : quarantine.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 size={24} />}
            title="No quarantined content"
            description="No ingested passage has tripped the prompt-injection scanner in this workspace."
          />
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-text-dim">
              These passages were held back at ingest time and are excluded from retrieval. Release
              only after reading the text — releasing re-indexes it verbatim.
            </p>
            {quarantine.map((chunk) => (
              <QuarantineRow
                key={chunk.id}
                chunk={chunk}
                busy={quarantineActing === chunk.id}
                onRelease={() => setReleaseTarget(chunk)}
                onDismiss={() => void dismissChunk(chunk)}
              />
            ))}
          </div>
        )}
      </PageShell>

      {releaseTarget && (
        <Modal open onClose={() => setReleaseTarget(null)} title="Release this chunk into the index?">
          <div className="space-y-4">
            <p className="text-sm text-text-muted">
              The scanner matched <span className="font-medium text-text">{releaseTarget.pattern}</span> (
              {releaseTarget.severity} severity) in passage {releaseTarget.chunk_index + 1} of{' '}
              <span className="font-medium text-text">
                {releaseTarget.document_name || releaseTarget.document_id}
              </span>
              . Releasing re-embeds this text and makes it retrievable by every future answer.
            </p>
            <p className="whitespace-pre-wrap break-words rounded-lg border border-border/60 bg-card-2/50 p-3 font-mono text-xs text-text-muted">
              {releaseTarget.content.slice(0, CONTENT_PREVIEW_CHARS)}
              {releaseTarget.content.length > CONTENT_PREVIEW_CHARS ? '…' : ''}
            </p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setReleaseTarget(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                loading={quarantineActing === releaseTarget.id}
                onClick={() => void confirmRelease()}
              >
                Release chunk
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {promoteTarget && (
        <PromoteGoldenModal
          item={promoteTarget}
          submitting={promoting}
          onClose={() => setPromoteTarget(null)}
          onSubmit={(payload) => void promote(payload)}
        />
      )}
    </div>
  );
}
