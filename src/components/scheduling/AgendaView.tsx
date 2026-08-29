'use client'

/**
 * Agenda — the reservations book on a phone.
 *
 * The gantt is a two-axis grid: units down, days across. There is no
 * honest way to squeeze it onto 390px — every attempt either drops the
 * unit axis (and then it isn't a gantt) or shrinks a day to four
 * pixels. So the phone gets a different READING of the same data
 * rather than a squashed copy of the same picture: one day at a time,
 * down the page.
 *
 * WHAT A DAY SHOWS. Not "every reservation overlapping this date" — on
 * a busy week that is forty rows of things that are simply still out,
 * and the two facts anyone actually opens this for get buried. A day
 * lists what MOVES: units going out (the reservation starts) and units
 * coming back (it ends), in the house Out/Back vocabulary the /jobs
 * landing and the Out/Back strip already use. Everything still on
 * rental across the day collapses to one counted line you can expand.
 *
 * Same source as the gantt (/api/timeline-native), same status tokens,
 * so a bar that is dark red on the desktop board is dark red here.
 * Read-only by design: this stage is about seeing the book on a phone,
 * and drag-to-assign is not a gesture that survives the translation.
 */

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { STATUS_CHIPS, CAT_COLORS } from '@/lib/scheduling/statusTokens'

interface AgendaBooking {
  unitName: string
  cat: string
  resourceName: string
  jobName: string | null
  jobId: string | null
  jobCode: string | null
  clientName: string | null
  cartId: string | null
  bookingId: string | null
  start: string
  end: string
  status: string
  hasOrder?: boolean
  blindPickup?: boolean
}

const DAY_MS = 86_400_000

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(ymdStr: string, n: number): string {
  const d = new Date(`${ymdStr}T12:00:00`)
  return ymd(new Date(d.getTime() + n * DAY_MS))
}

function dayLabel(ymdStr: string, today: string): string {
  const d = new Date(`${ymdStr}T12:00:00`)
  const base = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  if (ymdStr === today) return `Today · ${base}`
  if (ymdStr === addDays(today, 1)) return `Tomorrow · ${base}`
  return base
}

function shortDate(ymdStr: string): string {
  const d = new Date(`${ymdStr}T12:00:00`)
  return d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })
}

/** How many days of agenda one screen-load covers. */
const WINDOW_DAYS = 14

export function AgendaView() {
  const today = useMemo(() => ymd(new Date()), [])
  const [anchor, setAnchor] = useState(today)
  const [rows, setRows] = useState<AgendaBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showResting, setShowResting] = useState<Record<string, boolean>>({})

  const from = anchor
  const to = addDays(anchor, WINDOW_DAYS - 1)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    fetch(`/api/timeline-native?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((d) => {
        if (!active) return
        if (!d?.ok) { setError('Could not load the schedule'); return }
        const out: AgendaBooking[] = []
        for (const u of (d.units ?? []) as Array<Record<string, unknown>>) {
          for (const b of (u.bookings ?? []) as Array<Record<string, unknown>>) {
            if (!b || typeof b.start !== 'string' || typeof b.end !== 'string') continue
            out.push({
              unitName: String(u.unitName ?? '—'),
              cat: String(u.cat ?? 'general'),
              resourceName: String(u.resourceName ?? ''),
              jobName: (b.jobName as string) ?? null,
              jobId: (b.jobId as string) ?? null,
              jobCode: (b.jobCode as string) ?? null,
              clientName: (b.clientName as string) ?? null,
              cartId: (b.cartId as string) ?? null,
              bookingId: (b.bookingId as string) ?? null,
              start: b.start,
              end: b.end,
              status: String(b.status ?? 'booked'),
              hasOrder: !!b.hasOrder,
              blindPickup: !!b.blindPickup,
            })
          }
        }
        setRows(out)
      })
      .catch(() => { if (active) setError('Could not load the schedule') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [from, to])

  const days = useMemo(() => Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(anchor, i)), [anchor])

  const byDay = useMemo(() => {
    const m = new Map<string, { out: AgendaBooking[]; back: AgendaBooking[]; resting: AgendaBooking[] }>()
    for (const day of days) m.set(day, { out: [], back: [], resting: [] })
    for (const r of rows) {
      for (const day of days) {
        if (r.start === day) m.get(day)!.out.push(r)
        else if (r.end === day) m.get(day)!.back.push(r)
        else if (r.start < day && r.end > day) m.get(day)!.resting.push(r)
      }
    }
    return m
  }, [rows, days])

  return (
    <div className="space-y-3">
      {/* Date navigation. A fortnight at a time, because that is the
          horizon anyone plans on from a phone; the desktop gantt is
          still where you look at a quarter. */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setAnchor(addDays(anchor, -7))}
          aria-label="Previous week"
          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 text-lg active:bg-gray-100"
        >
          ‹
        </button>
        <button
          onClick={() => setAnchor(today)}
          className="min-h-[44px] px-3 rounded-lg border border-gray-200 bg-white text-[13px] font-semibold text-gray-700 active:bg-gray-100"
        >
          Today
        </button>
        <button
          onClick={() => setAnchor(addDays(anchor, 7))}
          aria-label="Next week"
          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 text-lg active:bg-gray-100"
        >
          ›
        </button>
        <input
          type="date"
          value={anchor}
          onChange={(e) => { if (e.target.value) setAnchor(e.target.value) }}
          aria-label="Jump to date"
          className="ml-auto min-h-[44px] px-2 rounded-lg border border-gray-200 bg-white text-[13px] text-gray-700"
        />
      </div>

      <div className="text-[11px] text-gray-400">
        {loading ? 'Loading…' : error ? <span className="text-red-600">{error}</span> : `${shortDate(from)} – ${shortDate(to)}`}
      </div>

      {days.map((day) => {
        const d = byDay.get(day)!
        const isToday = day === today
        const empty = d.out.length === 0 && d.back.length === 0 && d.resting.length === 0
        return (
          <section
            key={day}
            className={`rounded-xl border bg-white overflow-hidden ${
              isToday ? 'border-amber-400 ring-1 ring-amber-200' : 'border-gray-200'
            }`}
          >
            <header
              className={`px-3 py-2 flex items-baseline gap-2 border-b ${
                isToday ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'
              }`}
            >
              <h3 className={`text-[13px] font-bold ${isToday ? 'text-amber-900' : 'text-gray-800'}`}>
                {dayLabel(day, today)}
              </h3>
              {!empty && (
                <span className="ml-auto text-[10px] font-semibold text-gray-400 tabular-nums">
                  {d.out.length > 0 && <span className="text-indigo-600">{d.out.length} out</span>}
                  {d.out.length > 0 && d.back.length > 0 && ' · '}
                  {d.back.length > 0 && <span className="text-orange-600">{d.back.length} back</span>}
                </span>
              )}
            </header>

            {empty ? (
              <div className="px-3 py-3 text-[11px] text-gray-400">Nothing moves.</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {d.out.map((r, i) => <AgendaRow key={`o${i}`} r={r} direction="out" />)}
                {d.back.map((r, i) => <AgendaRow key={`b${i}`} r={r} direction="back" />)}
                {d.resting.length > 0 && (
                  <div className="px-3 py-2">
                    <button
                      onClick={() => setShowResting((s) => ({ ...s, [day]: !s[day] }))}
                      className="text-[11px] text-gray-500 underline underline-offset-2 min-h-[44px] flex items-center"
                    >
                      {showResting[day] ? 'Hide' : 'Show'} {d.resting.length} still out
                    </button>
                    {showResting[day] && (
                      <div className="-mx-3 border-t border-gray-100 divide-y divide-gray-100">
                        {d.resting.map((r, i) => <AgendaRow key={`r${i}`} r={r} direction="resting" />)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

const DIRECTION_META = {
  out:     { glyph: '▲', label: 'Out',  cls: 'text-indigo-600' },
  back:    { glyph: '▼', label: 'Back', cls: 'text-orange-600' },
  resting: { glyph: '•', label: 'On rental', cls: 'text-emerald-600' },
} as const

function AgendaRow({ r, direction }: { r: AgendaBooking; direction: keyof typeof DIRECTION_META }) {
  const meta = DIRECTION_META[direction]
  // Same precedence the gantt bars use — blind pickup shouts over
  // order-attached, which shouts over plain booked.
  const chip = r.blindPickup
    ? 'bg-violet-100 text-violet-800 border border-violet-200'
    : r.status === 'booked' && r.hasOrder
      ? 'bg-[#b04a5a]/10 text-[#93394a] border border-[#b04a5a]/30'
      : STATUS_CHIPS[r.status] ?? STATUS_CHIPS.booked
  const statusLabel = r.blindPickup
    ? 'blind pickup'
    : r.status === 'booked' && r.hasOrder
      ? 'order attached'
      : r.status

  const body = (
    <div className="flex items-start gap-2 px-3 py-2.5 min-h-[44px]">
      <span className={`text-[11px] font-bold ${meta.cls} mt-0.5 w-3 flex-shrink-0`} title={meta.label}>
        {meta.glyph}
      </span>
      <span
        className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
        style={{ background: CAT_COLORS[r.cat] ?? CAT_COLORS.general }}
        title={r.resourceName}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[13px] font-bold text-gray-900 truncate">{r.unitName}</span>
          <span className="ml-auto text-[10px] text-gray-400 tabular-nums whitespace-nowrap">
            {shortDate(r.start)} → {shortDate(r.end)}
          </span>
        </div>
        <div className="text-[12px] text-gray-700 truncate">{r.jobName || 'Unnamed job'}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[11px] text-gray-500 truncate">{r.clientName || 'no company'}</span>
          <span className={`ml-auto text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded whitespace-nowrap ${chip}`}>
            {statusLabel}
          </span>
        </div>
      </div>
    </div>
  )

  return r.jobId ? (
    <Link href={`/jobs/${r.jobId}`} className="block active:bg-gray-50">
      {body}
    </Link>
  ) : (
    body
  )
}
