import { useState, useRef, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import { Loader2, Check } from 'lucide-react';

interface PremiumButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  loading?: boolean;
  success?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
}

/**
 * Press feedback. `bg-current` picks up each variant's own ink, so the ripple
 * reads on the accent fill, on glass and on the danger tint without a literal.
 */
function RippleEffect({ x, y }: { x: number; y: number }) {
  return (
    <motion.span
      className="pointer-events-none absolute rounded-full bg-current"
      style={{ left: x, top: y, width: 20, height: 20, marginLeft: -10, marginTop: -10 }}
      initial={{ scale: 0, opacity: 0.28 }}
      animate={{ scale: 6, opacity: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    />
  );
}

/**
 * The primary action.
 *
 * Midnight dressed this in four simultaneous decorative systems: a frozen
 * `#a5b4fc → #6366f1 → #4f46e5` fill, a 4s infinite background-position pan,
 * a 3s infinite rotating conic "border beam" that cycled indigo → green → red
 * around the edge, and a two-hue bloom on hover. All four are gone.
 *
 * They were built to make a button glow out of a near-black page. Against a
 * light frosted ground they do the opposite — a rainbow ring on the one
 * control that has to look trustworthy reads as a novelty, and the sign-in
 * screen ran two of those loops forever. Grounded Glass states the primary
 * action the way the board does: a flat accent fill, `on-primary` ink, e2 to
 * lift it off the panel, and a colour step on hover. The ripple stays because
 * it is press *feedback*, not decoration.
 */
export default function PremiumButton({
  children,
  loading = false,
  success = false,
  variant = 'primary',
  size = 'md',
  icon,
  className,
  disabled,
  onClick,
  type = 'submit',
}: PremiumButtonProps) {
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const btnRef = useRef<HTMLButtonElement>(null);
  const rippleId = useRef(0);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const id = rippleId.current++;
      setRipples((prev) => [...prev, { id, x, y }]);
      setTimeout(() => {
        setRipples((prev) => prev.filter((r) => r.id !== id));
      }, 600);
    }
    if (!loading && !success && onClick) {
      onClick(e);
    }
  };

  // Heights track the design system's control ramp (28 / 36 / 44).
  const sizeStyles = {
    sm: 'h-8 px-4 text-xs gap-1.5',
    md: 'h-9 px-5 text-sm gap-2',
    lg: 'h-11 px-6 text-[15px] gap-2',
  };

  const isDisabled = disabled || loading || success;

  return (
    <motion.button
      ref={btnRef}
      type={type}
      disabled={isDisabled}
      onClick={handleClick}
      whileHover={isDisabled ? {} : { y: -1 }}
      whileTap={isDisabled ? {} : { scale: 0.985 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className={clsx(
        'relative inline-flex items-center justify-center overflow-hidden rounded-control font-semibold',
        'transition-colors duration-200',
        // The global :focus-visible rule in index.css resolves its outline to
        // the element's own currentColor on buttons, which on this one means a
        // white ring on the accent fill (and a near-black ring in dark) —
        // invisible either way. A ring utility paints box-shadow instead, so it
        // is not in that rule's way, and the offset is the page ground so the
        // ring reads on any surface the button is dropped onto.
        'focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        'disabled:cursor-not-allowed disabled:opacity-50',
        sizeStyles[size],
        variant === 'primary' && 'bg-primary text-on-primary shadow-e2 hover:bg-primary-dark',
        variant === 'secondary' && 'glass text-text hover:bg-glass-hover',
        variant === 'danger' && 'border border-red/30 bg-red/12 text-red hover:bg-red/20',
        className,
      )}
    >
      <AnimatePresence>
        {ripples.map((r) => (
          <RippleEffect key={r.id} x={r.x} y={r.y} />
        ))}
      </AnimatePresence>

      <span className="relative z-10 flex items-center gap-2">
        {loading ? (
          <motion.span
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          >
            <Loader2 size={size === 'sm' ? 14 : 16} />
          </motion.span>
        ) : success ? (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', damping: 15, stiffness: 200 }}
          >
            <Check size={size === 'sm' ? 14 : 16} />
          </motion.span>
        ) : icon ? (
          icon
        ) : null}
        <span>{success ? 'Saved!' : children}</span>
      </span>
    </motion.button>
  );
}
