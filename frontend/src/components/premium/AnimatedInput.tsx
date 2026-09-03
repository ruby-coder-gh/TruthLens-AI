import { useState, type ReactNode, type InputHTMLAttributes } from 'react';
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

/**
 * A small control that sits inside an input.
 *
 * It used to run an infinite box-shadow pulse in *both* states — an idle
 * button quietly breathing indigo light forever. The active state is now
 * carried by an accent tint and edge, which is a stronger signal, holds up on
 * a light ground, and stops animating when nothing is happening.
 */
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
        'relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-chip border',
        'transition-colors duration-200',
        active
          ? 'border-primary/40 bg-primary/12 text-primary-soft'
          : 'border-border bg-card-2 text-text-muted hover:border-primary/30 hover:text-text',
      )}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.94 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
    >
      <span className="relative z-10 flex items-center justify-center">{children}</span>

      <AnimatePresence mode="wait">
        {rippleKey > 0 && (
          <motion.span
            key={rippleKey}
            className="absolute inset-0 rounded-chip bg-current"
            initial={{ scale: 0.3, opacity: 0.22 }}
            animate={{ scale: 2, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>
    </motion.button>
  );
}

/**
 * The auth/settings text field.
 *
 * Two decorative layers are gone. The focus "glow" was a blurred
 * indigo→green gradient bled around the control — a second accent hue that
 * exists nowhere else in this direction, and a soft halo that on a white page
 * just looks like a rendering artefact. And the label and icon animated their
 * colour to a raw `rgba(99,102,241,.9)`, which lands under 4.5:1 on a white
 * field. Both now resolve to the design system's text-safe accent ink via a
 * plain CSS transition, and the focused field takes the board's ring:
 * `border-primary` plus a 3px `primary-glow` halo that flips with the theme.
 */
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
  const errorId = inputId ? `${inputId}-error` : undefined;
  const [focused, setFocused] = useState(false);

  return (
    <div className="space-y-1.5">
      {label && (
        <label
          htmlFor={inputId}
          className={clsx(
            'block text-sm font-medium transition-colors duration-200',
            focused ? 'text-primary-soft' : 'text-text-muted',
          )}
        >
          {label}
        </label>
      )}
      <div className="relative">
        <div className="relative flex items-center">
          {icon && (
            <span
              className={clsx(
                'pointer-events-none absolute left-3 z-10 flex items-center justify-center',
                'transition-colors duration-200',
                focused ? 'text-primary-soft' : 'text-text-dim',
              )}
              aria-hidden="true"
            >
              {icon}
            </span>
          )}

          <input
            id={inputId}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error && errorId ? errorId : undefined}
            className={clsx(
              // Inputs are always opaque — body text never sits on a blur.
              'w-full rounded-control border bg-solid px-3 py-2.5 text-sm text-text',
              'placeholder:text-text-dim transition-[border-color,box-shadow] duration-200',
              'focus:outline-none',
              focused
                ? 'border-primary shadow-[0_0_0_3px_var(--color-primary-glow)]'
                : error
                  ? 'border-red'
                  : 'border-border hover:border-primary/40',
              icon && 'pl-10',
              (actionButton || loading) && 'pr-11',
              className,
            )}
            {...props}
          />

          {loading && (
            <span className="absolute right-3 flex items-center justify-center text-text-dim">
              <motion.span
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              >
                <Loader2 size={14} />
              </motion.span>
            </span>
          )}

          {actionButton && !loading && (
            <span className="absolute right-2.5 z-10 flex items-center justify-center">
              {actionButton}
            </span>
          )}
        </div>
      </div>

      <AnimatePresence>
        {error && (
          <motion.p
            id={errorId}
            initial={{ opacity: 0.99, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0.99, y: -4 }}
            className="flex items-center gap-1 text-xs text-red"
          >
            <AlertCircle size={12} className="shrink-0" aria-hidden="true" /> {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
