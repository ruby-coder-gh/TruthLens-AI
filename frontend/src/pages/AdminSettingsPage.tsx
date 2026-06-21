import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Settings, Save, RotateCcw, Bot, Database, Sliders, BarChart3 } from 'lucide-react';
import { Button, Card, Input, Select, useToast, staggerContainer, staggerItem, pageTransition } from '../components/ui';

// ─── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULTS = {
  workspaceName: 'TruthLens AI',
  llmModel: 'gpt-4',
  embeddingModel: 'text-embedding-3-small',
  topK: 5,
  chunkSize: 512,
  trustThresholdHigh: 0.75,
  trustThresholdMedium: 0.5,
};

// ─── Component ─────────────────────────────────────────────────────────────────

export default function AdminSettingsPage() {
  const { addToast } = useToast();

  const [workspaceName, setWorkspaceName] = useState(DEFAULTS.workspaceName);
  const [llmModel, setLlmModel] = useState(DEFAULTS.llmModel);
  const [embeddingModel, setEmbeddingModel] = useState(DEFAULTS.embeddingModel);
  const [topK, setTopK] = useState(DEFAULTS.topK);
  const [chunkSize, setChunkSize] = useState(DEFAULTS.chunkSize);
  const [trustHigh, setTrustHigh] = useState(DEFAULTS.trustThresholdHigh);
  const [trustMed, setTrustMed] = useState(DEFAULTS.trustThresholdMedium);

  const [savingSection, setSavingSection] = useState<string | null>(null);

  function handleSave(section: string, callback?: () => void) {
    setSavingSection(section);
    setTimeout(() => {
      setSavingSection(null);
      callback?.();
      addToast(`${section} settings saved`, 'success');
    }, 600);
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

  return (
    <motion.div
      className="space-y-6 max-w-2xl"
      variants={pageTransition}
      initial="initial"
      animate="animate"
    >
      {/* Header */}
      <motion.div variants={staggerItem} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Settings</h1>
          <p className="text-sm text-text-muted mt-1">Configure system-wide settings.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={resetToDefaults}>
          <RotateCcw size={14} />
          Reset All
        </Button>
      </motion.div>

      <motion.div
        className="space-y-5"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        {/* General */}
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
                onClick={() => handleSave('General')}
              >
                <Save size={14} />
                Save
              </Button>
            </div>
          </Card>
        </motion.div>

        {/* Model Config */}
        <motion.div variants={staggerItem}>
          <Card className="p-5 lg:p-6">
            <h2 className="text-base font-semibold text-text mb-4 flex items-center gap-2">
              <Bot size={16} className="text-accent" />
              Model Configuration
            </h2>
            <div className="space-y-4">
              <Select
                label="LLM Model"
                value={llmModel}
                onChange={(e) => setLlmModel(e.target.value)}
                options={[
                  { value: 'gpt-4', label: 'GPT-4' },
                  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
                  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
                  { value: 'claude-3-opus', label: 'Claude 3 Opus' },
                  { value: 'claude-3-sonnet', label: 'Claude 3 Sonnet' },
                  { value: 'claude-3-haiku', label: 'Claude 3 Haiku' },
                ]}
              />
              <Select
                label="Embedding Model"
                value={embeddingModel}
                onChange={(e) => setEmbeddingModel(e.target.value)}
                options={[
                  { value: 'text-embedding-3-small', label: 'OpenAI text-embedding-3-small' },
                  { value: 'text-embedding-3-large', label: 'OpenAI text-embedding-3-large' },
                  { value: 'text-embedding-ada-002', label: 'OpenAI text-embedding-ada-002' },
                ]}
              />
              <Button
                size="sm"
                loading={savingSection === 'Model'}
                onClick={() => handleSave('Model')}
              >
                <Save size={14} />
                Save
              </Button>
            </div>
          </Card>
        </motion.div>

        {/* Retrieval */}
        <motion.div variants={staggerItem}>
          <Card className="p-5 lg:p-6">
            <h2 className="text-base font-semibold text-text mb-4 flex items-center gap-2">
              <Database size={16} className="text-accent-2" />
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
                onClick={() => handleSave('Retrieval')}
              >
                <Save size={14} />
                Save
              </Button>
            </div>
          </Card>
        </motion.div>

        {/* Trust Score Thresholds */}
        <motion.div variants={staggerItem}>
          <Card className="p-5 lg:p-6">
            <h2 className="text-base font-semibold text-text mb-4 flex items-center gap-2">
              <Sliders size={16} className="text-gold" />
              Trust Score Thresholds
            </h2>
            <div className="space-y-6">
              {/* High threshold */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-text-muted">High Trust (green)</label>
                  <span className="text-sm font-bold text-green tabular-nums">{trustHigh.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={1}
                  step={0.01}
                  value={trustHigh}
                  onChange={(e) => setTrustHigh(Number(e.target.value))}
                  className="w-full h-2 rounded-full appearance-none cursor-pointer bg-card-2 accent-primary"
                  aria-label="High trust threshold"
                />
                <p className="text-xs text-text-dim mt-1">Scores above this are considered high trust.</p>
              </div>

              {/* Medium threshold */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-text-muted">Medium Trust (orange)</label>
                  <span className="text-sm font-bold text-orange tabular-nums">{trustMed.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0.2}
                  max={0.7}
                  step={0.01}
                  value={trustMed}
                  onChange={(e) => setTrustMed(Number(e.target.value))}
                  className="w-full h-2 rounded-full appearance-none cursor-pointer bg-card-2 accent-primary"
                  aria-label="Medium trust threshold"
                />
                <p className="text-xs text-text-dim mt-1">Scores below this are considered low trust (red).</p>
              </div>

              <div className="flex items-center gap-2 text-xs text-text-dim p-3 rounded-lg glass">
                <BarChart3 size={14} />
                Current ranges: Low (0–{trustMed.toFixed(2)}), Medium ({trustMed.toFixed(2)}–{trustHigh.toFixed(2)}), High ({trustHigh.toFixed(2)}–1.0)
              </div>

              <Button
                size="sm"
                loading={savingSection === 'Thresholds'}
                onClick={() => handleSave('Thresholds')}
              >
                <Save size={14} />
                Save Thresholds
              </Button>
            </div>
          </Card>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
