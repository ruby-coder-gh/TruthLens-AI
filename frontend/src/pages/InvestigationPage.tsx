import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Download,
  FileSearch,
  Loader2,
  Network,
  Quote,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Badge, Button, Card, TextArea } from '../components/ui';
import { ReasoningTimeline } from '../components/ReasoningTimeline';
import { fadeIn, fadeInScale, fadeInUp, pageTransition, staggerContainer, staggerItem } from '../components/motion';
import { useToast } from '../components/toast-context';
import { PageHeader, PageShell } from '../components/PageWrappers';
import { investigationApi } from '../api/client';
import { downloadBlob } from '../utils/download';
import type {
  InvestigationResponse,
  InvestigationReviewStatus,
  InvestigationSubQuestion,
} from '../api/types';
import { getTrustBadgeColor, getTrustConfidenceLabel } from '../utils/relevance';

const EXAMPLE_QUESTIONS = [
  'What is the evidence for the major risks and their mitigations?',
  'Compare the key findings across these documents and identify conflicts.',
  'Create an executive brief with evidence, gaps, and recommended next actions.',
];
const DEFAULT_TOP_K = 10;

const REVIEW_OPTIONS: Array<{ value: InvestigationReviewStatus; label: string; description: string }> = [
  { value: 'draft', label: 'Draft', description: 'Research complete; no review requested.' },
  { value: 'in_review', label: 'In review', description: 'An analyst is validating the evidence.' },
  { value: 'approved', label: 'Approved', description: 'Evidence and conclusion are approved for use.' },
  { value: 'needs_changes', label: 'Needs changes', description: 'More evidence or clarification is required.' },
];

function formatLatency(milliseconds: number): string {
  return milliseconds < 1000 ? `${milliseconds}ms` : `${(milliseconds / 1000).toFixed(1)}s`;
}

function reviewColor(status: InvestigationReviewStatus): 'green' | 'orange' | 'red' | 'gray' {
  if (status === 'approved') return 'green';
  if (status === 'needs_changes') return 'red';
  if (status === 'in_review') return 'orange';
  return 'gray';
}

function reviewLabel(status: InvestigationReviewStatus): string {
  return REVIEW_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

function CircularGauge({ score }: { score: number }) {
  const size = 88;
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  // Read the theme's trust inks rather than literals, so the gauge follows
  // `[data-theme]` exactly like every `text-green` / `text-orange` label does.
  const color = getTrustBadgeColor(score) === 'green' ? 'var(--color-green)' : getTrustBadgeColor(score) === 'orange' ? 'var(--color-orange)' : 'var(--color-red)';
  return (
    <svg width={size} height={size} role="img" aria-label={`Trust score ${(score * 100).toFixed(0)}%`}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-border)" strokeWidth={strokeWidth} />
      <motion.circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeDasharray={circumference} initial={{ strokeDashoffset: circumference }} animate={{ strokeDashoffset: circumference * (1 - score) }} transition={{ duration: 1.1 }} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fill={color} fontSize="26" fontWeight={700}>{(score * 100).toFixed(0)}</text>
    </svg>
  );
}

function renderReportText(text: string): React.ReactNode {
  return text.split('\n').map((line, index) => {
    const trimmed = line.trim();
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const className = heading[1].length === 1 ? 'mt-6 mb-2 text-lg font-bold text-text' : heading[1].length === 2 ? 'mt-5 mb-2 text-base font-semibold text-text' : 'mt-4 mb-1 text-sm font-semibold text-text';
      return <h3 key={index} className={className}>{heading[2]}</h3>;
    }
    if (trimmed.match(/^[-*]\s+/)) return <li key={index} className="ml-5 list-disc text-sm leading-relaxed text-text-muted">{trimmed.replace(/^[-*]\s+/, '')}</li>;
    if (trimmed.match(/^\d+\.\s+/)) return <li key={index} className="ml-5 list-decimal text-sm leading-relaxed text-text-muted">{trimmed.replace(/^\d+\.\s+/, '')}</li>;
    if (!trimmed) return <div key={index} className="h-2" />;
    return <p key={index} className="text-sm leading-relaxed text-text-muted">{trimmed}</p>;
  });
}

export default function InvestigationPage() {
  const { id: workspaceId } = useParams<{ id: string }>();
  const { addToast } = useToast();
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(DEFAULT_TOP_K);
  const [result, setResult] = useState<InvestigationResponse | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState<InvestigationReviewStatus>('draft');
  const [reviewNote, setReviewNote] = useState('');
  const [exportingAuditBundle, setExportingAuditBundle] = useState(false);

  const runMutation = useMutation({
    mutationFn: () => investigationApi.run(workspaceId!, { query: query.trim(), top_k: topK }),
    onSuccess: (caseFile) => {
      setResult(caseFile);
      setRunError(null);
      setReviewStatus(caseFile.review_status);
      setReviewNote(caseFile.review_note ?? '');
      addToast('Investigation saved as a reviewable case file.', 'success');
    },
    onError: (error: Error) => setRunError(error.message || 'The investigation could not be completed.'),
  });

  const reviewMutation = useMutation({
    mutationFn: () => investigationApi.review(workspaceId!, result!.id, { review_status: reviewStatus, review_note: reviewNote.trim() || undefined }),
    onSuccess: (caseFile) => {
      setResult(caseFile);
      setReviewStatus(caseFile.review_status);
      setReviewNote(caseFile.review_note ?? '');
      addToast(`Case marked ${reviewLabel(caseFile.review_status).toLowerCase()}.`, 'success');
    },
    onError: (error: Error) => addToast(error.message || 'Could not update the review state.', 'error'),
  });

  const isLoading = runMutation.isPending;
  const citations = useMemo(() => (result?.sub_questions ?? []).flatMap((subQuestion, subQuestionIndex) =>
    (subQuestion.citations ?? []).map((citation, citationIndex) => ({ citation, subQuestion, subQuestionIndex, citationIndex })),
  ), [result]);

  const handleSubmit = useCallback((event?: FormEvent) => {
    event?.preventDefault();
    if (!query.trim() || !workspaceId || isLoading) return;
    setResult(null);
    setRunError(null);
    runMutation.mutate();
  }, [isLoading, query, runMutation, workspaceId]);

  const copyReport = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.final_report);
      addToast('Report copied to clipboard.', 'success');
    } catch {
      addToast('Could not copy the report. Check browser permissions.', 'error');
    }
  };

  const exportReport = () => {
    if (!result) return;
    const evidence = citations.map(({ citation, subQuestion }, index) => `- [${index + 1}] ${citation.text || 'Cited passage'}\n  Sub-question: ${subQuestion.question}\n  Chunk: ${citation.chunk_id}`).join('\n');
    const content = [`# Investigation Case File`, '', `**Question:** ${result.query}`, `**Case ID:** ${result.id}`, `**Review status:** ${reviewLabel(result.review_status)}`, `**Trust score:** ${result.trust_score != null ? `${(result.trust_score * 100).toFixed(0)}%` : 'Unavailable'}`, '', '## Report', result.final_report, '', '## Evidence Register', evidence || 'No source spans were returned for this case.'].join('\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `truthlens-case-${result.id}.md`;
    link.click();
    URL.revokeObjectURL(url);
    addToast('Evidence-backed case file exported.', 'success');
  };

  const exportAuditBundle = async () => {
    if (!result || !workspaceId) return;
    setExportingAuditBundle(true);
    try {
      const { blob, filename } = await investigationApi.exportAuditBundle(workspaceId, result.id);
      downloadBlob(blob, filename);
      addToast('Audit bundle downloaded and export logged to the audit trail.', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Could not prepare the audit bundle.', 'error');
    } finally {
      setExportingAuditBundle(false);
    }
  };

  const shareCase = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(`TruthLens case ${result.id}\nWorkspace: ${result.workspace_id}\nQuestion: ${result.query}\nReview: ${reviewLabel(result.review_status)}`);
      addToast('Case reference copied. Workspace access is still required to open it.', 'success');
    } catch {
      addToast('Could not copy the case reference.', 'error');
    }
  };

  return (
    <div className="-mx-4 px-4 lg:-mx-6 lg:px-8 xl:px-12">
      <motion.div className="mx-auto max-w-5xl py-6" variants={pageTransition} initial="initial" animate="animate">
        <PageShell className="space-y-6">
          <motion.div variants={fadeInUp}>
            <PageHeader
              title={<span className="inline-flex items-center gap-2"><span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-accent/20"><Network size={16} className="text-primary-soft" /></span><span className="gradient-text">Investigation workspace</span></span>}
              description="Create a reviewable, evidence-backed case file for complex questions across your governed workspace."
              actions={result ? <Badge color={reviewColor(result.review_status)}>{reviewLabel(result.review_status)}</Badge> : undefined}
            />
          </motion.div>

          <motion.div variants={fadeInScale}>
            <Card className="space-y-4 p-4 lg:p-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                <TextArea placeholder="Ask a complex research question..." value={query} onChange={(event) => setQuery(event.target.value)} rows={4} disabled={isLoading} className="min-h-[120px] text-base" />
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <label className="flex items-center gap-2 text-sm text-text-muted">Top sources:
                    <input type="number" min={1} max={50} value={topK} onChange={(event) => setTopK(Math.max(1, Math.min(50, Number(event.target.value) || DEFAULT_TOP_K)))} disabled={isLoading} className="w-16 rounded-md border border-border bg-solid px-2 py-1.5 text-sm text-text focus:border-primary/50 focus:outline-none" />
                  </label>
                  <Button type="submit" size="lg" disabled={!query.trim() || isLoading} loading={isLoading}>{isLoading ? <><Loader2 size={18} className="animate-spin" /> Investigating…</> : <><Search size={18} /> Create case file</>}</Button>
                </div>
              </form>
              {!result && !isLoading && <div className="flex flex-wrap gap-2 border-t border-border pt-3"><span className="inline-flex items-center gap-1 text-xs text-text-dim"><Sparkles size={12} /> Try:</span>{EXAMPLE_QUESTIONS.map((example) => <button key={example} type="button" onClick={() => setQuery(example)} className="rounded-full border border-border bg-card-2 px-3 py-1 text-xs text-text-muted hover:border-primary/30 hover:text-primary-soft">{example}</button>)}</div>}
            </Card>
          </motion.div>

          <AnimatePresence mode="wait">
            {isLoading && <motion.div key="loading" variants={fadeIn} initial="initial" animate="animate" exit="exit" className="space-y-4"><Card className="space-y-4 p-6"><div className="flex items-center gap-3"><Loader2 size={20} className="animate-spin text-primary-soft" /><div><p className="text-sm font-medium text-text">Building your case file</p><p className="text-xs text-text-muted">Decomposing the question, retrieving evidence, evaluating claims, and preserving the result.</p></div></div><div className="h-2 overflow-hidden rounded-full bg-card-2"><motion.div className="h-full w-2/3 rounded-full bg-gradient-to-r from-primary via-accent to-primary" initial={{ x: '-100%' }} animate={{ x: '160%' }} transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }} /></div></Card><ReasoningTimeline isLoading /></motion.div>}
          </AnimatePresence>

          {runError && <Card className="border-red/30 bg-red/5 p-5"><p className="text-sm font-medium text-red">Investigation failed</p><p className="mt-1 text-sm text-text-muted">{runError}</p><Button className="mt-4" variant="secondary" size="sm" onClick={() => runMutation.mutate()}><Search size={14} /> Retry investigation</Button></Card>}

          {result && !isLoading && (
            <motion.div className="space-y-6" variants={staggerContainer} initial="initial" animate="animate">
              <motion.div variants={staggerItem}><CaseControlBar result={result} onCopy={copyReport} onExport={exportReport} onAuditExport={() => void exportAuditBundle()} exportingAuditBundle={exportingAuditBundle} onShare={shareCase} /></motion.div>
              {result.error ? <motion.div variants={staggerItem}><Card className="border-red/30 bg-red/5 p-5"><p className="text-sm font-medium text-red">Case saved with an execution error</p><p className="mt-1 text-sm text-text-muted">{result.error}</p></Card></motion.div> : <motion.div variants={staggerItem}><FinalReportCard report={result.final_report} /></motion.div>}
              <motion.div variants={staggerItem}><ReviewWorkflowCard status={reviewStatus} note={reviewNote} onStatusChange={setReviewStatus} onNoteChange={setReviewNote} onSave={() => reviewMutation.mutate()} saving={reviewMutation.isPending} /></motion.div>
              <motion.div variants={staggerItem}><EvidenceRegister citations={citations} /></motion.div>
              {result.sub_questions && result.sub_questions.length > 0 && <motion.div variants={staggerItem}><SubQuestionsSection questions={result.sub_questions} /></motion.div>}
              <motion.div variants={staggerItem}><ReasoningTimeline trace={result.reasoning_trace} subQuestions={result.sub_questions} /></motion.div>
              {result.trust_score != null && <motion.div variants={staggerItem}><TrustScoreSection score={result.trust_score} components={result.trust_components ?? {}} /></motion.div>}
              <motion.div variants={staggerItem}><MetadataFooter result={result} citationCount={citations.length} /></motion.div>
            </motion.div>
          )}
        </PageShell>
      </motion.div>
    </div>
  );
}

function CaseControlBar({ result, onCopy, onExport, onAuditExport, exportingAuditBundle, onShare }: { result: InvestigationResponse; onCopy: () => void; onExport: () => void; onAuditExport: () => void; exportingAuditBundle: boolean; onShare: () => void }) {
  return <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-wider text-text-dim">Case file</p><p className="mt-1 font-mono text-xs text-text-muted">{result.id}</p></div><div className="flex flex-wrap gap-2"><Button variant="secondary" size="sm" onClick={onCopy}><Copy size={14} /> Copy</Button><Button variant="secondary" size="sm" onClick={onExport}><Download size={14} /> Export .md</Button><Button size="sm" loading={exportingAuditBundle} onClick={onAuditExport}><ShieldCheck size={14} /> {exportingAuditBundle ? 'Preparing export…' : 'Export Audit Bundle'}</Button><Button variant="secondary" size="sm" onClick={onShare}><Share2 size={14} /> Share reference</Button></div></Card>;
}

function FinalReportCard({ report }: { report: string }) {
  return <Card className="space-y-3 overflow-hidden p-4 lg:p-6"><div className="flex items-center gap-2 border-b border-border pb-3"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary-soft"><Sparkles size={18} /></div><div><h2 className="text-base font-semibold text-text">Executive report</h2><p className="text-xs text-text-dim">Grounded synthesis; validate each material claim against the evidence register below.</p></div></div><div className="prose-custom space-y-1">{renderReportText(report)}</div></Card>;
}

function ReviewWorkflowCard({ status, note, onStatusChange, onNoteChange, onSave, saving }: { status: InvestigationReviewStatus; note: string; onStatusChange: (status: InvestigationReviewStatus) => void; onNoteChange: (note: string) => void; onSave: () => void; saving: boolean }) {
  return <Card className="space-y-4 p-4 lg:p-6"><div className="flex items-center gap-2 border-b border-border pb-3"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent"><ClipboardCheck size={18} /></div><div><h2 className="text-base font-semibold text-text">Review workflow</h2><p className="text-xs text-text-dim">Review decisions and notes are saved to the case and audited.</p></div></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{REVIEW_OPTIONS.map((option) => <button key={option.value} type="button" onClick={() => onStatusChange(option.value)} className={clsx('rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50', status === option.value ? 'border-primary/50 bg-primary/10' : 'border-border bg-card-2 hover:border-primary/25')}><p className="text-sm font-medium text-text">{option.label}</p><p className="mt-1 text-[11px] leading-relaxed text-text-dim">{option.description}</p></button>)}</div><TextArea value={note} onChange={(event) => onNoteChange(event.target.value)} rows={3} placeholder="Reviewer note: evidence gaps, approval rationale, or required changes…" /><div className="flex justify-end"><Button onClick={onSave} loading={saving}><ShieldCheck size={15} /> Save review decision</Button></div></Card>;
}

function EvidenceRegister({ citations }: { citations: Array<{ citation: { text: string; chunk_id: string }; subQuestion: InvestigationSubQuestion; subQuestionIndex: number; citationIndex: number }> }) {
  return <Card className="space-y-3 p-4 lg:p-6"><div className="flex items-center gap-2 border-b border-border pb-3"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold/15 text-gold"><Quote size={18} /></div><div><h2 className="text-base font-semibold text-text">Evidence register</h2><p className="text-xs text-text-dim">Source spans preserved with the case at generation time.</p></div><Badge color="purple" className="ml-auto">{citations.length}</Badge></div>{citations.length === 0 ? <div className="rounded-xl border border-orange/20 bg-orange/5 p-4 text-sm text-text-muted">No source spans were returned. Treat this report as unverified and request more documents or rerun the investigation.</div> : <div className="space-y-2">{citations.map(({ citation, subQuestion, subQuestionIndex }, index) => <div key={`${citation.chunk_id}-${index}`} className="rounded-xl border border-border bg-bg-soft p-3"><div className="flex flex-wrap items-center gap-2"><Badge color="purple">S{index + 1}</Badge><span className="font-mono text-[11px] text-text-dim">Chunk {citation.chunk_id}</span><span className="text-[11px] text-text-dim">Question {subQuestionIndex + 1}</span></div><p className="mt-2 text-sm leading-relaxed text-text-muted">{citation.text || 'Cited evidence span'}</p><p className="mt-2 text-xs text-primary-soft">{subQuestion.question}</p></div>)}</div>}</Card>;
}

function SubQuestionsSection({ questions }: { questions: InvestigationSubQuestion[] }) {
  return <Card className="space-y-3 p-4 lg:p-6"><div className="flex items-center gap-2 border-b border-border pb-3"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent"><FileSearch size={18} /></div><h2 className="text-base font-semibold text-text">Research ledger ({questions.length})</h2></div><div className="space-y-2">{questions.map((question, index) => <div key={question.id} className="rounded-xl border border-border bg-bg-soft p-3"><div className="flex flex-wrap items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-xs font-medium text-primary-soft">{index + 1}</span><p className="font-medium text-text">{question.question}</p><Badge color={question.guardrail_passed === false ? 'red' : 'green'} className="ml-auto">{question.guardrail_passed === false ? 'Review evidence' : 'Grounded'}</Badge></div>{question.purpose && <p className="mt-2 text-xs text-text-dim">Purpose: {question.purpose}</p>}{question.partial_answer && <p className="mt-2 text-sm leading-relaxed text-text-muted">{question.partial_answer}</p>}<div className="mt-3 flex flex-wrap gap-3 text-xs text-text-dim"><span>{question.citations?.length ?? 0} cited spans</span>{question.trust_score != null && <span>Trust {(question.trust_score * 100).toFixed(0)}%</span>}{question.latency_ms != null && <span>{formatLatency(question.latency_ms)}</span>}</div></div>)}</div></Card>;
}

function TrustScoreSection({ score, components }: { score: number; components: Record<string, number> }) {
  return <Card className="space-y-4 p-4 lg:p-6"><div className="flex items-center gap-2 border-b border-border pb-3"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green/15 text-green"><CheckCircle2 size={18} /></div><h2 className="text-base font-semibold text-text">Trust assessment</h2></div><div className="flex flex-col gap-6 sm:flex-row"><div className="flex shrink-0 flex-col items-center"><CircularGauge score={score} /><p className="mt-2 text-sm font-medium text-text">{getTrustConfidenceLabel(score)}</p><p className="text-xs text-text-muted">Overall confidence</p></div><div className="flex-1 space-y-3">{Object.entries(components).map(([key, value]) => <div key={key} className="space-y-1"><div className="flex justify-between text-xs"><span className="capitalize text-text-muted">{key.replace(/_/g, ' ')}</span><span className="font-medium text-text">{(value * 100).toFixed(0)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-card-2"><div className={clsx('h-full rounded-full', getTrustBadgeColor(value) === 'green' ? 'bg-green' : getTrustBadgeColor(value) === 'orange' ? 'bg-orange' : 'bg-red')} style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} /></div></div>)}</div></div></Card>;
}

function MetadataFooter({ result, citationCount }: { result: InvestigationResponse; citationCount: number }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card-2 px-4 py-3 text-xs text-text-dim"><div className="flex flex-wrap items-center gap-3"><span>{formatLatency(result.latency_ms)}</span><span>{result.sub_questions?.length ?? 0} research questions</span><span>{citationCount} evidence spans</span></div><span>Created {new Date(result.created_at).toLocaleString()}</span></div>;
}
