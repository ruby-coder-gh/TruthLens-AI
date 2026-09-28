// Claim Ledger (Lane D1) — "Claim ledger | Read as prose" toggle. One
// module-level, localStorage-persisted flag shared by every answer on the
// page (and by ChatDetailPage), same pub-sub pattern the old Truth Lens
// toggle used in AnswerBody. Defaults to the ledger — that's the hero view.
import { useSyncExternalStore } from 'react';

export type AnswerView = 'ledger' | 'prose';

const STORAGE_KEY = 'truthlens:answer-view';
const listeners = new Set<() => void>();
/** Session-only fallback for when localStorage throws (private mode). */
let memoryFallback: AnswerView = 'ledger';

function read(): AnswerView {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'prose' ? 'prose' : 'ledger';
  } catch {
    return memoryFallback;
  }
}

function write(next: AnswerView): void {
  memoryFallback = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage unavailable — the in-memory fallback still drives this session.
  }
  listeners.forEach((notify) => notify());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAnswerView(): [AnswerView, (next: AnswerView) => void] {
  const view = useSyncExternalStore(subscribe, read);
  return [view, write];
}

/** Test-only escape hatch — jsdom has no window.localStorage in this repo's
 *  test setup, so the in-memory fallback is a static singleton that would
 *  otherwise leak the selected view across `it()` blocks. */
export function __resetAnswerViewForTests(): void {
  memoryFallback = 'ledger';
}
