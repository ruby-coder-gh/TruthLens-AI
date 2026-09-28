// Owning lane: L10 (Demo FE). Fetches workspace-tailored suggested questions
// from the demo API; falls back to the caller's static list on error, empty
// response, or before the fetch resolves — the chips must never be empty
// while a real fallback exists.
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { demoApi } from '../api/client';
import { staggerContainer, staggerItem } from './motion';
import { useMediaQuery } from '../utils/useMediaQuery';

// NOTE: `opacity: 0.99` (rather than exactly 0) in the initial state is an
// intentional workaround for a WAAPI browser bug — do not "simplify" it to 0.
const staticItem = { initial: { opacity: 1 }, animate: { opacity: 1 } };

export function SuggestedQuestions({
  workspaceId,
  onPick,
  fallback,
}: {
  workspaceId: string;
  onPick: (q: string) => void;
  fallback: string[];
}) {
  const [fetched, setFetched] = useState<string[] | null>(null);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  useEffect(() => {
    let cancelled = false;
    demoApi
      .suggestions(workspaceId)
      .then((res) => {
        if (!cancelled) setFetched(res.questions);
      })
      .catch(() => {
        if (!cancelled) setFetched([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const questions = fetched && fetched.length > 0 ? fetched : fallback;
  if (questions.length === 0) return null;

  return (
    <motion.div
      variants={reducedMotion ? undefined : staggerContainer}
      initial="initial"
      animate="animate"
      className="flex flex-wrap gap-2"
      role="group"
      aria-label="Suggested questions"
    >
      {questions.map((question) => (
        <motion.button
          key={question}
          type="button"
          variants={reducedMotion ? staticItem : staggerItem}
          onClick={() => onPick(question)}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card-hover px-3 py-1.5 text-left text-xs font-medium text-text-muted transition-colors duration-150 hover:border-primary/40 hover:bg-primary/10 hover:text-primary-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:ring-2 focus-visible:ring-focus-halo"
        >
          <Sparkles size={12} className="shrink-0 text-primary-soft" aria-hidden="true" />
          {question}
        </motion.button>
      ))}
    </motion.div>
  );
}
