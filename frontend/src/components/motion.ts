// ─── Motion Variants (WAAPI-safe, no opacity:0 in initial) ───
//
// Shared Framer Motion variants. Kept in a dedicated (non-component) module so
// files that render components can import them without tripping react-refresh's
// "only export components" rule.
//
// NOTE: `opacity: 0.99` (rather than exactly 0) in the `initial` states is an
// intentional workaround for a WAAPI browser bug — do not "simplify" it to 0.

export const fadeIn = {
  initial: { opacity: 0.99, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] as const } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.15 } },
};

export const fadeInUp = {
  initial: { opacity: 0.99, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] as const } },
};

export const fadeInScale = {
  initial: { opacity: 0.99, scale: 0.98 },
  animate: { opacity: 1, scale: 1, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] as const } },
};

export const slideInLeft = {
  initial: { opacity: 0.99, x: -12 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] as const } },
};

export const slideInRight = {
  initial: { opacity: 0.99, x: 12 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] as const } },
};

export const staggerContainer = {
  animate: {
    transition: { staggerChildren: 0.04, delayChildren: 0.05 },
  },
};

export const staggerItem = {
  initial: { opacity: 0.99, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] as const } },
};

export const pageTransition = {
  initial: { opacity: 0.99, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] as const } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.15 } },
};
