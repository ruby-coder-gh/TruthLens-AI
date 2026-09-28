// Claim Ledger (Lane D1) — the verdict "stamp": icon + word, never colour
// alone (WCAG). Uses index.css's `.stamp` component class (Claim Ledger
// port) — condensed caps in a double rule, inked in currentColor.
import { clsx } from 'clsx';
import { VERDICT_META, type LedgerVerdict } from './verdict';

export function Stamp({ verdict, className }: { verdict: LedgerVerdict; className?: string }) {
  const meta = VERDICT_META[verdict];
  const Icon = meta.icon;
  return (
    <span className={clsx('stamp', meta.textClass, className)}>
      <Icon size={12} aria-hidden="true" />
      {meta.label}
    </span>
  );
}
