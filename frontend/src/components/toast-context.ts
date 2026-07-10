import { createContext, useContext } from 'react';

// Toast primitives live in a dedicated (non-component) module so `ToastProvider`
// can be co-located with the rest of the UI kit without tripping react-refresh's
// "only export components" rule.

export type ToastType = 'success' | 'error' | 'info';

export interface ToastContextValue {
  addToast: (message: string, type?: ToastType) => void;
  removeToast: (id: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
