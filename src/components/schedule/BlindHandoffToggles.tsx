'use client'

/**
 * Blind pickup chips — job-wide, or for ONE vehicle.
 *
 * Wes 2026-09-15: sales should be able to "click blind on that
 * reservation"; fleet must always be able to flip it. Jose 2026-09-16:
 * "Sometimes jobs have multiple vehicles and we need the ability to only
 * mark certain vehicles as blind pickups or returns."
 *
 * Oliver 2026-09-18: "Can you remove the blind return buttons? We only
 * need to know about blind pickup. It's confusing the system because it
 * makes the vehicle purple, so fleet assumes the vehicle is going out
 * blind." So this component is PICKUP ONLY. A blind RETURN is still a
 * real thing — it is what the Sunday/after-3:30 drop-off question sets,
 * and it still carries the client's drop-off instructions and lights the
 * inbound "needs check-in" alert on Fleet Dispatch — but it is set in one
 * place now, the order's Blind handoff card, and it never paints a bar.
 *
 * Every write goes through POST /api/jobs/[id]/blind-handoff:
 *   · job-wide  — every live order's flag, and every vehicle override on
 *                 that edge reset, so the whole job really is one answer;
 *   · `vehicle` — that unit's override alone (null = follows the order).
 * The effective answer per unit is decided in lib/fleet/blindHandoff.
 *
 * Three shapes, one component, so the board, the check list, the
 * handover screen and the order page cannot disagree:
 *   default        job-wide chips (+ a per-vehicle list when `vehicles`)
 *   vehicle={…}    chips for that one unit (the check list row, the
 *                  handover screen)
 *   variant="list" only the per-vehicle rows (the order page, whose own
 *                  checkboxes are the order-level control)
 *
 * Instructions (gate code, where to park) stay on the order page — this
 * is the flag, not the brief.
 */

import { useCallback, useEffect, useState } from 'react'
import { EyeOff } from 'lucide-react'

export type BlindOrder = {
  id: string
  orderNumber: string
  status: string
  blindPickup: boolean
  blindReturn: boolean
}

export type BlindKind = 'blindPickup' | 'blindReturn'
/** The only edge these chips write. The route still accepts both kinds —
 *  a stored blind-return override is left alone, not shown. */
const KIND = 'blindPickup' as const
type Kind = typeof KIND

/** One live unit on the job, as GET /api/jobs/[id]/blind-handoff returns it. */
export type BlindVehicleRow = {
  assignmentId: string
  unitName: string
  category: string
  bookingId: string
  bookingNumber: string
  startDate: string
  endDate: string
  blindPickup: boolean | null
  blindReturn: boolean | null
  effective: { blindPickup: boolean; blindReturn: boolean }
}

export type BlindState = { orders: BlindOrder[]; vehicles: BlindVehicleRow[] }

const LABEL: Record<Kind, string> = { blindPickup: 'Blind pickup' }
const KINDS: Kind[] = [KIND]

export function BlindHandoffToggles({
  jobId,
  orders,
  vehicle,
  vehicles = false,
  variant = 'job',
  canEdit,
  onChanged,
  size = 'sm',
  tone = 'light',
  className = 'mb-3',
}: {
  /** The job the flags live on. Null = nothing to write to yet. */
  jobId: string | null | undefined
  /** The job's orders as the caller has them — seeds the job-wide state
   *  until (and unless) the list is loaded. */
  orders: BlindOrder[]
  /** Per-vehicle mode: the chips speak for THIS unit. `effective` is the
   *  server's answer for it (lib/fleet/blindHandoff), not a guess. */
  vehicle?: { assignmentId: string; effective: { blindPickup: boolean; blindReturn: boolean } }
  /** Load the job's vehicles and list a row of chips per unit under the
   *  job-wide ones (shown once the job has more than one unit). */
  vehicles?: boolean
  /** 'list' renders only the per-vehicle rows — for a surface that
   *  already owns the order-level control. */
  variant?: 'job' | 'list'
  canEdit: boolean
  /** 'md' for yard terminals, read standing up. */
  size?: 'sm' | 'md'
  /** 'dark' for the phone screens in the yard, which paint their own
   *  opaque zinc-900 — a light chip there is a flashlight. */
  tone?: 'light' | 'dark'
  className?: string
  /** Called with the job as it now stands, after a write lands. */
  onChanged?: (next: BlindState) => void
}) {
  const [pending, setPending] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [localOrders, setLocalOrders] = useState<BlindOrder[]>(orders)
  const [vehicleRows, setVehicleRows] = useState<BlindVehicleRow[] | null>(null)
  const [localVehicle, setLocalVehicle] = useState(vehicle?.effective ?? null)
  useEffect(() => setLocalOrders(orders), [orders])
  useEffect(() => setLocalVehicle(vehicle?.effective ?? null), [vehicle?.effective.blindPickup, vehicle?.effective.blindReturn]) // eslint-disable-line react-hooks/exhaustive-deps

  const wantList = variant === 'list' || vehicles
  useEffect(() => {
    if (!wantList || !jobId) return
    let alive = true
    fetch(`/api/jobs/${jobId}/blind-handoff`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s: BlindState | null) => {
        if (!alive || !s) return
        setVehicleRows(s.vehicles)
        setLocalOrders(s.orders)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [wantList, jobId])

  const live = localOrders.filter((o) => o.status !== 'CANCELLED')
  const canWrite = canEdit && !!jobId && !pending

  const write = useCallback(
    async (kind: Kind, value: boolean, assignmentId?: string) => {
      if (!jobId) return
      setErr('')
      setPending(`${assignmentId ?? 'job'}:${kind}`)
      try {
        const r = await fetch(`/api/jobs/${jobId}/blind-handoff`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, value, assignmentId }),
        })
        const data = await r.json().catch(() => null)
        if (!r.ok) {
          setErr((data && data.error) || "Couldn't save — try again.")
          return
        }
        const next = data as BlindState
        setLocalOrders(next.orders)
        setVehicleRows(next.vehicles)
        if (vehicle) {
          const mine = next.vehicles.find((v) => v.assignmentId === vehicle.assignmentId)
          if (mine) setLocalVehicle(mine.effective)
        }
        onChanged?.(next)
      } catch {
        setErr("Couldn't save — try again.")
      } finally {
        setPending(null)
      }
    },
    [jobId, onChanged, vehicle],
  )

  // Job-wide state: once the vehicles are known, "on" means every unit is
  // effectively on (an override off would otherwise hide behind a lit
  // chip); until then, any live order's flag — the seed the caller had.
  const rows = vehicleRows ?? []
  const jobOn = (kind: Kind): { on: boolean; count: number; total: number } => {
    if (rows.length > 0) {
      const count = rows.filter((v) => v.effective[kind]).length
      return { on: count === rows.length, count, total: rows.length }
    }
    return { on: live.some((o) => o[kind]), count: 0, total: 0 }
  }

  const chipClass = (active: boolean, disabled: boolean, busy: boolean) =>
    `inline-flex items-center gap-1 rounded-md border font-semibold ${size === 'md' ? 'px-2.5 py-1.5 text-[13px]' : 'px-2 py-1 text-[12px]'} transition-colors disabled:cursor-not-allowed ${
      active
        ? 'border-violet-600 bg-violet-500 text-white hover:bg-violet-600'
        : tone === 'dark'
          ? 'border-zinc-700 bg-zinc-800 text-zinc-200 active:bg-zinc-700'
          : 'border-lt-hairline bg-lt-card text-lt-fg2 hover:border-violet-400 hover:bg-violet-50 hover:text-violet-800'
    } ${disabled ? 'opacity-50' : ''} ${busy ? 'opacity-60' : ''}`

  const note = `${size === 'md' ? 'text-[13px]' : 'text-[11px]'} ${tone === 'dark' ? 'text-zinc-400' : 'text-lt-fg3'}`
  const rowLabel = `${size === 'md' ? 'text-[14px]' : 'text-[12px]'} font-semibold ${tone === 'dark' ? 'text-zinc-100' : 'text-lt-fg'}`

  // ── Per-vehicle mode: this unit's chips. ──
  if (vehicle) {
    const eff = localVehicle ?? vehicle.effective
    return (
      <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
        {KINDS.map((kind) => {
          const active = eff[kind]
          const busy = pending === `${vehicle.assignmentId}:${kind}`
          return (
            <button
              key={kind}
              type="button"
              onClick={() => write(kind, !active, vehicle.assignmentId)}
              disabled={!canWrite}
              aria-pressed={active}
              title={
                active
                  ? `${LABEL[kind]} for this vehicle — the driver handles it without staff. Click to turn off.`
                  : `Mark this vehicle as ${LABEL[kind].toLowerCase()} — the driver handles it without staff`
              }
              className={chipClass(active, !canWrite, busy)}
            >
              <EyeOff size={size === 'md' ? 14 : 12} aria-hidden />
              {LABEL[kind]}
            </button>
          )
        })}
        <span className={note}>This vehicle only</span>
        {err && <span className={`${note} !text-rose-500`}>{err}</span>}
      </div>
    )
  }

  const showList = wantList && rows.length > (variant === 'list' ? 0 : 1)
  const listBody = showList && (
    <div className={variant === 'list' ? '' : 'mt-2 pt-2 border-t border-dashed ' + (tone === 'dark' ? 'border-zinc-700' : 'border-lt-hairline')}>
      <div className={`${note} uppercase font-bold tracking-wide mb-1`}>Per vehicle</div>
      <div className="space-y-1">
        {rows.map((v) => (
          <div key={v.assignmentId} className="flex flex-wrap items-center gap-1.5">
            <span className={`${rowLabel} min-w-[5.5rem]`}>
              {v.unitName}
              {v.category && <span className={`font-normal ${tone === 'dark' ? 'text-zinc-400' : 'text-lt-fg3'}`}> · {v.category}</span>}
            </span>
            {KINDS.map((kind) => {
              const active = v.effective[kind]
              const busy = pending === `${v.assignmentId}:${kind}`
              const own = v[kind] != null
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => write(kind, !active, v.assignmentId)}
                  disabled={!canWrite}
                  aria-pressed={active}
                  title={`${v.unitName}: ${active ? LABEL[kind] : `not ${LABEL[kind].toLowerCase()}`}${own ? ' (set for this vehicle)' : ' (follows the order)'}. Click to flip this vehicle only.`}
                  className={chipClass(active, !canWrite, busy)}
                >
                  <EyeOff size={size === 'md' ? 14 : 12} aria-hidden />
                  {LABEL[kind]}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )

  if (variant === 'list') {
    return (
      <div className={className}>
        {vehicleRows === null ? (
          <span className={note}>{jobId ? 'Loading vehicles…' : 'No job yet'}</span>
        ) : rows.length === 0 ? (
          <span className={note}>No vehicle assigned yet — assign one and it appears here.</span>
        ) : (
          listBody
        )}
        {err && <div className={`${note} !text-rose-500 mt-1`}>{err}</div>}
      </div>
    )
  }

  // ── Job-wide mode. ──
  const noOrders = live.length === 0
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1.5">
        {KINDS.map((kind) => {
          const { on, count, total } = jobOn(kind)
          const busy = pending === `job:${kind}`
          const disabled = !canWrite || noOrders
          const mixed = total > 0 && count > 0 && count < total
          return (
            <button
              key={kind}
              type="button"
              onClick={() => write(kind, !on)}
              disabled={disabled}
              aria-pressed={on}
              title={
                noOrders
                  ? 'Blind handoff is set on the order — write the order first'
                  : on
                    ? `${LABEL[kind]} — the driver handles it without staff. Click to turn off for the whole job.`
                    : mixed
                      ? `${count} of ${total} vehicles are ${LABEL[kind].toLowerCase()}. Click to make it the whole job.`
                      : `Mark the whole job as ${LABEL[kind].toLowerCase()} — the driver handles it without staff`
              }
              className={chipClass(on, disabled, busy)}
            >
              <EyeOff size={size === 'md' ? 14 : 12} aria-hidden />
              {LABEL[kind]}
              {mixed && <span className="font-normal opacity-90"> · {count}/{total}</span>}
            </button>
          )
        })}
        {noOrders && <span className={note}>Needs an order first</span>}
        {!noOrders && rows.length > 1 && <span className={note}>Whole job · {rows.length} vehicles</span>}
        {!noOrders && rows.length <= 1 && live.length > 1 && <span className={note}>Applies to all {live.length} orders on this job</span>}
        {err && <span className={`${note} !text-rose-500`}>{err}</span>}
      </div>
      {listBody}
    </div>
  )
}
