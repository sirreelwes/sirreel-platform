'use client'

/**
 * Vehicle condition for the whole job — every truck's walk-around at both
 * ends, in one place.
 *
 * Wes, 2026-09-08: "the driver pictures should somehow fold into the
 * damage check for job." They already landed on the same Inspection rows
 * — a driver's self check-out adopts the staff inspection if one exists
 * and creates it if not — but nothing ever showed them at job level. The
 * only view was InspectionsPanel on the ORDER, which is the wrong shape
 * for a damage argument twice over: one job's truck can move across two
 * orders, and a rebook orphans Order.bookingId, so an order-scoped read
 * can come back empty for a vehicle that was photographed properly.
 *
 * So this reads by JOB and groups by VEHICLE, because "was that dent
 * there before?" is a question about a truck on a show, not about an
 * invoice. Out and back sit side by side per vehicle, each labelled with
 * who shot it — staff or the driver — since a client asking why we think
 * they did it deserves a straight answer about where the photo came from.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Camera, ArrowRight, AlertTriangle } from 'lucide-react'
import { REQUIRED_POSITIONS, positionLabel, DAMAGE_POSITION } from '@/lib/fleet/photoPositions'

type Photo = { id: string; filename: string | null; position: string | null }

type Inspection = {
  id: string
  type: 'CHECKOUT' | 'RETURN'
  inspectionDate: string
  mileageAtInspection: number | null
  fuelLevel: string | null
  notes: string | null
  inspectedByUser: { name: string | null; email: string } | null
  inspectedByDriver: { firstName: string; lastName: string } | null
  bookingAssignment: { id: string; asset: { unitName: string } | null } | null
  photos: Photo[]
  damageItems: { id: string; locationOnVehicle: string | null; damageType: string; severity: string; isPreExisting: boolean }[]
}

const shotBy = (i: Inspection): string =>
  i.inspectedByDriver
    ? `${i.inspectedByDriver.firstName} ${i.inspectedByDriver.lastName}`.trim() + ' · driver'
    : i.inspectedByUser?.name || i.inspectedByUser?.email || 'unknown'

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function Side({ label, insp }: { label: 'Out' | 'Back'; insp: Inspection | undefined }) {
  if (!insp) {
    return (
      <div className="flex-1 min-w-0 border border-dashed border-lt-hairline rounded-lg px-3 py-4 text-center">
        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-lt-fg3 mb-1">{label}</div>
        <p className="text-lt-fg3 text-[13px]">No walk-around on record</p>
      </div>
    )
  }
  const slots = insp.photos.filter((p) => p.position && p.position !== DAMAGE_POSITION)
  const damage = insp.photos.filter((p) => p.position === DAMAGE_POSITION)
  const have = new Set(slots.map((p) => p.position as string))
  const missing = REQUIRED_POSITIONS.filter((s) => !have.has(s.id))

  return (
    <div className="flex-1 min-w-0 border border-lt-hairline bg-lt-card rounded-lg p-3">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-lt-fg2">{label}</span>
        <span className={`text-[12px] font-semibold ${missing.length === 0 ? 'text-chip-good-fg' : 'text-chip-warn-fg'}`}>
          {slots.length} of {REQUIRED_POSITIONS.length}
        </span>
      </div>
      <div className="text-lt-fg2 text-[13px] mb-2">
        {when(insp.inspectionDate)} · {shotBy(insp)}
        {insp.mileageAtInspection != null && <> · {insp.mileageAtInspection.toLocaleString()} mi</>}
        {insp.fuelLevel && <> · fuel {insp.fuelLevel}</>}
      </div>

      {insp.photos.length > 0 && (
        <div className="grid grid-cols-4 gap-1.5 mb-2">
          {insp.photos.slice(0, 12).map((p) => (
            <a key={p.id} href={`/api/fleet/photos/${p.id}`} target="_blank" rel="noreferrer" title={positionLabel(p.position)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/fleet/photos/${p.id}`}
                alt={positionLabel(p.position)}
                className="w-full aspect-square object-cover rounded border border-lt-hairline hover:border-lt-fg3"
              />
            </a>
          ))}
        </div>
      )}
      {insp.photos.length > 12 && (
        <p className="text-lt-fg3 text-[12px] mb-1">+{insp.photos.length - 12} more</p>
      )}

      {damage.length > 0 && (
        <p className="text-chip-warn-fg text-[12px] font-semibold">
          {damage.length} damage close-up{damage.length === 1 ? '' : 's'}
        </p>
      )}
      {/* Naming the gaps matters more than counting them: "no passenger
          side" is the sentence that loses the argument later. */}
      {missing.length > 0 && (
        <p className="text-lt-fg3 text-[12px] mt-1">
          Missing: {missing.slice(0, 4).map((m) => m.label).join(', ')}
          {missing.length > 4 ? ` +${missing.length - 4} more` : ''}
        </p>
      )}
    </div>
  )
}

export function JobConditionPanel({ jobId }: { jobId: string }) {
  const [rows, setRows] = useState<Inspection[] | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/fleet/inspections?jobId=${jobId}`)
      .then((r) => (r.ok ? r.json() : { inspections: [] }))
      .then((d) => { if (live) setRows(d.inspections ?? []) })
      .catch(() => { if (live) setRows([]) })
    return () => { live = false }
  }, [jobId])

  // Nothing on record and nothing loading — stay off the page rather than
  // adding an empty card to a job that has no vehicles on it.
  if (!rows || rows.length === 0) return null

  const byAssignment = new Map<string, { unit: string; out?: Inspection; back?: Inspection }>()
  for (const i of rows) {
    const key = i.bookingAssignment?.id ?? i.id
    const entry = byAssignment.get(key) ?? { unit: i.bookingAssignment?.asset?.unitName ?? 'Unassigned vehicle' }
    if (i.type === 'CHECKOUT') entry.out = i
    else entry.back = i
    byAssignment.set(key, entry)
  }
  const vehicles = [...byAssignment.entries()]
  const anyOpenDamage = rows.some((i) => i.damageItems.some((d) => !d.isPreExisting))

  return (
    <div id="condition" className="scroll-mt-4 bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Camera size={16} aria-hidden className="text-lt-fg3" />
        <h2 className="text-lt-fg text-[15px] font-semibold">Vehicle condition</h2>
        <span className="text-lt-fg3 text-[13px]">
          {vehicles.length} vehicle{vehicles.length === 1 ? '' : 's'}
        </span>
        {anyOpenDamage && (
          <span className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold text-chip-warn-fg border border-chip-warn-fg/25 bg-chip-warn-bg rounded-md px-2 py-1">
            <AlertTriangle size={12} aria-hidden />
            Damage logged
          </span>
        )}
      </div>

      <div className="space-y-3">
        {vehicles.map(([key, v]) => (
          <div key={key} className="border border-lt-hairline rounded-xl p-3 bg-lt-inner/40">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lt-fg text-[15px] font-semibold">{v.unit}</span>
              {/* The out-vs-back document hangs off the RETURN, same as
                  on the order panel. */}
              {v.back?.bookingAssignment && (
                <Link
                  href={`/api/fleet/inspections/report/${v.back.bookingAssignment.id}`}
                  target="_blank"
                  className="ml-auto inline-flex items-center gap-1 text-[13px] font-semibold text-amber-700 hover:text-amber-600"
                >
                  Out vs back
                  <ArrowRight size={12} aria-hidden />
                </Link>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Side label="Out" insp={v.out} />
              <Side label="Back" insp={v.back} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
