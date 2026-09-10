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
 * ORIGIN-AGNOSTIC since 2026-09-10 (Wes). Two assumptions in the first
 * version stopped being true:
 *
 *   · Only a native-vs-import pair counts. Lego Playball (SR-JOB-0332)
 *     was held twice by TWO Planyo carts — the client booked again under
 *     a second contact — and the detector had nothing to say about it.
 *   · A booking with a cart id is an import. The importer ADOPTS a cart
 *     onto a matching native booking rather than duplicating it
 *     (lib/sync/planyo/adoptNativeBooking), so the native SR-Q row ends
 *     up carrying a cart id too. That made the native invisible AS a
 *     native — it read "Planyo" on the row and counted as an import in
 *     the pairing, which is why SR-JOB-0332 showed two Planyo chips and
 *     no warning.
 *
 * So: any two LIVE bookings on the job covering the same dates with the
 * same equipment are a suspected duplicate, whatever raised them.
 * `Booking.source` — not the cart id — is what names an origin now.
 *
 * Nothing is removed automatically; a same-dates, same-category pair is
 * strong evidence but a production really can take two identical vans,
 * and only a human knows which.
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
  /**
   * The cart this booking is LINKED to — set by the import for a booking
   * it created, and also by adoption for a native booking it recognised.
   * So it answers "which Planyo cart is this?", never "who made this?".
   */
  planyoCartId: string | null
  /** Booking.source — PLANYO_BACKFILL, AGENT_DIRECT, … The origin. */
  source?: string | null
  items: Item[]
}

/** Did the Planyo import create this booking, or did HQ? */
export function isPlanyoOrigin(b: JobBooking): boolean {
  // source is authoritative; fall back to the cart id for a payload that
  // predates it (adoption makes that fallback imprecise, never wrong for
  // rows the importer actually created).
  if (b.source) return b.source === 'PLANYO_BACKFILL'
  return Boolean(b.planyoCartId)
}

/** Terminal states the rest of the app filters out — shown greyed, not hidden. */
const DEAD = ['CANCELLED', 'ARCHIVED']

const STATUS_TONE: Record<string, string> = {
  REQUEST: 'bg-zinc-100 text-zinc-700 border-zinc-300',
  PENDING_APPROVAL: 'bg-amber-50 text-amber-700 border-amber-200',
  CONFIRMED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  RETURNED: 'bg-zinc-100 text-zinc-600 border-zinc-300',
  CANCELLED: 'bg-white text-zinc-600 border-zinc-200',
  ARCHIVED: 'bg-white text-zinc-600 border-zinc-200',
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** The categories a booking covers, for pairing. */
function categoryKey(b: JobBooking): string {
  return [...new Set(b.items.map((i) => i.category?.name).filter(Boolean))].sort().join('|')
}

/** The window + equipment two bookings must share to be suspected twins. */
function twinKey(b: JobBooking): string | null {
  const cats = categoryKey(b)
  if (cats === '') return null // no equipment — nothing to compare
  return `${b.startDate.slice(0, 10)}|${b.endDate.slice(0, 10)}|${cats}`
}

/**
 * Group the job's LIVE bookings by identical window + equipment.
 * Deliberately strict — a near-miss should read as two real
 * reservations, not be quietly merged in the operator's head.
 *
 * Returns id → the OTHER booking it duplicates. In a group the KEEPER is
 * the first HQ-native row (the system of record through the cutover),
 * falling back to the first row given; every other member points at it,
 * and it points back at the first of them. A group of three trucks for
 * one rental therefore surfaces as one warning, not three.
 */
export function findDuplicateGroups(bookings: JobBooking[]): JobBooking[][] {
  const live = bookings.filter((b) => !DEAD.includes(b.status))
  const byKey = new Map<string, JobBooking[]>()
  for (const b of live) {
    const key = twinKey(b)
    if (!key) continue
    const g = byKey.get(key)
    if (g) g.push(b)
    else byKey.set(key, [b])
  }
  return [...byKey.values()].filter((g) => g.length > 1)
}

/** id → the other booking it duplicates. One entry per member of a group. */
export function findDuplicateHolds(bookings: JobBooking[]): Map<string, JobBooking> {
  const pairs = new Map<string, JobBooking>()
  for (const group of findDuplicateGroups(bookings)) {
    const keeper = group.find((b) => !isPlanyoOrigin(b)) ?? group[0]
    const others = group.filter((b) => b.id !== keeper.id)
    pairs.set(keeper.id, others[0])
    for (const o of others) pairs.set(o.id, keeper)
  }
  return pairs
}

/** @deprecated name kept for callers/tests that predate the widening. */
export const findPlanyoTwins = findDuplicateHolds

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
  const twins = findDuplicateHolds(bookings)
  const liveCount = bookings.filter((b) => !DEAD.includes(b.status)).length
  // One warning per RENTAL held twice, not per booking involved.
  const dupCount = findDuplicateGroups(bookings).length

  return (
    <div className="bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-400">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-zinc-900 flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">
          Reservations
        </h2>
        <span className="text-[12px] text-zinc-700">
          {liveCount} live{bookings.length !== liveCount && ` · ${bookings.length - liveCount} closed`}
        </span>
      </div>

      {dupCount > 0 && (
        <div className="mt-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          <strong className="font-semibold">
            {dupCount === 1 ? 'This job holds the same rental twice.' : `${dupCount} rentals are held twice here.`}
          </strong>{' '}
          Two reservations cover identical dates and equipment, so the job is holding double the
          vehicles. Keep one and remove the other — unless the production genuinely takes both.
        </div>
      )}
      {msg && (
        <div className="mt-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">{msg}</div>
      )}
      {err && (
        <div className="mt-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">{err}</div>
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
                  ? 'border-zinc-200 bg-zinc-100 opacity-60'
                  : twin
                    ? 'border-amber-200 bg-amber-50'
                    : 'border-zinc-200 bg-zinc-50'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[12px] text-zinc-900">{b.bookingNumber}</span>
                    <span
                      title={
                        isPlanyoOrigin(b)
                          ? `Imported from Planyo cart ${b.planyoCartId}`
                          : b.planyoCartId
                            ? `Entered in HQ — the system of record through the cutover. Linked to Planyo cart ${b.planyoCartId}, which the import matched to this booking instead of duplicating it.`
                            : 'Entered in HQ — the system of record through the cutover'
                      }
                      className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                        isPlanyoOrigin(b)
                          ? 'bg-sky-50 text-sky-700 border-sky-200'
                          : 'bg-zinc-100 text-zinc-700 border-zinc-300'
                      }`}
                    >
                      {/* An ADOPTED native carries a cart id but is still HQ's
                          row — labelling it "Planyo" hid the one native on the
                          job behind a chip that said otherwise. */}
                      {isPlanyoOrigin(b) ? 'Planyo' : b.planyoCartId ? 'HQ · cart' : 'HQ'}
                    </span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                        STATUS_TONE[b.status] ?? 'bg-zinc-100 text-zinc-700 border-zinc-300'
                      }`}
                    >
                      {b.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="mt-1 text-[12px] text-zinc-700 font-mono">
                    {day(b.startDate)} – {day(b.endDate)}
                  </div>
                  <div className="mt-0.5 text-[12px] text-zinc-600 truncate">
                    {cats.join(', ') || 'no equipment'}
                    {units.length > 0 && <span className="text-zinc-600"> · {units.join(', ')}</span>}
                  </div>
                  {twin && !dead && (
                    <div className="mt-1.5 text-[11px] text-amber-700">
                      Same dates and equipment as{' '}
                      <span className="font-mono">{twin.bookingNumber}</span>
                      {isPlanyoOrigin(twin) ? ' (Planyo import)' : ' (entered in HQ)'} — likely the same rental.
                    </div>
                  )}
                </div>
                {!dead && (
                  <button
                    type="button"
                    onClick={() => remove(b)}
                    disabled={busyId != null}
                    title="Cancel this reservation and release its units"
                    className="shrink-0 rounded border border-zinc-300 px-2 py-1 text-[11px] font-semibold text-zinc-600 hover:border-rose-600 hover:text-rose-700 disabled:opacity-40"
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
