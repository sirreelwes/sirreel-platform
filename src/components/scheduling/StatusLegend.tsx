'use client'

/**
 * Shared reservations legend — renders LEGEND_ITEMS (and optionally the
 * condition-tier key) straight from lib/scheduling/statusTokens, so the
 * legend can never drift from the bar colors. Extra surface-specific
 * entries (e.g. the gantt's "Unit on a job today" cell) ride in as
 * children after the derived rows.
 */

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

import {
  LEGEND_ITEMS,
  TIER_COLORS,
  TIER_LABELS,
  TIER_ORDER,
  readinessMeterStyle,
} from '@/lib/scheduling/statusTokens'

export default function StatusLegend({
  showTiers = false,
  children,
}: {
  showTiers?: boolean
  children?: React.ReactNode
}) {
  // Wes 2026-09-16: on a phone the key ate most of the screen before the
  // board started. Collapsed by default below `sm` and opened by the
  // button beside it; from `sm` up it is always open and the button is
  // gone, so the desktop board is byte-for-byte what it was. Purely a
  // CSS breakpoint (`hidden sm:flex`), NOT a measured viewport — nothing
  // to hydrate wrong on the server render.
  const [open, setOpen] = useState(false)

  return (
    // One wrapper element, because the calendar header renders this as a
    // flex item — a fragment would make the toggle its own sibling there.
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="sm:hidden mb-1 inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-500"
      >
        <ChevronDown size={11} aria-hidden className={open ? 'rotate-180' : ''} />
        {open ? 'Hide legend' : 'Legend'}
      </button>

      <div
        className={`${open ? 'flex' : 'hidden sm:flex'} gap-3 text-[10px] flex-wrap items-center`}
      >
        {LEGEND_ITEMS.map((l) => (
          <div key={l.label} className="flex items-center gap-1">
            <div className={`w-3 h-2 rounded-sm ${l.swatch}`} />
            <span className={`text-gray-500 ${l.struck ? 'line-through' : ''}`}>{l.label}</span>
          </div>
        ))}
        {/* Paperwork meter — the same gradient the bars draw, so the key and
            the rail cannot drift. Three samples read better than one: the
            point is that it FILLS. */}
        <span className="text-gray-300">|</span>
        <span className="text-gray-400 font-medium">Paperwork:</span>
        {[0, 3, 5].map((done) => (
          <div key={done} className="flex items-center gap-1">
            <div
              className="w-8 h-3 rounded-sm bg-blue-500"
              style={readinessMeterStyle(done, 5)}
            />
            <span className="text-gray-500">{done === 5 ? 'ready' : `${done} of 5`}</span>
          </div>
        ))}
        {showTiers && (
          <>
            <span className="text-gray-300">|</span>
            <TierKey />
          </>
        )}
        {children}
      </div>
    </div>
  )
}

/**
 * The condition-tier key (Best / Good / Workhorse dots). Wes 2026-09-10:
 * "move the legend for vehicle condition to the very bottom of the
 * vehicle list — this is not critical information to have at top." The
 * gantt renders it under its last unit row; `showTiers` above stays for
 * any surface that still wants it inline.
 */
export function TierKey({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 text-[10px] flex-wrap ${className}`}>
      <span className="text-gray-400 font-medium">Condition:</span>
      {TIER_ORDER.map((t) => (
        <div key={t} className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full border border-black/5" style={{ background: TIER_COLORS[t] }} />
          <span className="text-gray-500">{TIER_LABELS[t]}</span>
        </div>
      ))}
    </div>
  )
}
