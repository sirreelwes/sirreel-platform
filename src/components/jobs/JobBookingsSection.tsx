'use client'

/**
 * "Reservations on this job" — every booking the job holds, where each came
 * from, and a way to remove one.
 *
 * Why this exists (Wes 2026-08-26): during the Planyo cutover the same real
 * rental can end up in HQ twice — once entered natively, once brought in by
 * the daily import. The importer keys idempotency on `planyoCartId`, which a
 * native booking does not have, so it is structurally unable to see its own
 * twin and creates a second booking on the same job. Three jobs were in that
 * state when this shipped, two of them from a single overnight import run,
 * each holding two vehicles for a rental that needed one.
 *
 * The job page already listed the reserved UNITS, which is the wrong
 * granularity to fix this at: two cards for two vans look exactly like a
 * genuine two-van rental. Grouped by BOOKING, with its origin named, the
 * duplicate is obvious — and removable.
 *
 * Native is primary through the cutover, so a suspected pair is described
 * from that side: the native booking is the keeper, the Planyo one is what
 * it matches. Nothing is removed automatically; a same-dates,
 * same-category pair is strong evidence but a production really can take
 * two identical vans, and only a human knows which.
 */

import { useCallback, useState } from 'react'

interface Assignment {
  id: string
  status: string
  asset: { id: string; unitName: string } | null
}
interface Item {
  id: string
  category: { id: string; name: string } | null
  assignments: Assignment[]
}
export interface JobBooking {
  id: string
  bookingNumber: string
  status: string
  startDate: string
  endDate: string
  /** Non-null ⇒ created by the Planyo import from that cart. */
  planyoCartId: string | null
  items: Item[]
}

/** Terminal states the rest of the app filters out — shown greyed, not hidden. */
const DEAD = ['CANCELLED', 'ARCHIVED']

const STATUS_TONE: Record<string, string> = {
  REQUEST: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  PENDING_APPROVAL: 'bg-amber-950/40 text-amber-300 border-amber-900/70',
  CONFIRMED: 'bg-emerald-950/40 text-emerald-300 border-emerald-900',
  ACTIVE: 'bg-emerald-950/40 text-emerald-300 border-emerald-900',
  RETURNED: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  CANCELLED: 'bg-zinc-900 text-zinc-500 border-zinc-800',
  ARCHIVED: 'bg-zinc-900 text-zinc-500 border-zinc-800',
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** The categories a booking covers, for pairing. */
function categoryKey(b: JobBooking): string {
  return [...new Set(b.items.map((i) => i.category?.name).filter(Boolean))].sort().join('|')
}

/**
 * Pair each live NATIVE booking with a live PLANYO one describing the same
 * rental: identical dates and the same category set. Deliberately strict —
 * a near-miss should read as two real reservations, not be quietly merged
 * in the operator's head.
 */
export function findPlanyoTwins(bookings: JobBooking[]): Map<string, JobBooking> {
  const live = bookings.filter((b) => !DEAD.includes(b.status))
  const natives = live.filter((b) => !b.planyoCartId)
  const imported = live.filter((b) => b.planyoCartId)
  const pairs = new Map<string, JobBooking>()
  const taken = new Set<string>()
  for (const n of natives) {
    const match = imported.find(
      (p) =>
        !taken.has(p.id) &&
        p.startDate.slice(0, 10) === n.startDate.slice(0, 10) &&
        p.endDate.slice(0, 10) === n.endDate.slice(0, 10) &&
        categoryKey(p) === categoryKey(n) &&
        categoryKey(n) !== '',
    )
    if (match) {
      taken.add(match.id)
      pairs.set(n.id, match)
      pairs.set(match.id, n)
    }
  }
  return pairs
}

export function JobBookingsSection({
  bookings,
  onChanged,
}: {
  bookings: JobBooking[]
  onChanged?: () => void
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const remove = useCallback(
    async (b: JobBooking) => {
      const units = b.items.flatMap((i) => i.assignments.map((a) => a.asset?.unitName)).filter(Boolean)
      const what = units.length ? units.join(', ') : 'its units'
      if (
        !window.confirm(
          `Remove ${b.bookingNumber} from this job?\n\n${what} will be released, and any drivers named on it lose their pickup access.\n\nThe reservation is cancelled, not deleted — it stays in the record.`,
        )
      )
        return
      setBusyId(b.id)
      setErr(null)
      setMsg(null)
      try {
        const res = await fetch(`/api/scheduling/bookings/${b.id}/status`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'cancelled' }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(j.error || `Could not remove it (${res.status})`)
        const drivers = typeof j.driversReleased === 'number' ? j.driversReleased : 0
        setMsg(
          `${b.bookingNumber} removed — ${what} released` +
            (drivers > 0 ? `, ${drivers} driver${drivers === 1 ? '' : 's'} lost access.` : '.'),
        )
        onChanged?.()
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not remove it')
      } finally {
        setBusyId(null)
      }
    },
    [onChanged],
  )

  if (bookings.length === 0) return null
  const twins = findPlanyoTwins(bookings)
  const liveCount = bookings.filter((b) => !DEAD.includes(b.status)).length
  const dupCount = [...twins.keys()].filter((id) =>
    bookings.some((b) => b.id === id && !b.planyoCartId),
  ).length

  return (
    <div className="bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-700/70">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-white flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">
          Reservations
        </h2>
        <span className="text-[12px] text-zinc-300">
          {liveCount} live{bookings.length !== liveCount && ` · ${bookings.length - liveCount} closed`}
        </span>
      </div>

      {dupCount > 0 && (
        <div className="mt-2.5 rounded-xl border border-amber-900/70 bg-amber-950/30 px-3 py-2 text-[12px] text-amber-200">
          <strong className="font-semibold">
            {dupCount === 1 ? 'This job holds the same rental twice.' : `${dupCount} rentals are held twice here.`}
          </strong>{' '}
          A native reservation and a Planyo import cover identical dates and equipment, so the job is
          holding double the vehicles. Keep the native one and remove the import — unless the
          production genuinely takes both.
        </div>
      )}
      {msg && (
        <div className="mt-2.5 rounded-xl border border-emerald-900 bg-emerald-950/30 px-3 py-2 text-[12px] text-emerald-200">{msg}</div>
      )}
      {err && (
        <div className="mt-2.5 rounded-xl border border-rose-900 bg-rose-950/30 px-3 py-2 text-[12px] text-rose-200">{err}</div>
      )}

      <div className="mt-3 space-y-2">
        {bookings.map((b) => {
          const dead = DEAD.includes(b.status)
          const twin = twins.get(b.id)
          const units = b.items.flatMap((i) => i.assignments.map((a) => a.asset?.unitName)).filter(Boolean)
          const cats = [...new Set(b.items.map((i) => i.category?.name).filter(Boolean))]
          return (
            <div
              key={b.id}
              className={`rounded-xl border px-3 py-2.5 ${
                dead
                  ? 'border-zinc-800/60 bg-zinc-900/30 opacity-60'
                  : twin
                    ? 'border-amber-900/60 bg-amber-950/10'
                    : 'border-zinc-800 bg-zinc-800/40'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[12px] text-white">{b.bookingNumber}</span>
                    <span
                      title={
                        b.planyoCartId
                          ? `Imported from Planyo cart ${b.planyoCartId}`
                          : 'Entered in HQ — the system of record through the cutover'
                      }
                      className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                        b.planyoCartId
                          ? 'bg-sky-950/40 text-sky-300 border-sky-900'
                          : 'bg-zinc-800 text-zinc-300 border-zinc-700'
                      }`}
                    >
                      {b.planyoCartId ? 'Planyo' : 'HQ'}
                    </span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                        STATUS_TONE[b.status] ?? 'bg-zinc-800 text-zinc-300 border-zinc-700'
                      }`}
                    >
                      {b.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="mt-1 text-[12px] text-zinc-300 font-mono">
                    {day(b.startDate)} – {day(b.endDate)}
                  </div>
                  <div className="mt-0.5 text-[12px] text-zinc-400 truncate">
                    {cats.join(', ') || 'no equipment'}
                    {units.length > 0 && <span className="text-zinc-500"> · {units.join(', ')}</span>}
                  </div>
                  {twin && !dead && (
                    <div className="mt-1.5 text-[11px] text-amber-300/90">
                      Same dates and equipment as{' '}
                      <span className="font-mono">{twin.bookingNumber}</span>
                      {twin.planyoCartId ? ' (Planyo import)' : ' (entered in HQ)'} — likely the same rental.
                    </div>
                  )}
                </div>
                {!dead && (
                  <button
                    type="button"
                    onClick={() => remove(b)}
                    disabled={busyId != null}
                    title="Cancel this reservation and release its units"
                    className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-[11px] font-semibold text-zinc-400 hover:border-rose-600 hover:text-rose-300 disabled:opacity-40"
                  >
                    {busyId === b.id ? 'Removing…' : 'Remove'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
