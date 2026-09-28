// Chat detail, redesigned as a Claim Ledger (Lane D1, design direction C).
// Same ledger/prose/exhibits/trust presentation as the live chat, built from
// the stored QueryDetail instead of a WebSocket stream — the audit record
// here only carries latency (no per-phase counts were persisted for
// historical queries).
import { useCallback, useState, useEffect, useMemo } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Clock, GitCompareArrows, ExternalLink } from 'lucide-react';
import { Button, Card, Badge, LoadingSpinner, ProgressBar } from '../components/ui';
import { pageTransition, staggerItem } from '../components/motion';
import { PageHeader, PageShell } from '../components/PageWrappers';
import { queryApi, radarApi, feedbackApi } from '../api/client';
import type { QueryDetail, Source, QueryComparison, Contradiction } from '../api/types';
import AnswerComparison from '../components/AnswerComparison';
import AnnotationThread from '../components/AnnotationThread';
import AbstentionCard from '../components/AbstentionCard';
import { SealReceiptButton } from '../components/SealReceiptButton';
import { useToast } from '../components/toast-context';
import { downloadBlob } from '../utils/download';
import { AuditTrail } from '../components/ledger/AuditTrail';
import { ClaimLedger } from '../components/ledger/ClaimLedger';
import { ProseAnswer } from '../components/ledger/ProseAnswer';
import { Exhibits } from '../components/ledger/Exhibits';
import { TrustTotals } from '../components/ledger/TrustTotals';
import { tallyClaims } from '../components/ledger/verdict';
import { useAnswerView } from '../components/ledger/useAnswerView';
import { citedSourceIndices } from '../components/ledger/citedSources';
import { pairClaimConflicts, countSourceConflicts } from '../components/ledger/conflicts';
import { ClaimTallyChips, AnswerActionBar } from '../components/ledger/AnswerActions';
import { clsx } from 'clsx';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ChatDetailPage() {
  const { queryId } = useParams<{ queryId: string }>();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState<QueryDetail | null>(null);
  const [comparison, setComparison] = useState<QueryComparison | null>(null);
  const [comparing, setComparing] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [contradictions, setContradictions] = useState<Contradiction[]>([]);
  const [view, setView] = useAnswerView();
  const { addToast } = useToast();

  useEffect(() => {
    if (!queryId) return;
    queryApi.getAnywhere(queryId)
      .then((data) => {
        setQuery(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load chat');
        setLoading(false);
      });
  }, [queryId]);

  // Open Radar contradictions, for the same claim-conflict pairing the live
  // chat draws — best-effort, a failed fetch just means no conflict rows.
  useEffect(() => {
    if (!query?.workspace_id) return undefined;
    let cancelled = false;
    radarApi.get(query.workspace_id, 'open').then((r) => { if (!cancelled) setContradictions(r.contradictions); }).catch(() => {});
    return () => { cancelled = true; };
  }, [query?.workspace_id]);

  const runComparison = useCallback(async () => {
    if (!query || comparing) return;
    setComparing(true);
    setComparisonError(null);
    try {
      const result = await queryApi.compare(query.workspace_id, query.id);
      setComparison(result);
    } catch (err) {
      setComparisonError(err instanceof Error ? err.message : 'Could not re-run the comparison.');
    } finally {
      setComparing(false);
    }
  }, [query, comparing]);

  useEffect(() => {
    if (query && searchParams.get('compare') === 'true' && !comparison && !comparing) {
      const timer = window.setTimeout(() => { void runComparison(); }, 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [query, searchParams, comparison, comparing, runComparison]);

  const sources: Source[] = useMemo(() => {
    const rawSources = Array.isArray(query?.response_sources)
      ? (query!.response_sources as unknown as Record<string, unknown>[])
      : [];
    return rawSources.map((s) => {
      const meta = s.metadata as Record<string, unknown> | undefined;
      const docId = (s.document_id as string) || '';
      let docName = (s.document_name as string) || '';
      if (!docName && meta?.document_name) docName = meta.document_name as string;
      if (!docName) docName = docId ? docId.slice(0, 8) + '...' : 'Unknown';

      return {
        chunk_id: (s.chunk_id as string) || '',
        document_id: docId,
        document_name: docName,
        excerpt: (s.excerpt as string) || (s.content as string) || '',
        relevance_score: (s.relevance_score as number) ?? (s.score as number) ?? 0,
        rerank_score: (s.rerank_score as number) ?? undefined,
        // The persisted `response_sources` blob never carried a top-level
        // page_number (only inside `metadata`, if at all) — Exhibits also
        // backfills from a citing claim (`claims` prop below), but this
        // covers a retrieved-and-not-cited source too (BUG-8).
        page_number: (s.page_number as number) ?? (meta?.page_number as number) ?? undefined,
        confidence: (s.confidence as number) ?? undefined,
        matched_chunks: (s.matched_chunks as number) ?? undefined,
      };
    });
  }, [query]);

  // BUG-22: a stored answer's persisted sources never carried a `conflicts`
  // count (only live WS "sources" frames compute it); recompute it from the
  // same open-contradictions list the ledger already fetches, so the
  // Exhibits "Conflict" tag doesn't silently vanish on this page.
  const sourcesWithConflicts = useMemo(() => countSourceConflicts(sources, contradictions), [sources, contradictions]);

  const handleCopy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        addToast('Copied to clipboard', 'success');
      } catch {
        addToast('Failed to copy', 'error');
      }
    },
    [addToast],
  );

  const handleExport = useCallback(async () => {
    if (!query) return;
    try {
      const { blob, filename } = await queryApi.exportMarkdown(query.id);
      downloadBlob(blob, filename);
    } catch {
      addToast('Failed to export', 'error');
    }
  }, [query, addToast]);

  const handleFeedback = useCallback(
    async (rating: number) => {
      if (!query) return;
      try {
        await feedbackApi.submit(query.id, { rating });
        addToast('Feedback submitted', 'success');
      } catch {
        addToast('Failed to submit feedback', 'error');
      }
    },
    [query, addToast],
  );

  if (loading) {
    return <LoadingSpinner text="Loading chat detail..." />;
  }

  if (error || !query) {
    return (
      <div className="-mx-4 lg:-mx-6 px-4 lg:px-8 xl:px-12">
        <motion.div className="mx-auto max-w-3xl space-y-5 py-6" variants={pageTransition} initial="initial" animate="animate">
          <PageShell>
            <PageHeader
              title="Chat Detail"
              description="Review question, response, and sources."
              actions={(
                <Link to="/chats" className="inline-flex items-center gap-1 text-sm text-primary-soft hover:text-primary">
                  <ArrowLeft size={14} /> Back to history
                </Link>
              )}
            />
            <Card className="p-8 text-center">
              <p className="text-text-dim">{error || 'Chat not found'}</p>
              <Link to="/chats">
                <Button size="sm" className="mt-4">Back to Chat History</Button>
              </Link>
            </Card>
          </PageShell>
        </motion.div>
      </div>
    );
  }

  const abstained = query.edge_case === 'insufficient_evidence';
  const claims = query.claims ?? [];
  const hasClaims = claims.length > 0;
  const tally = hasClaims ? tallyClaims(claims) : null;
  const conflictPairs = hasClaims ? pairClaimConflicts(claims, contradictions) : [];
  const allDocNames = sources.map((s) => s.document_name).filter((n): n is string => Boolean(n));
  const cited = citedSourceIndices(query.response_text ?? '', query.claims);

  return (
    <div className="-mx-4 lg:-mx-6 px-4 lg:px-8 xl:px-12">
      <motion.div className="mx-auto max-w-3xl space-y-5 py-6" variants={pageTransition} initial="initial" animate="animate">
      <PageShell>
      <motion.div variants={staggerItem}>
        <PageHeader
          title="Chat Detail"
          description="Review question, response, and sources."
          actions={(
            <Link to="/chats" className="inline-flex items-center gap-1 text-sm text-primary-soft hover:text-primary">
              <ArrowLeft size={14} /> Back to history
            </Link>
          )}
        />
      </motion.div>

      {/* Question */}
      <motion.div variants={staggerItem}>
        <h2 className="text-xl font-semibold leading-7 tracking-tight text-text">{query.query_text}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1 text-xs text-text-dim">
            <Clock size={11} />
            {formatDate(query.created_at)}
          </span>
          {query.model_used && <Badge color="gray">{query.model_used}</Badge>}
          {query.prompt_version && <Badge color="purple" className="font-mono">prompt {query.prompt_version}</Badge>}
        </div>
      </motion.div>

      {/* Response */}
      <motion.div variants={staggerItem} className="space-y-5">
        {abstained ? (
          <AbstentionCard answer={query.response_text} workspaceId={query.workspace_id} />
        ) : query.response_text ? (
          <>
            {!abstained && (
              <AuditTrail
                running={false}
                stopped={false}
                phase="guardrail"
                foundCount={null}
                keptCount={null}
                wordsCount={null}
                liveWordCount={0}
                documentsSearched={null}
                claimsTally={tally}
                modelUsed={query.model_used ?? null}
                startedAt={null}
                latencyMs={query.latency_ms ?? null}
                guardrailPassed={query.guardrail_passed ?? null}
              />
            )}

            {hasClaims && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex gap-0.5 rounded-control border border-border bg-card-2 p-0.5">
                  <button type="button" onClick={() => setView('ledger')} aria-pressed={view === 'ledger'} className={clsx('inline-flex min-h-8 items-center rounded px-2.5 text-sm font-medium', view === 'ledger' ? 'bg-solid text-text shadow-e1' : 'text-text-muted hover:text-text')}>
                    Claim ledger
                  </button>
                  <button type="button" onClick={() => setView('prose')} aria-pressed={view === 'prose'} className={clsx('inline-flex min-h-8 items-center rounded px-2.5 text-sm font-medium', view === 'prose' ? 'bg-solid text-text shadow-e1' : 'text-text-muted hover:text-text')}>
                    Read as prose
                  </button>
                </div>
                {/* BUG-22: the stored-answer page used to have no claim-summary
                    chips at all — same component the live chat uses. */}
                <ClaimTallyChips claims={claims} tally={tally!} conflictPairs={conflictPairs} onSelectLedgerView={() => setView('ledger')} />
              </div>
            )}

            {hasClaims && view === 'ledger' ? (
              <ClaimLedger claims={claims} sources={sourcesWithConflicts} allDocNames={allDocNames} contradictions={contradictions} workspaceId={query.workspace_id} />
            ) : (
              <ProseAnswer content={query.response_text} sources={sources} claims={hasClaims ? claims : null} workspaceId={query.workspace_id} />
            )}

            {sources.length > 0 && (
              <Exhibits sources={sourcesWithConflicts} citedIndices={cited} allDocNames={allDocNames} workspaceId={query.workspace_id} claims={query.claims} />
            )}

            {query.trust_score !== undefined && (
              <TrustTotals score={query.trust_score} components={query.trust_components ?? {}} />
            )}

            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <SealReceiptButton queryId={query.id} />
              {/* BUG-22: same Copy/Export/feedback/Regenerate action bar as
                  the live chat. "Regenerate" here re-runs the query and
                  shows what changed (this page's own "Re-run comparison"
                  below does the same thing) — there's no live WS on a stored
                  answer to replace the shown content in place the way the
                  chat's Regenerate does. */}
              <AnswerActionBar
                content={query.response_text}
                onCopy={handleCopy}
                onExport={handleExport}
                onFeedback={handleFeedback}
                onRegenerate={() => void runComparison()}
                canRegenerate
                modelUsed={query.model_used}
                latencyMs={query.latency_ms ?? null}
              />
            </div>
          </>
        ) : (
          <p className="text-sm text-text-dim">No response</p>
        )}
      </motion.div>

      <motion.div variants={staggerItem}>
        <AnnotationThread workspaceId={query.workspace_id} queryId={query.id} label="Answer comments" />
      </motion.div>

      <motion.div variants={staggerItem}>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="secondary" loading={comparing} onClick={() => void runComparison()}>
            <GitCompareArrows size={14} /> Re-run comparison
          </Button>
          {comparing && <div className="min-w-[220px] flex-1"><ProgressBar value={65} size="sm" label="Retrieving current evidence, generating, and scoring…" /></div>}
        </div>
        {comparisonError && <p className="mt-2 text-xs text-red">{comparisonError}</p>}
      </motion.div>

      {comparison && <motion.div variants={staggerItem}><AnswerComparison comparison={comparison} /></motion.div>}

      {sources.length > 0 && (
        <motion.div variants={staggerItem}>
          <Card className="p-5">
            <h3 className="mb-3 text-sm font-medium text-text">Source comments</h3>
            <div className="space-y-2">
              {sources.filter((s) => s.chunk_id).map((s, i) => (
                <AnnotationThread key={s.chunk_id || i} workspaceId={query.workspace_id} queryId={query.id} sourceId={s.chunk_id} label={s.document_name || `Source ${i + 1}`} compact />
              ))}
            </div>
          </Card>
        </motion.div>
      )}

      <motion.div variants={staggerItem}>
        <Link to={`/workspaces/${query.workspace_id}/chat`}>
          <Button size="sm" variant="secondary">
            <ExternalLink size={14} />
            Open in Workspace
          </Button>
        </Link>
      </motion.div>
      </PageShell>
      </motion.div>
    </div>
  );
}
