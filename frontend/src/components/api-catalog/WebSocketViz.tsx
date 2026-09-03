import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import {
  Lock,
  Edit3,
  Search,
  ArrowUpDown,
  Brain,
  Shield,
  Gauge,
  Database,
  Play,
  Square,
} from 'lucide-react';
import { WS_PIPELINE_STAGES } from './data';
import type { WebSocketStage } from './types';

const stageIcons: Record<string, typeof Lock> = {
  Lock, Edit3, Search, ArrowUpDown, Brain, Shield, Gauge, Database,
};

function PipelineNode({ stage }: { stage: WebSocketStage }) {
  const Icon = stageIcons[stage.icon] || Lock;
  const isActive = stage.status === 'active';
  const isCompleted = stage.status === 'completed';

  return (
    <div className="flex items-center gap-2.5">
      {/* Node */}
      <div className="relative flex items-center gap-2.5">
        <motion.div
          className={clsx(
            'flex items-center justify-center w-8 h-8 rounded-xl border transition-all duration-300 shrink-0',
            isActive && 'border-primary/40 bg-primary/15 shadow-[0_0_15px_rgba(99,102,241,0.15)]',
            isCompleted && 'border-accent/30 bg-accent/10',
            !isActive && !isCompleted && 'border-border bg-card-2',
          )}
          animate={isActive ? { scale: [1, 1.05, 1] } : {}}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <Icon
            size={14}
            className={clsx(
              isActive && 'text-primary-soft',
              isCompleted && 'text-accent',
              !isActive && !isCompleted && 'text-text-dim',
            )}
          />
        </motion.div>

        <div className="flex-1 min-w-0">
          <span className={clsx(
            'block text-xs font-semibold',
            isActive && 'text-primary-soft',
            isCompleted && 'text-accent',
            !isActive && !isCompleted && 'text-text-dim',
          )}>
            {stage.name}
          </span>
          <span className="block text-[10px] text-text-dim font-mono">{stage.duration}</span>
        </div>
      </div>
    </div>
  );
}

function ConnectionLine({ active }: { active: boolean }) {
  return (
    <div className="flex justify-center py-0.5">
      <div className="relative w-px h-5">
        <div className="absolute inset-0 bg-border/50" />
        {active && (
          <motion.div
            className="absolute inset-x-0 top-0 h-full bg-gradient-to-b from-primary to-accent"
            initial={{ scaleY: 0, originY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
        {active && (
          <motion.div
            className="absolute -left-0.5 -top-1 w-2 h-2 rounded-full bg-primary shadow-[0_0_6px_rgba(99,102,241,0.5)]"
            animate={{ top: ['0%', '100%'] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
          />
        )}
      </div>
    </div>
  );
}

export default function WebSocketViz() {
  const [pipelineStages, setPipelineStages] = useState<WebSocketStage[]>(WS_PIPELINE_STAGES);
  const [isRunning, setIsRunning] = useState(true);

  const advancePipeline = useCallback(() => {
    setPipelineStages((prev) => {
      const next = [...prev];
      const activeIdx = next.findIndex((s) => s.status === 'active');

      if (activeIdx === -1 && next.some((s) => s.status === 'idle')) {
        // Start first idle
        const firstIdle = next.findIndex((s) => s.status === 'idle');
        next[firstIdle] = { ...next[firstIdle], status: 'active' };
      } else if (activeIdx >= 0) {
        // Advance: current becomes completed, next becomes active
        next[activeIdx] = { ...next[activeIdx], status: 'completed' };
        const nextIdx = activeIdx + 1;
        if (nextIdx < next.length) {
          next[nextIdx] = { ...next[nextIdx], status: 'active' };
        }
      }
      return next;
    });
  }, []);

  // Auto-advance every 2s
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(advancePipeline, 2000);
    return () => clearInterval(interval);
  }, [isRunning, advancePipeline]);

  const resetPipeline = () => {
    setPipelineStages(
      WS_PIPELINE_STAGES.map((s) => ({ ...s, status: s.id === 'rewrite' ? 'active' : 'idle' as const })),
    );
  };

  return (
    <div className="rounded-xl glass border border-glass-border p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <span className="text-xs font-semibold uppercase tracking-wider text-text-dim">
            Pipeline
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setIsRunning(!isRunning)}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-text-dim hover:text-text hover:bg-card-2 transition-all"
            aria-label={isRunning ? 'Pause pipeline' : 'Start pipeline'}
          >
            {isRunning ? <Square size={12} /> : <Play size={12} />}
          </button>
        </div>
      </div>

      {/* Pipeline nodes */}
      <div className="space-y-0">
        {pipelineStages.map((stage, i) => (
          <div key={stage.id}>
            <PipelineNode stage={stage} />
            {i < pipelineStages.length - 1 && (
              <ConnectionLine active={stage.status === 'completed' || (stage.status === 'active' && pipelineStages[i + 1]?.status === 'idle')} />
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
        <span className="text-[10px] text-text-dim">
          {pipelineStages.filter((s) => s.status === 'completed').length}/{pipelineStages.length} stages
        </span>
        <button
          type="button"
          onClick={resetPipeline}
          className="text-[10px] text-text-dim hover:text-primary-soft transition-colors"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
