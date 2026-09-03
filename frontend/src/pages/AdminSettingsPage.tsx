import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Settings, Save, RotateCcw, Bot, Database, Sliders, BarChart3 } from 'lucide-react';
import { Button, Card, Input, Select } from '../components/ui';
import { staggerContainer, staggerItem, pageTransition } from '../components/motion';
import { useToast } from '../components/toast-context';
import { PageHeader, PageShell, StateBlock } from '../components/PageWrappers';
import { adminApi } from '../api/client';

const DEFAULTS = {
  workspaceName: 'TruthLens AI',
  llmModel: 'qwen3:4b',
  embeddingModel: 'nomic-embed-text',
  topK: 5,
  chunkSize: 512,
  trustThresholdHigh: 0.75,
  trustThresholdMedium: 0.5,
};

const LLM_OPTIONS = [
  { value: 'qwen3:4b', label: 'Qwen3 4B' },
  { value: 'llama3.1:8b', label: 'Llama 3.1 8B' },
  { value: 'phi3:3b', label: 'Phi-3 3B' },
  { value: 'mistral:7b', label: 'Mistral 7B' },
];

const EMBEDDING_OPTIONS = [
  { value: 'nomic-embed-text', label: 'Nomic Embed Text' },
  { value: 'bge-base:latest', label: 'BGE Base' },
  { value: 'bge-large:latest', label: 'BGE Large' },
];

function pick<T>(settings: Record<string, unknown> | undefined, key: string, fallback: T): T {
  if (!settings) return fallback;
  const val = settings[key];
  return (val !== undefined && val !== null ? val : fallback) as T;
}

export default function AdminSettingsPage() {
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => adminApi.getSettings(),
  });

  const remoteSettings = settingsQuery.data as Record<string, unknown> | undefined;

  const [workspaceName, setWorkspaceName] = useState(DEFAULTS.workspaceName);
  const [llmModel, setLlmModel] = useState(DEFAULTS.llmModel);
  const [embeddingModel, setEmbeddingModel] = useState(DEFAULTS.embeddingModel);
  const [topK, setTopK] = useState(DEFAULTS.topK);
  const [chunkSize, setChunkSize] = useState(DEFAULTS.chunkSize);
  const [trustHigh, setTrustHigh] = useState(DEFAULTS.trustThresholdHigh);
  const [trustMed, setTrustMed] = useState(DEFAULTS.trustThresholdMedium);

  const [savingSection, setSavingSection] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!remoteSettings) return;
    setWorkspaceName(pick(remoteSettings, 'workspace_name', DEFAULTS.workspaceName));
    setLlmModel(pick(remoteSettings, 'llm_model', DEFAULTS.llmModel));
    setEmbeddingModel(pick(remoteSettings, 'embedding_model', DEFAULTS.embeddingModel));
    setTopK(pick(remoteSettings, 'top_k', DEFAULTS.topK));
    setChunkSize(pick(remoteSettings, 'chunk_size', DEFAULTS.chunkSize));
    setTrustHigh(pick(remoteSettings, 'trust_threshold_high', DEFAULTS.trustThresholdHigh));
    setTrustMed(pick(remoteSettings, 'trust_threshold_medium', DEFAULTS.trustThresholdMedium));
  }, [remoteSettings]);
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
      onError: () => {
        setSavingSection(null);
        addToast(`Failed to save ${section} settings`, 'error');
      },
    });
  }

  function resetToDefaults() {
    setWorkspaceName(DEFAULTS.workspaceName);
    setLlmModel(DEFAULTS.llmModel);
    setEmbeddingModel(DEFAULTS.embeddingModel);
    setTopK(DEFAULTS.topK);
    setChunkSize(DEFAULTS.chunkSize);
    setTrustHigh(DEFAULTS.trustThresholdHigh);
    setTrustMed(DEFAULTS.trustThresholdMedium);
    addToast('Settings reset to defaults', 'info');
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

  if (settingsQuery.isError) {
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
          description="Configure system-wide settings."
          actions={(
            <Button variant="secondary" size="sm" onClick={resetToDefaults}>
              <RotateCcw size={14} />
              Reset All
            </Button>
          )}
        />
      </motion.div>

      <motion.div
        className="space-y-5"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        <motion.div variants={staggerItem}>
          <Card className="p-5 lg:p-6">
            <h2 className="text-base font-semibold text-text mb-4 flex items-center gap-2">
              <Settings size={16} className="text-primary-soft" />
              General
            </h2>
            <div className="space-y-4">
              <Input
                label="Workspace Name"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
              />
              <Button
                size="sm"
                loading={savingSection === 'General'}
                onClick={() => handleSave('General', { workspace_name: workspaceName })}
              >
                <Save size={14} />
                Save
              </Button>
            </div>
          </Card>
        </motion.div>

        <motion.div variants={staggerItem}>
          <Card className="p-5 lg:p-6">
            <h2 className="text-base font-semibold text-text mb-4 flex items-center gap-2">
              <Bot size={16} className="text-primary-soft" />
              Model Configuration
            </h2>
            <div className="space-y-4">
              <Select
                label="LLM Model"
                value={llmModel}
                onChange={(e) => setLlmModel(e.target.value)}
                options={LLM_OPTIONS}
              />
              <Select
                label="Embedding Model"
                value={embeddingModel}
                onChange={(e) => setEmbeddingModel(e.target.value)}
                options={EMBEDDING_OPTIONS}
              />
              <Button
                size="sm"
                loading={savingSection === 'Model'}
                onClick={() => handleSave('Model', { llm_model: llmModel, embedding_model: embeddingModel })}
              >
                <Save size={14} />
                Save
              </Button>
            </div>
          </Card>
        </motion.div>

        <motion.div variants={staggerItem}>
          <Card className="p-5 lg:p-6">
            <h2 className="text-base font-semibold text-text mb-4 flex items-center gap-2">
              <Database size={16} className="text-primary-soft" />
              Retrieval Settings
            </h2>
            <div className="space-y-4">
              <Input
                label="Top-K Retrieved Chunks"
                type="number"
                min={1}
                max={50}
                value={String(topK)}
                onChange={(e) => setTopK(Number(e.target.value))}
              />
              <Input
                label="Chunk Size (tokens)"
                type="number"
                min={128}
                max={2048}
                step={64}
                value={String(chunkSize)}
                onChange={(e) => setChunkSize(Number(e.target.value))}
              />
              <Button
                size="sm"
                loading={savingSection === 'Retrieval'}
                onClick={() => handleSave('Retrieval', { top_k: topK, chunk_size: chunkSize })}
              >
                <Save size={14} />
                Save
              </Button>
            </div>
          </Card>
        </motion.div>

        <motion.div variants={staggerItem}>
          <Card className="p-5 lg:p-6">
            <h2 className="text-base font-semibold text-text mb-4 flex items-center gap-2">
              <Sliders size={16} className="text-primary-soft" />
              Trust Score Thresholds
            </h2>
            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="trust-high" className="text-[12.5px] font-medium text-text-muted">High Trust (green)</label>
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
                <p className="text-xs text-text-dim mt-1">Scores above this are considered high trust.</p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="trust-medium" className="text-[12.5px] font-medium text-text-muted">Medium Trust (orange)</label>
                  <span className="text-sm font-bold text-orange tabular-nums">{trustMed.toFixed(2)}</span>
                </div>
                <input
                  id="trust-medium"
                  type="range"
                  min={0.2}
                  max={0.7}
                  step={0.01}
                  value={trustMed}
                  onChange={(e) => setTrustMed(Number(e.target.value))}
                  className="w-full h-2 cursor-pointer appearance-none rounded-full bg-card-2 ring-1 ring-inset ring-border accent-primary"
                  aria-label="Medium trust threshold"
                />
                <p className="text-xs text-text-dim mt-1">Scores below this are considered low trust (red).</p>
              </div>

              <div className="flex items-center gap-2 rounded-control border border-border bg-card-2 p-3 text-xs text-text-dim">
                <BarChart3 size={14} />
                Current ranges: Low (0–{trustMed.toFixed(2)}), Medium ({trustMed.toFixed(2)}–{trustHigh.toFixed(2)}), High ({trustHigh.toFixed(2)}–1.0)
              </div>

              <Button
                size="sm"
                loading={savingSection === 'Thresholds'}
                onClick={() =>
                  handleSave('Thresholds', {
                    trust_threshold_high: trustHigh,
                    trust_threshold_medium: trustMed,
                  })
                }
              >
                <Save size={14} />
                Save Thresholds
              </Button>
            </div>
          </Card>
        </motion.div>
      </motion.div>
      </PageShell>
    </motion.div>
  );
}
