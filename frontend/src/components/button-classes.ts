import { clsx } from 'clsx';

// Button's class-building logic lives in a dedicated (non-component) module
// so it can be co-located with `Button` in ui.tsx without tripping
// react-refresh's "only export components" rule — same split as
// toast-context.ts / auth-context.ts / theme-context.ts.

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

// `text-on-primary` is the theme-aware ink for text sitting ON the accent
// fill — white on light's #2350B5, near-black on dark's #8FB0FF. A literal
// `text-white` here would be 2.1:1 in dark mode.
export const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'border border-transparent bg-primary text-on-primary shadow-e1 hover:bg-primary-dark hover:shadow-e2',
  secondary:
    'border border-border bg-card-hover text-text hover:border-primary/40 hover:bg-primary/10 hover:text-primary-soft',
  ghost:
    'border border-transparent bg-transparent text-text-muted hover:bg-card-2 hover:text-text',
  danger:
    'border border-red/30 bg-red/10 text-red hover:bg-red/20',
};

// Fixed control heights (36 / 28 / 44) rather than padding-derived ones, so a
// Button always lines up with an Input or Select on the same row.
export const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-7 rounded-lg px-3 text-xs gap-1.5',
  md: 'h-9 rounded-control px-4 text-[13px] gap-2',
  lg: 'h-11 rounded-control px-6 text-[15px] gap-2',
};

// Shared with any non-`<button>` element that needs to *look* like a Button
// without nesting inside one — e.g. a react-router `<Link>` styled as a CTA.
// A `<Link>` already renders an `<a>`, and an `<a><button>…</button></a>`
// (interactive content inside interactive content) is invalid HTML and
// confuses screen readers (BUG-58), so those call sites use this on the
// anchor directly instead of wrapping a real `<Button>`.
export function buttonClassName(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string): string {
  return clsx(
    'inline-flex items-center justify-center whitespace-nowrap font-semibold',
    'transition-[background-color,border-color,color,box-shadow] duration-150',
    // Two-tone ring: `ring-focus-halo` paints the outline-offset gap, so
    // the outline stays legible on a filled primary button where the ring
    // and the fill are otherwise the same indigo (QA S3-5).
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    'focus-visible:ring-2 focus-visible:ring-focus-halo',
    'disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none',
    variantStyles[variant],
    sizeStyles[size],
    className,
  );
}
