import { clsx } from 'clsx';

interface LogoProps {
  size?: number;
  /** Accepted for existing call sites; the mark no longer animates. */
  animated?: boolean;
  /** `gradient-bg` (name kept for call sites) = the mark on a flat accent tile. */
  variant?: 'default' | 'gradient-bg';
  className?: string;
}

/**
 * TruthLens mark — a lens with a check inside it. Stroked in `currentColor`,
 * so the caller sets the ink: `text-primary` on a surface, `text-on-primary`
 * on an accent fill. The `gradient-bg` variant brings its own tile and ink.
 */
export default function Logo({ size = 24, variant = 'default', className }: LogoProps) {
  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L20 20" />
      <path d="M7.75 10.75l2 2 3.5-3.75" />
    </svg>
  );

  if (variant === 'gradient-bg') {
    return (
      <span
        className={clsx('inline-flex shrink-0 items-center justify-center rounded-control bg-primary text-on-primary', className)}
        style={{ width: size + 12, height: size + 12 }}
      >
        {mark}
      </span>
    );
  }

  return <span className={clsx('inline-flex shrink-0', className)}>{mark}</span>;
}
