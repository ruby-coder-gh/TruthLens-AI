import {
  forwardRef,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type SelectHTMLAttributes,
} from 'react';
import { motion, AnimatePresence, type HTMLMotionProps } from 'framer-motion';
import { clsx } from 'clsx';
import {
  X,
  AlertCircle,
  CheckCircle,
  Info,
  Loader2,
  ChevronDown,
} from 'lucide-react';
import { ToastContext, type ToastType } from './toast-context';

// ═════════════════════════════════════════════════════════════════════════════
//  BUTTON
// ═════════════════════════════════════════════════════════════════════════════

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-bg shadow-[0_12px_30px_rgba(232,193,90,0.24)] hover:bg-primary-soft hover:shadow-[0_16px_34px_rgba(232,193,90,0.32)]',
  secondary:
    'bg-card/80 border border-border text-text hover:bg-card-hover hover:border-primary/45',
  ghost:
    'bg-transparent text-text-muted hover:bg-card-2 hover:text-text',
  danger:
    'bg-red/15 text-red border border-red/30 hover:bg-red/25',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-5 py-2.5 text-sm gap-2',
  lg: 'px-7 py-3.5 text-base gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading = false, disabled, className, children, ...props }, ref) => {
    const isDisabled = disabled || loading;
    return (
      <motion.button
        ref={ref}
        disabled={isDisabled}
        whileHover={{ scale: isDisabled ? 1 : 1.02 }}
        whileTap={{ scale: isDisabled ? 1 : 0.98 }}
        className={clsx(
          'inline-flex items-center justify-center rounded-xl font-semibold transition-all duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
          'disabled:cursor-not-allowed disabled:opacity-50',
          variantStyles[variant],
          sizeStyles[size],
          className,
        )}
        {...(props as HTMLMotionProps<'button'>)}
      >
        {loading && <Loader2 size={size === 'sm' ? 14 : 16} className="animate-spin" />}
        {children}
      </motion.button>
    );
  },
);
Button.displayName = 'Button';

// ═════════════════════════════════════════════════════════════════════════════
//  INPUT
// ═════════════════════════════════════════════════════════════════════════════

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: ReactNode;
  suffix?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, suffix, className, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-text-muted">{label}</label>
        )}
        <div className="relative">
          {icon && (
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-text-dim">{icon}</div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={clsx(
              'glass-input w-full rounded-xl px-3 py-2.5 text-sm text-text placeholder-text-dim transition-all',
              'focus:outline-none',
              error ? 'border-red/50' : '',
              icon && 'pl-10',
              suffix && 'pr-10',
              className,
            )}
            {...props}
          />
          {suffix && (
            <div className="absolute inset-y-0 right-0 flex items-center pr-2">{suffix}</div>
          )}
        </div>
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
  },
);
Input.displayName = 'Input';

// ═════════════════════════════════════════════════════════════════════════════
//  TEXTAREA
// ═════════════════════════════════════════════════════════════════════════════

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({ label, error, className, id, ...props }, ref) => {
    const textareaId = id || label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={textareaId} className="block text-sm font-medium text-text-muted">{label}</label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={clsx(
            'glass-input w-full rounded-xl px-3 py-2.5 text-sm text-text placeholder-text-dim transition-all',
            'focus:outline-none resize-y min-h-[80px]',
            error ? 'border-red/50' : '',
            className,
          )}
          {...props}
        />
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
  },
);
TextArea.displayName = 'TextArea';

// ═════════════════════════════════════════════════════════════════════════════
//  SELECT
// ═════════════════════════════════════════════════════════════════════════════

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, placeholder, className, id, ...props }, ref) => {
    const selectId = id || label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={selectId} className="block text-sm font-medium text-text-muted">{label}</label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={clsx(
              'glass-input w-full appearance-none rounded-xl px-3 py-2.5 pr-10 text-sm text-text transition-all',
              'focus:outline-none',
              error ? 'border-red/50' : '',
              className,
            )}
            {...props}
          >
            {placeholder && <option value="" disabled>{placeholder}</option>}
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <ChevronDown size={16} className="pointer-events-none absolute inset-y-0 right-3 top-1/2 -translate-y-1/2 text-text-dim" />
        </div>
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
  },
);
Select.displayName = 'Select';

// ═════════════════════════════════════════════════════════════════════════════
//  CARD
// ═════════════════════════════════════════════════════════════════════════════

interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: () => void;
}

export function Card({ children, className, hover = false, onClick }: CardProps) {
  const Component = onClick ? motion.button : motion.div;
  return (
    <Component
      onClick={onClick}
      whileHover={hover || onClick ? { y: -4, scale: 1.01 } : {}}
      whileTap={onClick ? { scale: 0.98 } : {}}
      className={clsx(
        'glass rounded-2xl border border-border/60 p-5 shadow-[0_14px_34px_rgba(2,7,18,0.34)] transition-all duration-200 lg:p-6',
        (hover || onClick) && 'cursor-pointer hover:border-primary/45 hover:shadow-[0_20px_42px_rgba(12,30,64,0.38)]',
        onClick && 'w-full text-left',
        className,
      )}
    >
      {children}
    </Component>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  BADGE
// ═════════════════════════════════════════════════════════════════════════════

type BadgeColor = 'green' | 'orange' | 'red' | 'purple' | 'blue' | 'gray';

interface BadgeProps {
  children: ReactNode;
  color?: BadgeColor;
  className?: string;
}

const badgeColors: Record<BadgeColor, string> = {
  green: 'bg-green/15 text-green border-green/25',
  orange: 'bg-orange/15 text-orange border-orange/25',
  red: 'bg-red/15 text-red border-red/25',
  purple: 'bg-primary/15 text-primary-soft border-primary/25',
  blue: 'bg-accent-2/15 text-accent-2 border-accent-2/25',
  gray: 'bg-card-2 text-text-dim border-border',
};

export function Badge({ children, color = 'gray', className }: BadgeProps) {
  return (
    <span className={clsx('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-[0.01em]', badgeColors[color], className)}>
      {children}
    </span>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  MODAL
// ═════════════════════════════════════════════════════════════════════════════

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, children, className }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  // Focus trap + return-focus: on open, remember the trigger and move focus
  // into the panel; on close, restore focus to the trigger. Tab/Shift+Tab is
  // constrained to the panel's focusable elements while open.
  useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const focusFirst = () => {
      const focusable = panel?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      (focusable && focusable.length > 0 ? focusable[0] : panel)?.focus();
    };
    // Defer one tick so the panel has finished mounting/animating in.
    const raf = requestAnimationFrame(focusFirst);

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (e.shiftKey) {
        if (active === first || !panelRef.current.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !panelRef.current.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleTab);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', handleTab);
      previouslyFocusedRef.current?.focus?.();
      previouslyFocusedRef.current = null;
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0.99 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0.99 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          {/* Overlay */}
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
            onClick={onClose}
            aria-hidden="true"
            initial={{ opacity: 0.99 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0.99 }}
          />

          {/* Panel */}
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            initial={{ opacity: 0.99 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className={clsx(
              'relative z-10 w-full max-w-lg glass rounded-2xl p-6 shadow-2xl shadow-black/40',
              'border border-glass-border',
              'focus:outline-none',
              className,
            )}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            {title && (
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-text">{title}</h2>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-all duration-150 hover:scale-110 hover:bg-card-2 hover:text-text active:scale-90"
                  aria-label="Close modal"
                >
                  <X size={18} />
                </button>
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  TOAST SYSTEM
//  (ToastContext + useToast live in ./toast-context to keep this a components-only
//   module for react-refresh; ToastProvider stays here.)
// ═════════════════════════════════════════════════════════════════════════════

interface ToastData {
  id: string;
  message: string;
  type: ToastType;
}

const toastIcons: Record<ToastType, ReactNode> = {
  success: <CheckCircle size={18} className="text-green" />,
  error: <AlertCircle size={18} className="text-red" />,
  info: <Info size={18} className="text-accent-2" />,
};

const toastBorder: Record<ToastType, string> = {
  success: 'border-l-green',
  error: 'border-l-red',
  info: 'border-l-accent-2',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(() => removeToast(id), 4000);
    },
    [removeToast],
  );

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm" aria-live="polite">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0.99, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ duration: 0.2 }}
              className={clsx(
                'flex items-start gap-3 glass rounded-xl p-4 shadow-xl border-2 border-transparent',
                toastBorder[toast.type],
              )}
            >
              <span className="mt-0.5 shrink-0">{toastIcons[toast.type]}</span>
              <p className="flex-1 text-sm text-text">{toast.message}</p>
              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                className="shrink-0 text-text-dim transition-colors hover:text-text"
                aria-label="Dismiss notification"
              >
                <X size={16} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  EMPTY STATE
// ═════════════════════════════════════════════════════════════════════════════

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={clsx('flex flex-col items-center justify-center py-16 text-center', className)}>
      {icon && (
        <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-2xl glass text-text-dim animate-fadeInScale">
          {icon}
        </div>
      )}
      <h3 className="text-xl font-semibold text-text">{title}</h3>
      {description && <p className="mt-2 max-w-sm text-sm text-text-muted">{description}</p>}
      {action && <div className="mt-6 hover:scale-105 transition-transform duration-150">{action}</div>}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  LOADING SPINNER
// ═════════════════════════════════════════════════════════════════════════════

interface LoadingSpinnerProps {
  size?: number;
  text?: string;
  className?: string;
}

export function LoadingSpinner({ size = 24, text, className }: LoadingSpinnerProps) {
  return (
    <div className={clsx('flex flex-col items-center justify-center gap-4 py-16', className)}>
      <Loader2 size={size} className="text-primary animate-spin" />
      {text && <p className="text-sm text-text-muted animate-pulse">{text}</p>}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  SKELETON
// ═════════════════════════════════════════════════════════════════════════════

interface SkeletonProps {
  className?: string;
  height?: number | string;
  width?: number | string;
  count?: number;
}

export function Skeleton({ className, height = 16, width = '100%', count = 1 }: SkeletonProps) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0.99 }}
          animate={{ opacity: 1 }}
          transition={{ delay: i * 0.05 }}
          className={clsx('shimmer rounded-xl', className)}
          style={{
            height: typeof height === 'number' ? `${height}px` : height,
            width: typeof width === 'number' ? `${width}px` : width,
          }}
          aria-hidden="true"
        />
      ))}
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  PROGRESS BAR
// ═════════════════════════════════════════════════════════════════════════════

interface ProgressBarProps {
  value: number; // 0–100
  className?: string;
  size?: 'sm' | 'md';
  label?: string;
}

export function ProgressBar({ value, className, size = 'md', label }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className={clsx('space-y-1.5', className)}>
      {label && (
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>{label}</span>
          <span>{Math.round(clamped)}%</span>
        </div>
      )}
      <div
        className={clsx(
          'w-full overflow-hidden rounded-full bg-card-2',
          size === 'sm' ? 'h-1.5' : 'h-2.5',
        )}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary via-accent to-accent-2 animate-gradient transition-all duration-700 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  TABS
// ═════════════════════════════════════════════════════════════════════════════

interface Tab {
  id: string;
  label: string;
  icon?: ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (tabId: string) => void;
  className?: string;
}

export function Tabs({ tabs, activeTab, onChange, className }: TabsProps) {
  return (
    <div className={clsx('flex gap-1 rounded-xl glass p-1', className)} role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <motion.button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={clsx(
              'relative flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-150',
              'hover:scale-[1.02] active:scale-[0.98]',
              isActive ? 'text-primary-soft' : 'text-text-muted hover:text-text',
            )}
          >
            {isActive && (
              <motion.div
                layoutId="activeTab"
                className="absolute inset-0 rounded-lg bg-primary/10 border border-primary/20"
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              {tab.icon}
              {tab.label}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}
