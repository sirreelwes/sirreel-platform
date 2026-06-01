'use client'

/**
 * ScheduleViewToggle — Phase 7 consolidation.
 *
 * /calendar and /gantt both read the same /api/timeline-native data
 * (month view vs gantt view of one entity). The nav was collapsed
 * into a single "Schedule" entry (→ /gantt); both pages mount this
 * toggle in the header so operators can flip between views without a
 * second nav tab.
 *
 * Pages stay as separate routes — same low-risk merge as the
 * Inquiries fold. Routes can be consolidated to a single
 * ?view=month|gantt param later if needed; nothing in either page
 * depends on the other's URL today.
 */

import Link from 'next/link'

type View = 'month' | 'gantt'

export function ScheduleViewToggle({ current }: { current: View }) {
  return (
    <div className="inline-flex rounded-md border border-gray-200 overflow-hidden text-xs font-semibold">
      <Link
        href="/gantt"
        className={`px-3 py-1.5 ${
          current === 'gantt'
            ? 'bg-gray-900 text-white'
            : 'bg-white text-gray-600 hover:text-gray-900'
        }`}
      >
        Timeline
      </Link>
      <Link
        href="/calendar"
        className={`px-3 py-1.5 ${
          current === 'month'
            ? 'bg-gray-900 text-white'
            : 'bg-white text-gray-600 hover:text-gray-900'
        }`}
      >
        Month
      </Link>
    </div>
  )
}
