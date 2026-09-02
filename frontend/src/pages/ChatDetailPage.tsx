import { useCallback, useState, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, MessageSquare, Clock, Shield, FileText, ExternalLink, GitCompareArrows } from 'lucide-react';
import { Button, Card, Badge, LoadingSpinner, ProgressBar } from '../components/ui';
import { pageTransition, staggerItem } from '../components/motion';
import { PageHeader, PageShell } from '../components/PageWrappers';
import { queryApi } from '../api/client';
import type { QueryDetail, Source, QueryComparison } from '../api/types';
import AnswerComparison from '../components/AnswerComparison';
import AnnotationThread from '../components/AnnotationThread';
import { getRelevanceMeta, getTrustBadgeColor } from '../utils/relevance';

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

  // Map stored response_sources (DB JSON) to Source interface
  // Stored format uses: content, score, metadata.document_name
  // Source interface uses: excerpt, relevance_score, document_name
  const rawSources = Array.isArray(query.response_sources)
    ? (query.response_sources as unknown as Record<string, unknown>[])
    : [];
  const sources: Source[] = rawSources.map((s) => {
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
      confidence: (s.confidence as number) ?? undefined,
      matched_chunks: (s.matched_chunks as number) ?? undefined,
    };
  });

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

      {/* Query */}
      <motion.div variants={staggerItem}>
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <MessageSquare size={14} className="text-primary-soft" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text">You</p>
              <p className="mt-1 text-sm text-text">{query.query_text}</p>
              <div className="flex items-center gap-3 mt-2">
                <span className="flex items-center gap-1 text-xs text-text-dim">
                  <Clock size={11} />
                  {formatDate(query.created_at)}
                </span>
                {query.model_used && (
                  <Badge color="gray">{query.model_used}</Badge>
                )}
                {query.prompt_version && (
                  <Badge color="purple" className="font-mono">prompt {query.prompt_version}</Badge>
                )}
              </div>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Response */}
      <motion.div variants={staggerItem}>
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10">
              <Shield size={14} className="text-accent" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text">TruthLens AI</p>
              <div className="mt-2 text-sm text-text leading-relaxed whitespace-pre-wrap">
                {query.response_text || <span className="text-text-dim">No response</span>}
              </div>

              {/* Trust score */}
              {query.trust_score !== undefined && (
                <div className="mt-3 flex items-center gap-2">
                  <Badge color={getTrustBadgeColor(query.trust_score)}>
                    Trust Score: {query.trust_score.toFixed(2)}
                  </Badge>
                  {query.guardrail_passed !== undefined && (
                    <Badge color={query.guardrail_passed ? 'green' : 'red'}>
                      Guardrail: {query.guardrail_passed ? 'Passed' : 'Failed'}
                    </Badge>
                  )}
                </div>
              )}

              {query.latency_ms !== undefined && (
                <p className="mt-2 text-xs text-text-dim">
                  {query.latency_ms}ms · {query.token_count || 0} tokens
                </p>
              )}
            </div>
          </div>
        </Card>
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

      {/* Sources */}
      {sources.length > 0 && (
        <motion.div variants={staggerItem}>
          <Card className="p-5">
            <h3 className="text-sm font-medium text-text flex items-center gap-2 mb-3">
              <FileText size={14} /> Sources ({sources.length})
            </h3>
            <div className="space-y-2">
              {sources.map((s, i) => (
                <div key={s.chunk_id || i} className="rounded-lg bg-surface/50 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-medium text-primary-soft truncate">
                      {s.document_name || `Source ${i + 1}`}
                    </span>
                    <Badge color={getRelevanceMeta(s.relevance_score).badgeColor}>{(s.relevance_score * 100).toFixed(0)}%</Badge>
                  </div>
                  <p className="text-xs text-text-dim line-clamp-2">{s.excerpt}</p>
                  {s.chunk_id && <AnnotationThread workspaceId={query.workspace_id} queryId={query.id} sourceId={s.chunk_id} label="Source comments" compact />}
                </div>
              ))}
            </div>
          </Card>
        </motion.div>
      )}

      {/* Open in workspace */}
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
