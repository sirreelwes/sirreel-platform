'use client'

/**
 * /gantt — the reservations book, in whichever form the screen can
 * honestly carry.
 *
 * DESKTOP gets the gantt: units down, days across, drag to assign.
 * PHONE gets the agenda (components/scheduling/AgendaView) — the same
 * /api/timeline-native data read one day at a time. The gantt is NOT
 * shrunk down to a phone: a two-axis grid at 390px either loses the
 * unit axis or renders a day four pixels wide, and a schedule you can
 * misread is worse than one you have to open a laptop for.
 *
 * The board is picked by a media query rather than a CSS `hidden`,
 * because the gantt is a 6k-line client tree that fetches the full
 * window and computes lane layout on mount; rendering it invisibly
 * behind a phone would cost the whole thing for nothing.
 *
 * `?view=timeline` is the escape hatch — a phone can still force the
 * gantt (pinch-zoom works, it just isn't the default), and the mobile
 * notice links to it both ways.
 */

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { GanttBoard } from '@/components/schedule/GanttBoard'
import { AgendaView } from '@/components/scheduling/AgendaView'
import { ScheduleViewToggle } from '@/components/schedule/ScheduleViewToggle'

/** True while the viewport is below Tailwind's `md`. */
function useIsNarrow(): boolean | null {
  // null until measured, so nothing renders on the server that the
  // client then throws away.
  const [narrow, setNarrow] = useState<boolean | null>(null)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const sync = () => setNarrow(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return narrow
}

function ScheduleSurface() {
  const narrow = useIsNarrow()
  const searchParams = useSearchParams()
  const forced = searchParams?.get('view')

  if (narrow === null) {
    return <div className="p-6 text-sm text-gray-400">Loading…</div>
  }

  const showAgenda = forced === 'agenda' || (narrow && forced !== 'timeline')

  if (!showAgenda) {
    return (
      <>
        {narrow && (
          <div className="md:hidden mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5">
            <div className="text-[12px] font-bold text-amber-900">Best viewed on desktop</div>
            <p className="text-[11px] text-amber-800 mt-0.5">
              The timeline is a units × days grid — it needs the width. Pinch to zoom, or
              read the same reservations as a day-by-day list.
            </p>
            <Link
              href="/gantt?view=agenda"
              className="inline-flex items-center mt-1.5 min-h-[44px] text-[12px] font-bold text-amber-900 underline underline-offset-2"
            >
              Open the agenda →
            </Link>
          </div>
        )}
        <GanttBoard />
      </>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <header className="mb-3 flex items-start justify-between gap-2 flex-wrap">
        <div>
        <h1 className="text-xl font-semibold text-gray-900">Agenda</h1>
        <p className="text-[12px] text-gray-500 mt-0.5">
          What goes out and what comes back, day by day.{' '}
          <Link href="/gantt?view=timeline" className="underline underline-offset-2 text-gray-700">
            Timeline view
          </Link>{' '}
          <span className="text-gray-400">(best on desktop)</span>
        </p>
        </div>
        <ScheduleViewToggle current="agenda" />
      </header>
      <AgendaView />
    </div>
  )
}

export default function SchedulePage() {
  // useSearchParams needs a Suspense boundary for static prerendering.
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-400">Loading…</div>}>
      <ScheduleSurface />
    </Suspense>
  )
}
