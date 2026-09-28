// Owning lane: L4 (Receipt FE).
import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Stamp, Copy, ExternalLink, Trash2, ShieldCheck, Eye } from 'lucide-react';
import { Button, Modal } from './ui';
import { useToast } from './toast-context';
import { useAuth } from '../context/auth-context';
import { receiptApi, workspaceApi } from '../api/client';
import type { ReceiptCreated, ReceiptSummary } from '../api/types';
import { QrCode } from './receipt/QrCode';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** First 12 hex chars of a sha256 — enough to eyeball-match, short enough to fit a chip. */
function shortSeal(seal: string): string {
  return seal.slice(0, 12);
}

export function SealReceiptButton({
  queryId,
  /** R2-6: when given, the button hides for a viewer (mirrors the Upload
   *  button's BUG-14 precedent) instead of opening a dialog whose Create
   *  can only 403. Omit it (older callers, tests) to always show. */
  workspaceId,
  className,
}: {
  queryId: string;
  workspaceId?: string;
  className?: string;
}) {
  const { addToast } = useToast();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<ReceiptCreated | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [existing, setExisting] = useState<ReceiptSummary[]>([]);
  const [revokingToken, setRevokingToken] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ReceiptSummary | null>(null);

  // Shared react-query cache key — many SealReceiptButtons can be on screen
  // at once (one per chat turn), so this dedupes to a single request instead
  // of one workspace+members fetch per button.
  const { data: role } = useQuery({
    queryKey: ['workspace-role', workspaceId],
    queryFn: async () => {
      const [workspace, members] = await Promise.all([
        workspaceApi.get(workspaceId!),
        workspaceApi.listMembers(workspaceId!),
      ]);
      const myRole = members.data.find((m) => m.user_id === user?.id)?.role;
      return { isOwner: workspace.owner_id === user?.id, myRole };
    },
    enabled: Boolean(workspaceId && user),
    staleTime: 60_000,
  });
  const canSeal = !workspaceId || role?.isOwner || role?.myRole === 'editor';

  const loadExisting = useCallback(() => {
    receiptApi
      .listForQuery(queryId)
      .then(setExisting)
      // Best-effort — the create flow still works if the list can't load.
      .catch(() => setExisting([]));
  }, [queryId]);

  useEffect(() => {
    if (open) loadExisting();
  }, [open, loadExisting]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const result = await receiptApi.create(queryId);
      setCreated(result);
      setExisting((prev) => [
        { token: result.token, url_path: result.url_path, seal: result.seal, created_at: result.created_at, revoked_at: null, view_count: 0 },
        ...prev,
      ]);
      addToast('Receipt sealed', 'success');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to seal receipt');
    } finally {
      setCreating(false);
    }
  }, [queryId, addToast]);

  // R2-17: revoking is irreversible (the public link dies immediately), so
  // Trash2 opens a confirm step instead of revoking on the first click.
  const handleRevoke = useCallback(
    async (token: string) => {
      setRevokeTarget(null);
      setRevokingToken(token);
      try {
        await receiptApi.revoke(token);
        setExisting((prev) => prev.map((r) => (r.token === token ? { ...r, revoked_at: new Date().toISOString() } : r)));
        addToast('Receipt revoked', 'success');
      } catch (err) {
        addToast(err instanceof Error ? err.message : 'Failed to revoke receipt', 'error');
      } finally {
        setRevokingToken(null);
      }
    },
    [addToast],
  );

  const handleCopy = useCallback(
    async (link: string) => {
      try {
        await navigator.clipboard.writeText(link);
        addToast('Link copied', 'success');
      } catch {
        addToast('Could not copy link', 'error');
      }
    },
    [addToast],
  );

  const fullLink = created ? `${window.location.origin}${created.url_path}` : null;
  const activeExisting = existing.filter((r) => r.token !== created?.token);

  if (!canSeal) return null;

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} className={className}>
        <Stamp size={14} /> Seal receipt
      </Button>

      <Modal open={open} onClose={() => { setOpen(false); setRevokeTarget(null); }} title="Seal a Truth Receipt" className="max-w-md">
        <div className="space-y-4">
          {!created && (
            <>
              <p className="text-[13px] leading-relaxed text-text-muted">
                Sealing creates a <strong className="font-semibold text-text">public link</strong>.
                Anyone who has it can view this question, the answer, claim verdicts, and cited
                excerpts (up to 1,200 characters each) from your documents — no account required.
                You can revoke the link at any time.
              </p>

              {createError && (
                <p role="alert" className="rounded-control border border-red/30 bg-red/10 px-3 py-2 text-[13px] text-red">
                  {createError}
                </p>
              )}

              <Button className="w-full" onClick={() => void handleCreate()} loading={creating}>
                <ShieldCheck size={15} /> Create public receipt
              </Button>
            </>
          )}

          {created && fullLink && (
            <div className="space-y-3 rounded-card border border-green/25 bg-green/8 p-4">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-green">
                <ShieldCheck size={16} /> Receipt sealed
              </div>

              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={fullLink}
                  aria-label="Receipt link"
                  className="glass-input h-9 flex-1 truncate rounded-control px-3 font-mono text-[12px] text-text"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-label="Copy receipt link"
                  onClick={() => void handleCopy(fullLink)}
                >
                  <Copy size={14} />
                </Button>
              </div>

              <div className="flex items-center gap-4">
                <QrCode value={fullLink} size={104} />
                <div className="flex flex-1 flex-col gap-2">
                  <a href={fullLink} target="_blank" rel="noopener noreferrer" className="inline-block">
                    <Button type="button" variant="secondary" size="sm" className="w-full">
                      <ExternalLink size={13} /> Open receipt
                    </Button>
                  </a>
                  <span className="font-mono text-[11px] text-text-dim">
                    seal {shortSeal(created.seal)}&hellip;
                  </span>
                </div>
              </div>
            </div>
          )}

          {activeExisting.length > 0 && (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-dim">
                Existing receipts for this answer
              </p>
              <ul className="space-y-1.5">
                {activeExisting.map((r) => {
                  const revoked = Boolean(r.revoked_at);
                  return (
                    <li
                      key={r.token}
                      className="flex items-center justify-between gap-2 rounded-control border border-border bg-card-2 px-2.5 py-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-mono text-[11px] text-text">{shortSeal(r.seal)}&hellip;</span>
                          {revoked && (
                            <span className="rounded-full border border-red/30 bg-red/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red">
                              Revoked
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-text-dim">
                          <span>{formatDate(r.created_at)}</span>
                          <span className="inline-flex items-center gap-1">
                            <Eye size={10} /> {r.view_count}
                          </span>
                        </div>
                      </div>
                      {!revoked && revokeTarget?.token === r.token ? (
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="text-[11px] font-medium text-red">Revoke?</span>
                          <Button type="button" variant="ghost" size="sm" onClick={() => setRevokeTarget(null)}>
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            onClick={() => void handleRevoke(r.token)}
                            loading={revokingToken === r.token}
                          >
                            Confirm
                          </Button>
                        </div>
                      ) : (
                        !revoked && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label="Revoke this receipt"
                            onClick={() => setRevokeTarget(r)}
                            loading={revokingToken === r.token}
                          >
                            {revokingToken !== r.token && <Trash2 size={13} />}
                          </Button>
                        )
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
