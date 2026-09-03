import { motion } from 'framer-motion';
import { clsx } from 'clsx';

interface GlowingIconProps {
  icon: React.ReactNode;
  active?: boolean;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  onClick?: () => void;
  ariaLabel?: string;
}

/**
 * An icon button whose active state is stated, not radiated.
 *
 * The Midnight version pulsed a coloured box-shadow forever (even at rest),
 * fired a six-particle burst on a loop while active, and hung a drop-shadow
 * off the glyph. On a light ground those halos have nothing to bloom into —
 * they just smear. Grounded Glass says the same thing with a flat accent tint
 * and a 1px edge, which is legible in both themes and costs one paint.
 *
 * `color` is unchanged as an override, but it is now composited with
 * `color-mix` instead of hex-alpha string concatenation, so the default can be
 * a theme token that flips with the theme rather than a frozen Midnight hex.
 */
export default function GlowingIcon({
  icon,
  active = false,
  color = 'var(--color-primary)',
  size = 'md',
  className,
  onClick,
  ariaLabel,
}: GlowingIconProps) {
  const sizeMap = { sm: 28, md: 36, lg: 44 };
  const iconSize = sizeMap[size];

  const tint = `color-mix(in srgb, ${color} 12%, transparent)`;
  const edge = `color-mix(in srgb, ${color} 30%, transparent)`;

  return (
    <motion.button
      type="button"
      onClick={onClick}
      // No aria-pressed: the one call site passes an action label ("Dismiss
      // …"), and a toggle state on an action name reads as a contradiction.
      aria-label={ariaLabel}
      className={clsx(
        'relative flex shrink-0 items-center justify-center rounded-control border',
        'cursor-pointer transition-colors duration-200',
        className,
      )}
      style={{
        width: iconSize,
        height: iconSize,
        background: active ? tint : 'transparent',
        borderColor: active ? edge : 'transparent',
      }}
      whileHover="hover"
      whileTap={{ scale: 0.95 }}
      variants={{ hover: { scale: 1.06 } }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      {/* Hover tint — the only state layer, and it fades rather than pulses. */}
      <motion.span
        className="absolute inset-0 rounded-control"
        style={{ background: tint }}
        initial={{ opacity: 0 }}
        variants={{ hover: { opacity: 1 } }}
        transition={{ duration: 0.18 }}
        aria-hidden="true"
      />

      <span className="relative z-10 flex items-center justify-center">{icon}</span>
    </motion.button>
  );
}
