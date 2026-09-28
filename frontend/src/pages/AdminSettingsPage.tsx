import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Settings, Save, Info, Sliders, Gauge } from 'lucide-react';
import { Button, Card, Input, Badge } from '../components/ui';
import { staggerContainer, staggerItem, pageTransition } from '../components/motion';
import { useToast } from '../components/toast-context';
import { PageHeader, PageShell, StateBlock } from '../components/PageWrappers';
import { adminApi } from '../api/client';

// C6 — this page's fields are the exact set the backend understands. Source
// of truth: `backend/app/schemas/analytics.py` (`AdminSettingsResponse` /
// `AdminSettingsUpdate`) and `GET|PUT /admin/settings` in `backend/app/api/admin.py`.
// `app_name`, `app_version`, `rate_limit_requests` and `rate_limit_window_seconds`
// come back on GET but are not accepted by PUT (no field for them on
// `AdminSettingsUpdate`) — they render read-only, not as editable inputs that
// would silently no-op on save.
interface AdminSettings {
  app_name: string;
  app_version: string;
  max_upload_size_mb: number;
  trust_score_high_threshold: number;
  trust_score_low_threshold: number;
  rate_limit_enabled: boolean;
  rate_limit_requests: number;
  rate_limit_window_seconds: number;
}

export default function AdminSettingsPage() {
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: async () => (await adminApi.getSettings()) as unknown as AdminSettings,
  });

  const remote = settingsQuery.data;

  const [maxUploadMb, setMaxUploadMb] = useState(50);
  const [trustHigh, setTrustHigh] = useState(0.7);
  const [trustLow, setTrustLow] = useState(0.4);

  const [savingSection, setSavingSection] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!remote) return;
    setMaxUploadMb(remote.max_upload_size_mb);
    setTrustHigh(remote.trust_score_high_threshold);
    setTrustLow(remote.trust_score_low_threshold);
  }, [remote]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => adminApi.updateSettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
    },
  });

  function handleSave(section: string, data: Record<string, unknown>) {
    setSavingSection(section);
    saveMutation.mutate(data, {
      onSuccess: () => {
        setSavingSection(null);
        addToast(`${section} settings saved`, 'success');
      },
      onError: (err) => {
        setSavingSection(null);
        addToast(err instanceof Error ? err.message : `Failed to save ${section} settings`, 'error');
      },
    });
  }

  if (settingsQuery.isLoading) {
    return (
      <motion.div variants={pageTransition} initial="initial" animate="animate">
        <PageShell className="max-w-2xl">
          <PageHeader title="Settings" description="Configure system-wide settings." />
          <StateBlock role="status">Loading settings…</StateBlock>
        </PageShell>
      </motion.div>
    );
  }

  if (settingsQuery.isError || !remote) {
    return (
      <motion.div variants={pageTransition} initial="initial" animate="animate">
        <PageShell className="max-w-2xl">
          <PageHeader title="Settings" description="Configure system-wide settings." />
          <StateBlock tone="danger" role="alert" className="space-y-3">
            <p>Failed to load settings.</p>
            <Button variant="secondary" size="sm" onClick={() => settingsQuery.refetch()}>
              Retry
            </Button>
          </StateBlock>
        </PageShell>
      </motion.div>
    );
  }

  return (
    <motion.div variants={pageTransition} initial="initial" animate="animate">
      <PageShell className="max-w-2xl">
      <motion.div variants={staggerItem}>
        <PageHeader
          title="Settings"
          description="System-wide settings. Values come straight from the server."
        />
      </motion.div>

      <motion.div
        className="space-y-5"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        {/* General — read-only server identity, nothing here is writable. */}
        <motion.div variants={staggerItem}>
          <Card className="p-5 lg:p-6">
            <h2 className="text-base font-semibold text-text mb-4 flex items-center gap-2">
              <Info size={16} className="text-primary-soft" />
              About
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-text-dim">App name</p>
                <p className="text-sm text-text">{remote.app_name}</p>
              </div>
              <div>
                <p className="text-xs text-text-dim">Version</p>
                <p className="text-sm text-text">{remote.app_version}</p>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Uploads */}
        <motion.div variants={staggerItem}>
          <Card className="p-5 lg:p-6">
            <h2 className="text-base font-semibold text-text mb-4 flex items-center gap-2">
              <Settings size={16} className="text-primary-soft" />
              Uploads
            </h2>
            <div className="space-y-4">
              <Input
                label="Max upload size (MB)"
                type="number"
                min={1}
                value={String(maxUploadMb)}
                onChange={(e) => setMaxUploadMb(Number(e.target.value))}
              />
              <Button
                size="sm"
                loading={savingSection === 'Uploads'}
                onClick={() => handleSave('Uploads', { max_upload_size_mb: maxUploadMb })}
              >
                <Save size={14} />
                Save
              </Button>
            </div>
          </Card>
        </motion.div>

        {/* Trust score thresholds */}
        <motion.div variants={staggerItem}>
          <Card className="p-5 lg:p-6">
            <h2 className="text-base font-semibold text-text mb-4 flex items-center gap-2">
              <Sliders size={16} className="text-primary-soft" />
              Trust Score Thresholds
            </h2>
            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="trust-high" className="text-[12.5px] font-medium text-text-muted">High trust (green)</label>
                  <span className="text-sm font-bold text-green tabular-nums">{trustHigh.toFixed(2)}</span>
                </div>
                <input
                  id="trust-high"
                  type="range"
                  min={0.5}
                  max={1}
                  step={0.01}
                  value={trustHigh}
                  onChange={(e) => setTrustHigh(Number(e.target.value))}
                  className="w-full h-2 cursor-pointer appearance-none rounded-full bg-card-2 ring-1 ring-inset ring-border accent-primary"
                  aria-label="High trust threshold"
                />
                <p className="text-xs text-text-dim mt-1">Scores at or above this are high trust.</p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="trust-low" className="text-[12.5px] font-medium text-text-muted">Low trust (red)</label>
                  <span className="text-sm font-bold text-red tabular-nums">{trustLow.toFixed(2)}</span>
                </div>
                <input
                  id="trust-low"
                  type="range"
                  min={0}
                  max={0.7}
                  step={0.01}
                  value={trustLow}
                  onChange={(e) => setTrustLow(Number(e.target.value))}
                  className="w-full h-2 cursor-pointer appearance-none rounded-full bg-card-2 ring-1 ring-inset ring-border accent-primary"
                  aria-label="Low trust threshold"
                />
                <p className="text-xs text-text-dim mt-1">Scores below this are low trust.</p>
              </div>

              <div className="flex items-center gap-2 rounded-control border border-border bg-card-2 p-3 text-xs text-text-dim">
                <Gauge size={14} />
                Current ranges: Low (0–{trustLow.toFixed(2)}), Medium ({trustLow.toFixed(2)}–{trustHigh.toFixed(2)}), High ({trustHigh.toFixed(2)}–1.0)
              </div>

              <Button
                size="sm"
                loading={savingSection === 'Thresholds'}
                onClick={() =>
                  handleSave('Thresholds', {
                    trust_score_high_threshold: trustHigh,
                    trust_score_low_threshold: trustLow,
                  })
                }
              >
                <Save size={14} />
                Save Thresholds
              </Button>
            </div>
          </Card>
        </motion.div>

        {/* Rate limiting — R2-14: fully read-only. It used to render a live
            checkbox + Save button right next to copy that says "set via
            server config, not editable here", which contradicted itself. */}
        <motion.div variants={staggerItem}>
          <Card className="p-5 lg:p-6">
            <h2 className="text-base font-semibold text-text mb-4 flex items-center gap-2">
              <Gauge size={16} className="text-primary-soft" />
              Rate Limiting
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-xs text-text-dim">
              <Badge color={remote.rate_limit_enabled ? 'green' : 'gray'}>
                {remote.rate_limit_enabled ? 'Enabled' : 'Disabled'}
              </Badge>
              <Badge color="gray">{remote.rate_limit_requests} requests</Badge>
              <span>per</span>
              <Badge color="gray">{remote.rate_limit_window_seconds}s window</Badge>
              <span>— set via server config, not editable here.</span>
            </div>
          </Card>
        </motion.div>
      </motion.div>
      </PageShell>
    </motion.div>
  );
}
