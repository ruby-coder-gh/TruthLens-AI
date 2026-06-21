import { useState, useRef, type ReactNode, type InputHTMLAttributes } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import { AlertCircle, Loader2 } from 'lucide-react';

interface AnimatedInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: ReactNode;
  actionButton?: ReactNode;
  loading?: boolean;
}

function RippleDot() {
  return (
    <motion.span
      className="absolute inset-0 rounded-lg pointer-events-none"
      initial={{ scale: 0.8, opacity: 0.5 }}
      animate={{ scale: 1.5, opacity: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
    />
  );
}

export function InputActionButton({
  children,
  onClick,
  active,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  const [rippleKey, setRippleKey] = useState(0);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setRippleKey((k) => k + 1);
    onClick?.();
  };

  return (
    <motion.button
      type="button"
      onClick={handleClick}
      className={clsx(
        'relative flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-300',
        'border backdrop-blur-sm overflow-hidden',
        active
          ? 'border-primary/40 bg-primary/15 text-primary-soft'
          : 'border-glass-border bg-[#0a0e17]/60 text-text-dim hover:text-text hover:border-primary/30',
      )}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.92 }}
      animate={
        active
          ? {
              boxShadow: [
                '0 0 4px rgba(139,92,246,0.2)',
                '0 0 10px rgba(139,92,246,0.4)',
                '0 0 4px rgba(139,92,246,0.2)',
              ],
            }
          : {
              boxShadow: [
                '0 0 0px rgba(139,92,246,0)',
                '0 0 4px rgba(139,92,246,0.1)',
                '0 0 0px rgba(139,92,246,0)',
              ],
            }
      }
      transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
    >
      <motion.span
        className="flex items-center justify-center"
        whileHover={{ rotate: 5 }}
        transition={{ duration: 0.2 }}
      >
        {children}
      </motion.span>

      <AnimatePresence mode="wait">
        {rippleKey > 0 && (
          <motion.span
            key={rippleKey}
            className="absolute inset-0 rounded-lg bg-white/20"
            initial={{ scale: 0.3, opacity: 0.6 }}
            animate={{ scale: 2, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>
    </motion.button>
  );
}

export default function AnimatedInput({
  label,
  error,
  icon,
  actionButton,
  loading,
  className,
  id,
  ...props
}: AnimatedInputProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
  const [focused, setFocused] = useState(false);

  return (
    <div className="space-y-1.5">
      {label && (
        <motion.label
          htmlFor={inputId}
          className="block text-sm font-medium text-text-muted"
          animate={focused ? { color: 'rgba(167,139,250,0.9)' } : {}}
          transition={{ duration: 0.2 }}
        >
          {label}
        </motion.label>
      )}
      <div className="relative">
        {/* Focus glow ring */}
        {focused && (
          <motion.div
            className="absolute -inset-0.5 rounded-xl opacity-50 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            style={{
              background: 'linear-gradient(135deg, rgba(139,92,246,0.3), rgba(59,130,246,0.15))',
              filter: 'blur(4px)',
            }}
          />
        )}

        <div className="relative flex items-center">
          {/* Icon */}
          {icon && (
            <motion.span
              className="pointer-events-none absolute left-3 flex items-center justify-center text-text-dim z-10"
              animate={focused ? { color: 'rgba(167,139,250,0.8)' } : {}}
              transition={{ duration: 0.2 }}
            >
              {icon}
            </motion.span>
          )}

          <input
            id={inputId}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            className={clsx(
              'w-full rounded-xl px-3 py-2.5 text-sm text-text placeholder-text-dim transition-all duration-300',
              'bg-[#0a0e17]/70 backdrop-blur-sm border',
              focused
                ? 'border-primary/40 bg-[#0a0e17]/90'
                : error
                  ? 'border-red/50'
                  : 'border-glass-border hover:border-primary/20',
              'focus:outline-none',
              icon && 'pl-10',
              actionButton && 'pr-11',
              loading && 'pr-11',
              className,
            )}
            {...props}
          />

          {/* Loading spinner */}
          {loading && (
            <motion.span className="absolute right-3 flex items-center justify-center text-text-dim">
              <motion.span animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                <Loader2 size={14} />
              </motion.span>
            </motion.span>
          )}

          {/* Action button */}
          {actionButton && !loading && (
            <span className="absolute right-2.5 flex items-center justify-center z-10">
              {actionButton}
            </span>
          )}
        </div>
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0.99, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0.99, y: -4 }}
            className="flex items-center gap-1 text-xs text-red"
          >
            <AlertCircle size={12} /> {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
