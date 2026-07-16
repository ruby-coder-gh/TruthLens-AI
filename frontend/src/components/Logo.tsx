import { motion } from 'framer-motion';

interface LogoProps {
  size?: number;
  animated?: boolean;
  showText?: boolean;
  textSize?: 'sm' | 'md';
  variant?: 'default' | 'compact' | 'gradient-bg';
  className?: string;
}

const sizes = { sm: 'text-sm', md: 'text-base' };

/**
 * TruthLens eye logo — geometric iris + lens flare.
 * Represents "truth" (clarity) + "lens" (focus).
 */
export default function Logo({
  size = 24,
  animated = true,
  showText = false,
  textSize = 'sm',
  variant = 'default',
  className = '',
}: LogoProps) {
  const icon = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
    >
      {/* Outer eye shape */}
      <ellipse cx="16" cy="16" rx="14" ry="10" stroke="url(#logoGrad)" strokeWidth="1.8" fill="none" />
      {/* Iris */}
      <circle cx="16" cy="16" r="6" fill="url(#logoGrad)" opacity="0.85" />
      {/* Pupil */}
      <circle cx="16" cy="16" r="3" fill="#14150f" />
      {/* Specular highlight (lens flare) */}
      <ellipse cx="13" cy="12.5" rx="2.5" ry="1.5" fill="white" opacity="0.6" transform="rotate(-20 13 12.5)" />
      {/* Subtle inner glow ring */}
      <circle cx="16" cy="16" r="6" stroke="white" strokeWidth="0.4" opacity="0.15" fill="none" />

      {/* Lens crosshair lines (subtle) */}
      <line x1="16" y1="6" x2="16" y2="8" stroke="url(#logoGrad)" strokeWidth="0.8" opacity="0.5" />
      <line x1="16" y1="24" x2="16" y2="26" stroke="url(#logoGrad)" strokeWidth="0.8" opacity="0.5" />
      <line x1="2" y1="16" x2="4.5" y2="16" stroke="url(#logoGrad)" strokeWidth="0.8" opacity="0.5" />
      <line x1="27.5" y1="16" x2="30" y2="16" stroke="url(#logoGrad)" strokeWidth="0.8" opacity="0.5" />

      <defs>
        <linearGradient id="logoGrad" x1="2" y1="4" x2="30" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f1d689" />
          <stop offset="0.5" stopColor="#e8c15a" />
          <stop offset="1" stopColor="#5bb98a" />
        </linearGradient>
      </defs>
    </svg>
  );

  const wrapped = variant === 'gradient-bg' ? (
    <div
      className={`flex items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-white shadow-lg shadow-primary/30 ${className}`}
      style={{ width: size + 12, height: size + 12 }}
    >
      {icon}
    </div>
  ) : (
    <span className={className}>{icon}</span>
  );

  if (!showText) {
    if (animated) {
      return (
        <motion.span
          whileHover={{ scale: 1.1, rotate: -5 }}
          transition={{ type: 'spring', stiffness: 300, damping: 10 }}
          className="inline-flex items-center"
        >
          {wrapped}
        </motion.span>
      );
    }
    return <span className="inline-flex items-center">{wrapped}</span>;
  }

  return (
    <motion.div
      className={`inline-flex items-center gap-2 ${className}`}
      whileHover="hover"
    >
      {animated ? (
        <motion.span
          variants={{ hover: { scale: 1.1, rotate: -5 } }}
          transition={{ type: 'spring', stiffness: 300, damping: 10 }}
        >
          {wrapped}
        </motion.span>
      ) : wrapped}
      <span className="font-bold text-text">
        <span className={sizes[textSize]}>TruthLens</span>
        <span className="block text-[10px] uppercase tracking-widest text-text-dim font-normal">AI Platform</span>
      </span>
    </motion.div>
  );
}
