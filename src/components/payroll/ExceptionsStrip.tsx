'use client'

/**
 * The things to look at before locking.
 *
 * On the paper process these were caught by somebody noticing. Meal premiums
 * and adjustments are money that leaves the company without a timecard behind
 * it; a day over 12 hours is double-time territory. None of them is an error
 * — they just all need a human to have seen them.
 *
 * Rendered only when there is something in it. An always-present "0 exceptions"
 * panel trains people to ignore the space it occupies.
 */

import { formatCalendarDate } from '@/lib/dates/calendarDate'
import type { GridRow } from './types'

const KIND_LOOK: Record<string, { label: string; bg: string; fg: string }> = {
  'meal-premium': { label: 'Meal premium', bg: 'bg-chip-warn-bg', fg: 'text-chip-warn-fg' },
  adjustment: { label: 'Adjustment', bg: 'bg-chip-neutral-bg', fg: 'text-chip-neutral-fg' },
  'long-day': { label: 'Over 12 hrs', bg: 'bg-chip-bad-bg', fg: 'text-chip-bad-fg' },
  'incomplete-punch': { label: 'Incomplete', bg: 'bg-chip-bad-bg', fg: 'text-chip-bad-fg' },
}

export function ExceptionsStrip({ rows }: { rows: GridRow[] }) {
  const items = rows.flatMap((r) =>
    r.exceptions.map((e) => ({ ...e, employee: r.fullName })),
  )
  if (items.length === 0) return null

  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-lt-hairline">
        <h2 className="text-sm font-semibold text-lt-fg">
          Needs a look · {items.length}
        </h2>
        <p className="text-xs text-lt-fg2 mt-0.5">
          Premiums, adjustments and long days. Not errors — just the rows worth
          checking against the paper sheet before you lock.
        </p>
      </div>
      <ul className="divide-y divide-lt-hairline">
        {items.map((e, i) => {
          const look = KIND_LOOK[e.kind] ?? { label: e.kind, bg: 'bg-chip-neutral-bg', fg: 'text-chip-neutral-fg' }
          return (
            <li key={`${e.employee}-${e.date}-${e.kind}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${look.bg} ${look.fg}`}>
                {look.label}
              </span>
              <span className="text-sm text-lt-fg font-medium">{e.employee}</span>
              <span className="text-xs text-lt-fg2">{formatCalendarDate(e.date, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
              <span className="text-xs text-lt-fg2">{e.detail}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
