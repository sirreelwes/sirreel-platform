'use client'

/**
 * Check out / Check in as two tabs instead of two stacked lanes.
 *
 * Oliver, 2026-09-08, after talking it through with Hugo: "can they have
 * the option to view either check in or check out? Maybe a toggle at the
 * top of the page, that way they're separate." Both lanes run the same
 * shape of row, so a supervisor scanning for the trucks that still owe a
 * report was reading one continuous list and holding the boundary in
 * their head.
 *
 * Both lanes are still rendered on the SERVER and passed in as nodes —
 * this component only decides which one is on screen. So switching costs
 * nothing, no data is re-fetched, and the rows stay server components.
 *
 * The counts on the tabs are the outstanding ones, not the totals: the
 * number a supervisor is deciding between is "how much work is left at
 * this end", not how many trucks move today.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'

export type CheckEdgeTab = 'out' | 'back'

export function CheckEdgeTabs({
  out, back, outDue, backDue, initial = 'out',
}: {
  out: ReactNode
  back: ReactNode
  /** Rows at this end with no report filed yet. */
  outDue: number
  backDue: number
  initial?: CheckEdgeTab
}) {
  const [tab, setTab] = useState<CheckEdgeTab>(initial)

  const tabs: Array<{ id: CheckEdgeTab; label: string; due: number }> = [
    { id: 'out', label: 'Check out', due: outDue },
    { id: 'back', label: 'Check in', due: backDue },
  ]

  return (
    <>
      <div
        role="tablist"
        aria-label="Check out or check in"
        className="flex items-center gap-1 mb-5 p-1 bg-lt-inner border border-lt-hairline rounded-xl"
      >
        {tabs.map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={`flex-1 min-h-[44px] px-3 rounded-lg text-[15px] font-semibold inline-flex items-center justify-center gap-2 transition-colors ${
                active
                  ? 'bg-amber-600 text-white'
                  : 'text-lt-fg2 hover:text-lt-fg hover:bg-lt-card'
              }`}
            >
              {t.label}
              {/* The count is the point of the tab you are NOT on — it is
                  how you know there is work waiting on the other side. */}
              {t.due > 0 && (
                <span
                  className={`text-[12px] font-bold rounded-full px-1.5 py-0.5 ${
                    active ? 'bg-white/25 text-white' : 'bg-chip-warn-bg text-chip-warn-fg'
                  }`}
                >
                  {t.due}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Both stay mounted — switching back should not re-render a long
          list, and `hidden` keeps the inactive one out of the a11y tree. */}
      <div hidden={tab !== 'out'}>{out}</div>
      <div hidden={tab !== 'back'}>{back}</div>
    </>
  )
}
