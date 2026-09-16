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
 * A ONE-DAY RENTAL RENDERS ONCE, under Going out, with a "back same
 * day" chip — the same ruling OutBackStrip makes, for the same reason:
 * listed in both buckets it reads as two different units moving.
 *
 * Same source as the gantt (/api/timeline-native), same status tokens,
 * so a bar that is dark red on the desktop board is dark red here.
 * That promise was only half-kept until 2026-09-16: the fetch never
 * read the booking's `stage`, so every row fell back to the BOOKING's
 * own status and a warehouse-order job showed up green. The parse now
 * carries stage, infoGaps and tags — the three things the gantt legend
 * tells you to scan for.
 *
 * Read-only by design: this stage is about seeing the book on a phone,
 * and drag-to-assign is not a gesture that survives the translation.
 * NOT carried over from the gantt: maintenance / Unit N/A bars (a
 * separate axis on the payload, and a unit with nothing booked has no
 * day to sit under here) and the order-attached badge.
 */

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Search, X } from 'lucide-react'
import {
  STATUS_CHIPS,
  CAT_COLORS,
  isBlindBar,
  blindLabel,
  ART_DEPT_TAG_CHIP,
} from '@/lib/scheduling/statusTokens'

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
  /** The job's stage color token (src/lib/jobs/stage.ts). */
  stage?: string
  hasOrder?: boolean
  blindPickup?: boolean
  blindReturn?: boolean
  /** Short nouns for what the reservation is still missing — the gantt's ⚠. */
  gaps?: string[]
  /** Job tags; 'ART_DEPT' wears the yellow chip, same as the board. */
  tags?: string[]
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
  // The phone's answer to the board's search box. Client-side over the
  // fortnight already fetched — no request per keystroke, and the day
  // cards stay the answer rather than turning into a flat result list.
  const [filter, setFilter] = useState('')

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
              // The JOB'S stage, which is the token the gantt bar wears.
              // Dropping it was the drift this file's header warns about.
              stage: typeof b.stage === 'string' ? b.stage : undefined,
              hasOrder: !!b.hasOrder,
              blindPickup: !!b.blindPickup,
              blindReturn: !!b.blindReturn,
              gaps: Array.isArray(b.infoGaps)
                ? (b.infoGaps as Array<{ label?: unknown }>)
                    .map((g) => String(g?.label ?? ''))
                    .filter(Boolean)
                : [],
              tags: Array.isArray(b.tags) ? (b.tags as unknown[]).map(String) : [],
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

  // Unit, job, client, job code and category all answer the box — on a
  // phone you search for whatever you happen to know.
  const q = filter.trim().toLowerCase()
  const visibleRows = useMemo(() => {
    if (!q) return rows
    return rows.filter((r) =>
      [r.unitName, r.jobName, r.clientName, r.jobCode, r.resourceName]
        .some((v) => (v ?? '').toLowerCase().includes(q)),
    )
  }, [rows, q])

  const byDay = useMemo(() => {
    const m = new Map<string, { out: AgendaBooking[]; back: AgendaBooking[]; resting: AgendaBooking[] }>()
    for (const day of days) m.set(day, { out: [], back: [], resting: [] })
    for (const r of visibleRows) {
      for (const day of days) {
        if (r.start === day) m.get(day)!.out.push(r)
        else if (r.end === day) m.get(day)!.back.push(r)
        else if (r.start < day && r.end > day) m.get(day)!.resting.push(r)
      }
    }
    return m
  }, [visibleRows, days])

  // A fortnight of "Nothing moves." cards is a fortnight of scrolling
  // past nothing. Consecutive quiet days collapse to one line, so the
  // days that DO carry something stay within a thumb's reach of each
  // other. A quiet day still names itself — the run says which dates.
  //
  // QUIET = nothing goes out and nothing comes back. Units still on
  // rental across the day do NOT hold a card open: this view lists what
  // MOVES (see the file header), and a card whose whole body is a "show
  // 1 still out" link reads as a rendering bug. The count rides on the
  // quiet line instead, so the fact isn't dropped — and the days that
  // unit left on and returns on are both cards of their own.
  const segments = useMemo(() => {
    const segs: Array<{ kind: 'day'; day: string } | { kind: 'quiet'; days: string[]; resting: number }> = []
    for (const day of days) {
      const d = byDay.get(day)!
      const quiet = d.out.length === 0 && d.back.length === 0
      const last = segs[segs.length - 1]
      if (quiet && last && last.kind === 'quiet') {
        last.days.push(day)
        last.resting = Math.max(last.resting, d.resting.length)
      } else {
        segs.push(quiet ? { kind: 'quiet', days: [day], resting: d.resting.length } : { kind: 'day', day })
      }
    }
    return segs
  }, [days, byDay])

  const moves = useMemo(
    () => days.reduce((n, day) => {
      const d = byDay.get(day)!
      return n + d.out.length + d.back.length
    }, 0),
    [days, byDay],
  )

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

      {/* Find a unit without scrolling a fortnight of cards. */}
      <div className="relative">
        <Search size={14} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setFilter('') }}
          placeholder="Filter unit, job, client…"
          aria-label="Filter the agenda"
          className="w-full min-h-[44px] pl-8 pr-9 rounded-lg border border-gray-200 bg-white text-[13px] text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 [&::-webkit-search-cancel-button]:hidden"
        />
        {filter && (
          <button
            onClick={() => setFilter('')}
            aria-label="Clear the filter"
            className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-gray-400 active:text-gray-700"
          >
            <X size={15} aria-hidden />
          </button>
        )}
      </div>

      <div className="text-[11px] text-gray-400">
        {loading ? 'Loading…' : error ? (
          <span className="text-red-600">{error}</span>
        ) : (
          <>
            {shortDate(from)} – {shortDate(to)}
            <span className="mx-1.5 text-gray-300">·</span>
            {moves === 0
              ? q ? 'nothing matches' : 'nothing moves'
              : `${moves} ${moves === 1 ? 'move' : 'moves'}`}
            {q && rows.length > 0 && (
              <span className="ml-1.5 text-gray-400">
                (filtered from {rows.length})
              </span>
            )}
          </>
        )}
      </div>

      {segments.map((seg) => {
        if (seg.kind === 'quiet') {
          const first = seg.days[0]
          const last = seg.days[seg.days.length - 1]
          return (
            <div
              key={`quiet-${first}`}
              className="flex items-center gap-2 px-1 text-[11px] text-gray-400"
            >
              <span className="h-px flex-1 bg-gray-200" />
              <span className="whitespace-nowrap">
                {q ? 'Nothing matches' : 'Nothing moves'}{' '}
                {seg.days.length === 1 ? shortDate(first) : `${shortDate(first)} – ${shortDate(last)}`}
                {seg.resting > 0 && (
                  <span className="text-gray-400"> · {seg.resting} still out</span>
                )}
              </span>
              <span className="h-px flex-1 bg-gray-200" />
            </div>
          )
        }

        const day = seg.day
        const d = byDay.get(day)!
        const isToday = day === today
        // A day already gone reads as reference, not as plan — the
        // anchor steps backwards a week at a time, so past days are
        // routinely on screen.
        const isPast = day < today
        return (
          <section
            key={day}
            className={`rounded-xl border bg-white overflow-hidden ${
              isToday ? 'border-amber-400 ring-1 ring-amber-200' : 'border-gray-200'
            } ${isPast ? 'opacity-60' : ''}`}
          >
            <header
              className={`px-3 py-2 flex items-baseline gap-2 border-b ${
                isToday ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'
              }`}
            >
              <h3 className={`text-[13px] font-bold ${isToday ? 'text-amber-900' : 'text-gray-800'}`}>
                {dayLabel(day, today)}
              </h3>
              <span className="ml-auto text-[10px] font-semibold text-gray-400 tabular-nums">
                {d.out.length > 0 && <span className="text-indigo-600">{d.out.length} out</span>}
                {d.out.length > 0 && d.back.length > 0 && ' · '}
                {d.back.length > 0 && <span className="text-orange-600">{d.back.length} back</span>}
              </span>
            </header>

            <div className="divide-y divide-gray-100">
              {d.out.map((r, i) => <AgendaRow key={`o${i}`} r={r} direction="out" />)}
              {d.back.map((r, i) => <AgendaRow key={`b${i}`} r={r} direction="back" />)}
              {d.resting.length > 0 && (
                // The button carries the 44px tap target itself; the
                // wrapper's own padding stacked on top of it and left a
                // visibly dead strip at the foot of every card.
                <div className="px-3">
                  <button
                    onClick={() => setShowResting((s) => ({ ...s, [day]: !s[day] }))}
                    className="w-full text-left text-[11px] text-gray-500 underline underline-offset-2 min-h-[44px] flex items-center"
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
  // Same precedence the gantt bars use — a blind pickup or return shouts
  // over every live stage (isBlindBar).
  // `stage` is the JOB'S color token (src/lib/jobs/stage.ts) — the same
  // one the gantt bar and the /jobs tile rail wear.
  const stage = r.stage ?? r.status
  const blind = isBlindBar(stage, r) ? blindLabel(r) : null
  const chip = blind
    ? 'bg-violet-100 text-violet-800 border border-violet-200'
    : STATUS_CHIPS[stage] ?? STATUS_CHIPS.booked
  const statusLabel = blind
    ? blind.toLowerCase()
    : stage === 'order'
      ? 'warehouse order'
      : stage
  // Out and back on the same date. Listed under Going out only (see the
  // file header), so the chip is the only thing that says it returns.
  const sameDay = direction === 'out' && r.start === r.end
  const gaps = r.gaps ?? []

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
          {(r.tags ?? []).includes('ART_DEPT') && (
            <span className={`flex-shrink-0 px-1 rounded-sm text-[8px] font-bold ${ART_DEPT_TAG_CHIP}`}>
              ART
            </span>
          )}
          <span className="ml-auto text-[10px] text-gray-400 tabular-nums whitespace-nowrap">
            {shortDate(r.start)} → {shortDate(r.end)}
          </span>
        </div>
        <div className="text-[12px] text-gray-700 truncate">{r.jobName || 'Unnamed job'}</div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span className="text-[11px] text-gray-500 truncate">{r.clientName || 'no company'}</span>
          <span className="ml-auto flex items-center gap-1.5">
            {sameDay && (
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded whitespace-nowrap bg-orange-50 text-orange-700 border border-orange-200">
                back same day
              </span>
            )}
            {gaps.length > 0 && (
              // chip-warn, NOT amber: `amber-*` is the Utliiz turquoise
              // since the 2026-09-06 remap, and tailwind.config.ts says
              // in as many words that status yellows live here so
              // warnings stay warm. One gap names itself; more than one
              // counts, because three nouns is wider than the row.
              <span
                title={`Missing: ${gaps.join(', ')} — open the job to finish it`}
                className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded whitespace-nowrap bg-chip-warn-bg text-chip-warn-fg"
              >
                <AlertTriangle size={9} aria-hidden />
                {gaps.length === 1 ? gaps[0] : `${gaps.length} missing`}
              </span>
            )}
            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded whitespace-nowrap ${chip}`}>
              {statusLabel}
            </span>
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
