'use client';

/**
 * Undo toast for line-item removals. Surfaced for ~6 seconds after a
 * remove; clicking Undo invokes the caller's restore callback.
 *
 * Shared across the new-quote builder (local-state re-insert) and the
 * /orders/[id] edit table (POST to recreate the persisted row) — the
 * component is stateless about WHAT undo does, just exposes the
 * affordance.
 *
 * Multiple toasts in flight aren't supported here (one slot only) —
 * pipeline of removals is rare enough that latest-wins is fine. A
 * second remove during the first toast's lifetime replaces it.
 */

import { useEffect } from 'react';

export interface LineItemUndoToastState {
  /** Short label — usually the line description. */
  label: string;
  /** Restore handler. Caller closes the toast itself after this fires. */
  onUndo: () => void;
  /** Caller sets this when it wants the toast to disappear. */
  onDismiss: () => void;
}

const TOAST_TTL_MS = 6000;

export function LineItemUndoToast({ toast }: { toast: LineItemUndoToastState | null }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => toast.onDismiss(), TOAST_TTL_MS);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg px-4 py-2.5 flex items-center gap-4 text-sm">
      <span className="text-zinc-200">
        Removed <span className="text-zinc-400 italic">{toast.label}</span>
      </span>
      <button
        type="button"
        onClick={() => { toast.onUndo(); toast.onDismiss(); }}
        className="text-amber-300 hover:text-amber-200 font-semibold text-xs uppercase tracking-wider"
      >
        Undo
      </button>
      <button
        type="button"
        onClick={toast.onDismiss}
        className="text-zinc-500 hover:text-white text-sm leading-none"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
