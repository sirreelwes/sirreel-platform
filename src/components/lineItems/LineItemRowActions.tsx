'use client';

/**
 * Universal row-action kebab for line items. One control, every row,
 * every surface (the new-quote builder + the persisted-order edit
 * table). Standardizes what was previously two different affordances
 * (kebab vs bare ×) into one.
 *
 * State-aware via the `editability` prop:
 *   - canEdit=true   → kebab renders; menu exposes "Remove line item"
 *                       (always) plus any caller-provided extra actions.
 *   - canEdit=false  → kebab is suppressed. Document is locked (issued
 *                       quote past SENT, paid invoice, etc.) — naive
 *                       row deletion is not allowed. Optional
 *                       `lockedReason` shows on hover for clarity.
 *
 * Why kebab over a bare trash icon: new-quote already uses a kebab as
 * the row-actions pattern with "Change department" inside. We keep
 * that pattern + add more menu items as needed. Future invoices
 * inherit the same control.
 *
 * The component does NOT own toast/undo state — that's per-surface
 * (different undo payloads for local vs persisted lines). The caller
 * wires onRemove to its own state-update + toast logic.
 */

import { useEffect, useRef, useState } from 'react';

export interface LineItemRowActionsExtra {
  /** Menu label. */
  label: string;
  /** Click handler. The component closes the menu before invoking. */
  onClick: () => void;
  /** Optional Tailwind text color override (e.g. for destructive items). */
  tone?: 'default' | 'destructive';
}

export interface LineItemRowActionsProps {
  /** Required. Called when the agent picks "Remove line item". The
   *  caller is responsible for either state-filter (local draft) or
   *  API DELETE (persisted) — and for surfacing an undo affordance. */
  onRemove: () => void;
  /** Extra menu items above the divider — used by new-quote for
   *  "Change department". Order preserved as supplied. */
  extras?: LineItemRowActionsExtra[];
  /** Whether the document is in a state that allows line edits. */
  editability: {
    canEdit: boolean;
    /** Tooltip shown when canEdit=false. Surfaces "why" so the
     *  agent knows what to do (issue a credit, etc.). */
    lockedReason?: string;
  };
  /** Render-size hint; defaults to 'normal'. The new-quote grid is
   *  tight — 'compact' uses a smaller hit target. */
  size?: 'normal' | 'compact';
}

export function LineItemRowActions({
  onRemove,
  extras,
  editability,
  size = 'normal',
}: LineItemRowActionsProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Click-outside-to-close. The menu is local to one row; document
  // listener avoids dragging in floating-ui or a portal.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!editability.canEdit) {
    // Locked — render a muted lock glyph with a tooltip rather than
    // an empty cell. Makes it obvious WHY editing isn't available;
    // empty cell would read like a UI bug.
    return (
      <span
        className="inline-block text-lt-fg3 cursor-not-allowed select-none"
        title={editability.lockedReason ?? 'This document is locked — line items cannot be edited.'}
        aria-label="Locked"
      >
        🔒
      </span>
    );
  }

  const btnPad = size === 'compact' ? 'px-1 py-0.5 text-sm' : 'px-2 py-1';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${btnPad} text-lt-fg3 hover:text-lt-fg rounded`}
        title="Row actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-20 w-48 bg-lt-card border border-lt-hairline rounded-lg shadow-lg p-1 space-y-0.5"
        >
          {extras?.map((extra) => (
            <button
              key={extra.label}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); extra.onClick(); }}
              className={`w-full text-left px-2 py-1.5 text-[11px] hover:bg-lt-inner rounded ${
                extra.tone === 'destructive' ? 'text-chip-bad-fg' : 'text-lt-fg'
              }`}
            >
              {extra.label}
            </button>
          ))}
          {extras && extras.length > 0 && <div className="my-0.5 border-t border-lt-hairline" />}
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onRemove(); }}
            className="w-full text-left px-2 py-1.5 text-[11px] text-chip-bad-fg hover:bg-lt-inner rounded"
          >
            Remove line item
          </button>
        </div>
      )}
    </div>
  );
}
