import { clsx } from 'clsx';
import { motion } from 'framer-motion';
import { getTrustBadgeColor, type TrustBadgeColor } from '../../utils/relevance';

interface TrustGaugeProps {
  score: number | null;
  size?: number;
  className?: string;
}

const RING_COLOR: Record<TrustBadgeColor, string> = {
  green: 'var(--color-trust-high)',
  orange: 'var(--color-trust-mid)',
  red: 'var(--color-trust-low)',
  gray: 'var(--color-border)',
};

const INK_COLOR: Record<TrustBadgeColor, string> = {
  green: 'var(--color-green)',
  orange: 'var(--color-orange)',
  red: 'var(--color-red)',
  gray: 'var(--color-text-dim)',
};

/**
 * Certificate-style trust donut — a bigger, standalone cousin of ChatPage's
 * inline `TrustScoreRing`. `score` is 0–1 or null (never computed for this
 * answer); the ring and the numeral inside are never the only signal, so a
 * caller should still print the verdict in words nearby.
 */
export function TrustGauge({ score, size = 96, className }: TrustGaugeProps) {
  const clamped = typeof score === 'number' && Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : null;
  const tone = getTrustBadgeColor(clamped);
  const strokeWidth = Math.max(4, Math.round(size / 14));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = clamped === null ? circumference : circumference * (1 - clamped);

  return (
    <div
      className={clsx('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={clamped === null ? 'Trust score unavailable' : `Trust score ${Math.round(clamped * 100)} percent`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-border)" strokeWidth={strokeWidth} />
        {clamped !== null && (
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={RING_COLOR[tone]}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
        <span
          className="font-mono font-semibold leading-none"
          style={{ color: clamped !== null ? INK_COLOR[tone] : 'var(--color-text-dim)', fontSize: size * 0.24 }}
        >
          {clamped !== null ? Math.round(clamped * 100) : '—'}
        </span>
        <span className="mt-1 text-[9px] font-semibold uppercase tracking-widest text-text-dim">Trust</span>
      </div>
    </div>
  );
}
