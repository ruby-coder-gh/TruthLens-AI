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

function RippleEffect({ x, y }: { x: number; y: number }) {
  return (
    <motion.span
      className="absolute rounded-full bg-white/30 pointer-events-none"
      style={{ left: x, top: y, width: 20, height: 20, marginLeft: -10, marginTop: -10 }}
      initial={{ scale: 0, opacity: 0.8 }}
      animate={{ scale: 6, opacity: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
    />
  );
}

function BorderBeam() {
  return (
    <motion.span
      className="absolute inset-0 rounded-xl pointer-events-none overflow-hidden"
      aria-hidden="true"
    >
      <motion.span
        className="absolute inset-0 rounded-xl"
        style={{
          background: 'conic-gradient(from 0deg, transparent, rgba(232,193,90,0.55), rgba(91,185,138,0.5), rgba(214,85,59,0.4), transparent)',
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
      />
      <span className="absolute inset-[1px] rounded-[11px] bg-[#14150f]" />
    </motion.span>
  );
}

function ParticleSpark() {
  return (
    <span className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <motion.span
          key={i}
          className="absolute w-1 h-1 rounded-full bg-primary-soft"
          style={{ left: `${20 + i * 25}%`, top: '50%' }}
          initial={{ y: 0, opacity: 0 }}
          animate={{
            y: [0, -24 - i * 6],
            opacity: [0, 0.8, 0],
            scale: [0, 1, 0],
          }}
          transition={{ duration: 0.8, delay: i * 0.1, ease: 'easeOut' }}
        />
      ))}
    </span>
  );
}

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
  const [showSpark, setShowSpark] = useState(false);
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
      setShowSpark(true);
      setTimeout(() => setShowSpark(false), 800);
      onClick(e);
    }
  };

  const sizeStyles = {
    sm: 'px-5 py-2.5 text-xs gap-1.5',
    md: 'px-6 py-3 text-sm gap-2',
    lg: 'px-8 py-4 text-base gap-2',
  };

  const isDisabled = disabled || loading || success;

  return (
      <motion.button
        ref={btnRef}
        type={type}
        disabled={isDisabled}
        onClick={handleClick}
      whileHover={isDisabled ? {} : { scale: 1.02, y: -2 }}
      whileTap={isDisabled ? {} : { scale: 0.98 }}
      className={clsx(
        'relative overflow-hidden rounded-xl font-semibold transition-all duration-300 inline-flex items-center justify-center',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        'disabled:cursor-not-allowed disabled:opacity-50',
        sizeStyles[size],
        variant === 'primary' && [
          // PremiumButton insets an ink panel (BorderBeam) over the manila
          // gradient, so its visible surface is dark — use light text, not ink.
          'text-text',
          !loading && !success && 'shadow-lg',
        ],
        variant === 'secondary' && 'glass text-text hover:bg-card-hover',
        variant === 'danger' && 'bg-red/15 text-red border border-red/30 hover:bg-red/25',
        className,
      )}
      style={
        variant === 'primary' && !loading && !success
          ? {
              background: 'linear-gradient(135deg, #f1d689, #e8c15a, #c89f3c)',
              backgroundSize: '200% 200%',
              boxShadow: '0 4px 24px rgba(232,193,90,0.3)',
            }
          : variant === 'primary' && loading
          ? { background: 'linear-gradient(135deg, #f1d689, #e8c15a)' }
          : {}
      }
    >
      {/* Animated gradient for primary */}
      {variant === 'primary' && !loading && !success && (
        <motion.span
          className="absolute inset-0 rounded-xl"
          style={{
            background: 'linear-gradient(135deg, #f1d689, #e8c15a, #c89f3c, #f1d689)',
            backgroundSize: '300% 300%',
          }}
          animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
        />
      )}

      {/* Border beam for primary */}
      {variant === 'primary' && !loading && !success && <BorderBeam />}

      {/* Particle spark on click */}
      {showSpark && !loading && !success && <ParticleSpark />}

      {/* Ripple effects */}
      <AnimatePresence>
        {ripples.map((r) => (
          <RippleEffect key={r.id} x={r.x} y={r.y} />
        ))}
      </AnimatePresence>

      {/* Content */}
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
            initial={{ scale: 0, rotate: -90 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', damping: 15, stiffness: 200 }}
          >
            <Check size={size === 'sm' ? 14 : 16} />
          </motion.span>
        ) : icon ? (
          icon
        ) : null}
        <motion.span
          animate={success ? { scale: [1, 1.1, 1] } : {}}
          transition={{ duration: 0.3 }}
        >
          {success ? 'Saved!' : children}
        </motion.span>
      </span>

      {/* Glow shadow overlay */}
      {variant === 'primary' && !loading && !success && (
        <motion.span
          className="absolute inset-0 rounded-xl opacity-0"
          style={{
            boxShadow: '0 0 30px rgba(232,193,90,0.4), 0 0 60px rgba(91,185,138,0.2)',
          }}
          whileHover={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        />
      )}
    </motion.button>
  );
}
