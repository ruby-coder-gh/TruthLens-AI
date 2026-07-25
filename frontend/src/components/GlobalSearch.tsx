import { useEffect, useMemo, useState } from 'react';
import { FileText, MessageSquare, Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Input, Modal, Skeleton, EmptyState, Badge } from './ui';
import { searchApi } from '../api/client';
import type { SearchResult } from '../api/types';

function highlight(text: string, query: string) {
  if (!query.trim()) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'));
  return parts.map((part, index) => (
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={index} className="rounded bg-gold/25 px-0.5 text-text">{part}</mark>
      : <span key={index}>{part}</span>
  ));
}

export default function GlobalSearch() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [workspaceCount, setWorkspaceCount] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !query.trim()) {
      const reset = window.setTimeout(() => {
        setResults([]);
        setLoading(false);
      }, 0);
      return () => window.clearTimeout(reset);
    }
    const timeout = window.setTimeout(() => {
      setLoading(true);
      searchApi.search({ q: query.trim(), page_size: 50, per_workspace: 8 })
        .then((response) => {
          setResults(response.data);
          setWorkspaceCount(Number(response.meta.workspace_count || 0));
        })
        .catch(() => {
          setResults([]);
          setWorkspaceCount(0);
        })
        .finally(() => setLoading(false));
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [open, query]);

  const groups = useMemo(() => {
    const grouped = new Map<string, SearchResult[]>();
    for (const result of results) {
      const group = grouped.get(result.workspace_name) ?? [];
      group.push(result);
      grouped.set(result.workspace_name, group);
    }
    return Array.from(grouped.entries());
  }, [results]);

  const openResult = (result: SearchResult) => {
    setOpen(false);
    setQuery('');
    navigate(result.resource_type === 'query'
      ? `/workspaces/${result.workspace_id}/queries/${result.id}`
      : `/workspaces/${result.workspace_id}/documents/${result.id}`,
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full max-w-md items-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.03] px-3 py-2 text-left text-sm text-text-dim transition-colors hover:border-primary/35 hover:text-text"
        aria-label="Search all accessible workspaces"
      >
        <Search size={16} />
        <span className="flex-1">Search all workspaces…</span>
        <kbd className="rounded border border-white/[0.1] px-1.5 py-0.5 text-[10px]">⌘K</kbd>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Search all workspaces" className="max-w-3xl">
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search questions, answers, and document names…"
          icon={<Search size={16} />}
          suffix={query ? <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X size={15} /></button> : undefined}
        />
        <div className="mt-4 max-h-[60vh] overflow-y-auto pr-1">
          {loading && <div className="space-y-3 py-2"><Skeleton height={18} width="28%" /><Skeleton height={70} /><Skeleton height={70} /></div>}
          {!loading && query.trim() && results.length === 0 && (
            <EmptyState icon={<Search size={22} />} title={`No results across your ${workspaceCount} workspaces`} description="Try a different question, answer phrase, or filename." className="py-10" />
          )}
          {!loading && groups.map(([workspaceName, group]) => (
            <section key={workspaceName} className="mb-5 last:mb-0">
              <div className="mb-2 flex items-center gap-2"><h3 className="text-xs font-semibold uppercase tracking-wider text-text-dim">{workspaceName}</h3><Badge color="gray">{group.length}</Badge></div>
              <div className="space-y-2">
                {group.map((result) => {
                  const Icon = result.resource_type === 'query' ? MessageSquare : FileText;
                  return <button key={`${result.resource_type}-${result.id}`} type="button" onClick={() => openResult(result)} className="flex w-full items-start gap-3 rounded-xl border border-border bg-bg-soft p-3 text-left transition-colors hover:border-primary/35 hover:bg-primary/5">
                    <span className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary-soft"><Icon size={15} /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-text">{highlight(result.title, query)}</span><span className="mt-1 block text-xs leading-relaxed text-text-muted">{highlight(result.snippet, query)}</span></span>
                    <Badge color="gray">{result.resource_type}</Badge>
                  </button>;
                })}
              </div>
            </section>
          ))}
          {!query.trim() && <p className="py-8 text-center text-sm text-text-dim">Search every workspace you can access without starting a RAG run.</p>}
        </div>
      </Modal>
    </>
  );
}
