'use client'

/**
 * /gantt — the reservations book, in whichever form the screen can
 * honestly carry.
 *
 * DESKTOP gets the gantt: units down, days across, drag to assign.
 * PHONE opens on the agenda (components/scheduling/AgendaView) — the
 * same /api/timeline-native data read one day at a time.
 *
 * `?view=timeline` is the escape hatch, and as of 2026-09-16 it is a
 * REAL one rather than a pinch-zoom apology. The old note here said a
 * two-axis grid at 390px must either lose the unit axis or draw a
 * four-pixel day; that was true of a 7-day span against a 192px label
 * column. Below `md` the board now opens at THREE days against a 112px
 * label column — ~85px a day, enough for a client name. Wes: "I like 3
 * day view but default to agenda is fine as long as I can select
 * timeline 3d view in portrait mode."
 *
 * The surface is still picked by a media query rather than a CSS
 * `hidden`, because the gantt is a 6k-line client tree that fetches the
 * full window and computes lane layout on mount; rendering it invisibly
 * behind a phone would cost the whole thing for nothing.
 */

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AssignUnitsModal } from '@/components/scheduling/AssignUnitsModal'
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

  // /gantt?assign=<bookingItemId> while the AGENDA is showing. The
  // timeline board consumes this param itself, but the agenda never
  // mounts it, so the picker never opened and the link read as a dead
  // end (Wes 2026-09-05, trying to put Cube 29 on a hold from his
  // phone). Read once, strip, and open the same picker here.
  const [agendaAssign, setAgendaAssign] = useState<string | null>(null)
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const assign = sp.get('assign')
    if (assign && /^[A-Za-z0-9_-]{6,64}$/.test(assign)) {
      const view = sp.get('view')
      const isNarrow = window.matchMedia('(max-width: 767px)').matches
      const agenda = view === 'agenda' || (isNarrow && view !== 'timeline')
      if (agenda) {
        setAgendaAssign(assign)
        sp.delete('assign')
        const qs = sp.toString()
        window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
      }
    }
  }, [])

  if (narrow === null) {
    return <div className="p-6 text-sm text-gray-400">Loading…</div>
  }

  const showAgenda = forced === 'agenda' || (narrow && forced !== 'timeline')

  // No "best viewed on desktop" notice any more: below `md` the board
  // opens at three days and fits the screen, so the old banner would be
  // telling the operator a problem that has been fixed. Getting here on
  // a phone is a deliberate tap on Timeline, and the same toggle at the
  // top of the board is the way back.
  if (!showAgenda) {
    return <GanttBoard />
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* One line, not three: the explanation wrapped to most of a
          thumb's worth of screen above the first day card, every visit
          (Wes 2026-09-16 on the board's legend — same complaint). */}
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-gray-900 leading-none">Agenda</h1>
          <p className="text-[11px] text-gray-500 mt-1">Out and back, day by day</p>
        </div>
        <ScheduleViewToggle current="agenda" />
      </header>
      <AgendaView />
      {agendaAssign && (
        <AssignUnitsModal
          bookingItemId={agendaAssign}
          bufferDays={1}
          onClose={() => setAgendaAssign(null)}
        />
      )}
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
