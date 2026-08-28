'use client'

/**
 * "Out / Back" — the three-day answer to the only question fleet and
 * warehouse ask the board: what leaves, what comes home.
 *
 * Wes 2026-08-23: post-cutover everyone lives on Reservations, so the
 * ins-and-outs belong here rather than one tab away. Reads the same
 * /api/dispatch feed as the Deliveries & Pickups board (now driven by
 * BookingAssignment, so reservation-only movements count), and links
 * to that board for the full picture with its overdue bands.
 *
 * Deliberately small: counts first, a few rows, collapsed by default
 * on a quiet day. It is a glance, not a second board.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

interface Card {
  cardId: string
  source?: 'order' | 'reservation'
  assetUnitName: string | null
  categoryName: string | null
  companyName: string
  jobName: string | null
  jobId?: string | null
  orderId: string | null
  // Reservation cards: the booking's attached HQ Order — the vehicle
  // is moving with billable equipment on it (see /api/dispatch).
  attachedOrderId?: string | null
  attachedOrderNumber?: string | null
  effectivePickupDate: string
  effectiveReturnDate: string
}

interface Day {
  date: string
  label: string
  outboundFleet: Card[]
  outboundWarehouse: Card[]
  inbound: Card[]
}

interface Payload {
  days: Day[]
  overdue: { lateToShip: Card[]; lateToReturn: Card[]; staleUnreturned?: number }
}

const HORIZON_DAYS = 3

function cardHref(c: Card): string {
  if (c.orderId) return `/orders/${c.orderId}`
  // Order-attached reservation → the order is where the equipment
  // check-in lives (same convention as the scheduler's red state).
  if (c.attachedOrderId) return `/orders/${c.attachedOrderId}`
  if (c.jobId) return `/jobs/${c.jobId}`
  return '/dispatch'
}

function Row({ c, edge }: { c: Card; edge: 'out' | 'back' }) {
  const sameDay = c.effectivePickupDate === c.effectiveReturnDate
  return (
    <Link
      href={cardHref(c)}
      className="flex items-baseline gap-2 px-2 py-1 rounded hover:bg-gray-50 group"
      title={`${c.companyName}${c.jobName ? ` · ${c.jobName}` : ''}`}
    >
      <span className="text-[11px] font-bold text-gray-900 w-[72px] flex-none truncate">
        {c.assetUnitName || c.categoryName || 'Unit'}
      </span>
      <span className="text-[11px] text-gray-500 truncate group-hover:text-gray-700">
        {c.companyName}
        {c.jobName ? ` · ${c.jobName}` : ''}
      </span>
      {/* Order attached to a reservation movement: the vehicle carries
          billable equipment, so the return is a check-in, not just
          parking a truck. Click opens the order. Order-sourced cards
          skip the chip — being an order is their whole identity. */}
      {c.source === 'reservation' && c.attachedOrderId && (
        <span
          className="flex-none text-[9px] font-bold uppercase tracking-wide px-1 py-px rounded bg-violet-50 text-violet-700 border border-violet-200"
          title={`Order ${c.attachedOrderNumber ?? ''} attached — equipment on board`}
        >
          order
        </span>
      )}
      {/* One-day rental: it leaves AND comes home on this date. Shown
          once (Going out) with this chip instead of echoing the same
          job into Coming back (Wes 2026-08-28 — the two columns read
          as duplicates). */}
      {edge === 'out' && sameDay && (
        <span className="flex-none text-[9px] font-bold uppercase tracking-wide px-1 py-px rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
          back same day
        </span>
      )}
      <span className="ml-auto flex-none text-[10px] text-gray-400 tabular-nums">
        {(edge === 'out' ? c.effectivePickupDate : c.effectiveReturnDate).slice(5)}
      </span>
    </Link>
  )
}

export default function OutBackStrip() {
  const [data, setData] = useState<Payload | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(() => {
    fetch(`/api/dispatch?days=${HORIZON_DAYS}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => setData(null))
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 120_000)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  if (!data) return null

  const going = data.days.flatMap((d) => [...d.outboundFleet, ...d.outboundWarehouse])
  // One-day rentals appear in BOTH dispatch buckets (they truthfully go
  // out and come back inside the window), which made the two columns
  // read as duplicates. They render once, under Going out, with a
  // "back same day" chip — Coming back keeps only units actually out
  // on the road or returning from earlier trips.
  const sameDayIds = new Set(
    going.filter((c) => c.effectivePickupDate === c.effectiveReturnDate).map((c) => c.cardId),
  )
  const coming = data.days.flatMap((d) => d.inbound).filter((c) => !sameDayIds.has(c.cardId))
  const lateBack = data.overdue?.lateToReturn?.length ?? 0
  const lateOut = data.overdue?.lateToShip?.length ?? 0

  // Nothing moving and nothing late — stay out of the way entirely.
  if (going.length === 0 && coming.length === 0 && lateBack === 0 && lateOut === 0) return null

  return (
    <div className="mb-2 border border-gray-200 rounded-lg bg-white">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-3 py-1.5 text-left hover:bg-gray-50 rounded-lg"
      >
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Next 3 days</span>
        <span className="text-[11px] font-semibold text-gray-700">
          <span className="text-amber-700">{going.length}</span> going out
          <span className="text-gray-300 mx-1.5">·</span>
          <span className="text-emerald-700">{coming.length}</span> coming back
        </span>
        {(lateOut > 0 || lateBack > 0) && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
            {lateOut > 0 && `${lateOut} late out`}
            {lateOut > 0 && lateBack > 0 && ' · '}
            {lateBack > 0 && `${lateBack} late back`}
          </span>
        )}
        <span className="ml-auto text-[10px] text-gray-400">{open ? 'hide' : 'show'}</span>
      </button>

      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 border-t border-gray-100 px-2 py-2">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 px-2 mb-0.5">
              Going out
            </div>
            {going.length === 0 ? (
              <div className="text-[11px] text-gray-400 px-2 py-1">Nothing scheduled out.</div>
            ) : (
              going.slice(0, 8).map((c) => <Row key={`o-${c.cardId}`} c={c} edge="out" />)
            )}
            {going.length > 8 && (
              <div className="text-[10px] text-gray-400 px-2 pt-0.5">+{going.length - 8} more</div>
            )}
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 px-2 mb-0.5">
              Coming back
            </div>
            {coming.length === 0 ? (
              <div className="text-[11px] text-gray-400 px-2 py-1">Nothing due back.</div>
            ) : (
              coming.slice(0, 8).map((c) => <Row key={`i-${c.cardId}`} c={c} edge="back" />)
            )}
            {coming.length > 8 && (
              <div className="text-[10px] text-gray-400 px-2 pt-0.5">+{coming.length - 8} more</div>
            )}
          </div>
          <div className="sm:col-span-2 px-2 pt-1.5 mt-1 border-t border-gray-100">
            <Link href="/dispatch" className="text-[11px] font-semibold text-amber-700 hover:underline">
              Open Deliveries &amp; Pickups →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
