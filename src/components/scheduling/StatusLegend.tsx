'use client'

/**
 * Shared reservations legend — renders LEGEND_ITEMS (and optionally the
 * condition-tier key) straight from lib/scheduling/statusTokens, so the
 * legend can never drift from the bar colors. Extra surface-specific
 * entries (e.g. the gantt's "Unit on a job today" cell) ride in as
 * children after the derived rows.
 */

import { LEGEND_ITEMS, TIER_COLORS, TIER_LABELS, TIER_ORDER } from '@/lib/scheduling/statusTokens'

export default function StatusLegend({
  showTiers = false,
  children,
}: {
  showTiers?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="flex gap-3 mb-2 text-[10px] flex-wrap items-center">
      {LEGEND_ITEMS.map((l) => (
        <div key={l.label} className="flex items-center gap-1">
          <div className={`w-3 h-2 rounded-sm ${l.swatch}`} />
          <span className={`text-gray-500 ${l.struck ? 'line-through' : ''}`}>{l.label}</span>
        </div>
      ))}
      {showTiers && (
        <>
          <span className="text-gray-300">|</span>
          <span className="text-gray-400 font-medium">Condition:</span>
          {TIER_ORDER.map((t) => (
            <div key={t} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full border border-black/5" style={{ background: TIER_COLORS[t] }} />
              <span className="text-gray-500">{TIER_LABELS[t]}</span>
            </div>
          ))}
        </>
      )}
      {children}
    </div>
  )
}
