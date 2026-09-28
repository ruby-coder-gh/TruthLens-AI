// Claim Ledger (Lane D1) — the verdict "stamp": icon + word, never colour
// alone (WCAG). Reuses the app's existing `.wax-seal` chip (index.css) —
// border/background both derive from `currentColor` via `color-mix`, which is
// exactly the prototype's `.stamp` construction, so no new CSS was needed.
import { clsx } from 'clsx';
import { VERDICT_META, type LedgerVerdict } from './verdict';

export function Stamp({ verdict, className }: { verdict: LedgerVerdict; className?: string }) {
  const meta = VERDICT_META[verdict];
  const Icon = meta.icon;
  return (
    <span className={clsx('wax-seal', meta.textClass, className)}>
      <Icon size={12} aria-hidden="true" />
      {meta.label}
    </span>
  );
}
