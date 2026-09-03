'use client'

/**
 * "Areas in use" — the rooms and lots attached to a stage hold.
 *
 * Wes 2026-08-24: the studio sells three ways (Standing Sets, LED/Volume
 * Stage, Black Box) and everything else is an area you tick off inside
 * that rental. Areas never consume capacity, so this is bookkeeping about
 * what the production is occupying — not a second booking.
 *
 * Saves the whole set on each toggle (idempotent replace), optimistically,
 * so ticking six rooms doesn't feel like six round trips.
 */

import { useCallback, useEffect, useState } from 'react'

interface Area {
  id: string
  name: string
  kind: string
  /** Set when the area lives inside one specific stage. */
  parentStage?: string | null
}

export function StageAreasPicker({
  bookingItemId,
  canEdit,
}: {
  bookingItemId: string
  canEdit: boolean
}) {
  const [areas, setAreas] = useState<Area[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [stageName, setStageName] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/scheduling/booking-items/${bookingItemId}/areas`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d) return
        setAreas(d.areas || [])
        setSelected(new Set<string>(d.selectedIds || []))
        setStageName(d.stageName ?? null)
      })
      .catch(() => { if (live) setAreas([]) })
    return () => { live = false }
  }, [bookingItemId])

  const toggle = useCallback(
    (id: string) => {
      if (!canEdit) return
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setSaving(true)
        fetch(`/api/scheduling/booking-items/${bookingItemId}/areas`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ areaIds: Array.from(next) }),
        })
          .catch(() => {})
          .finally(() => setSaving(false))
        return next
      })
    },
    [bookingItemId, canEdit],
  )

  if (!areas || areas.length === 0) return null

  const rooms = areas.filter((a) => a.kind !== 'PARKING')
  const parking = areas.filter((a) => a.kind === 'PARKING')

  const Chip = ({ a }: { a: Area }) => {
    const on = selected.has(a.id)
    return (
      <button
        key={a.id}
        onClick={() => toggle(a.id)}
        disabled={!canEdit}
        className={`text-[11px] font-semibold px-2 py-1 rounded-lg border transition-colors ${
          on
            ? 'bg-amber-100 border-amber-400 text-amber-900'
            : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
        } ${canEdit ? 'cursor-pointer' : 'cursor-default opacity-90'}`}
      >
        {on ? '' : ''}
        {a.name}
      </button>
    )
  }

  return (
    <div className="pt-2">
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-[10px] font-bold text-gray-400 uppercase">Areas in use</span>
        <span className="text-[10px] text-gray-400">
          {selected.size === 0 ? 'none selected' : `${selected.size} selected`}
          {stageName ? ` · in ${stageName}` : ' · pick a stage to narrow these'}
          {saving && ' · saving…'}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {rooms.map((a) => <Chip key={a.id} a={a} />)}
      </div>
      {parking.length > 0 && (
        <>
          <div className="text-[10px] font-bold text-gray-400 uppercase mt-2 mb-1">Parking</div>
          <div className="flex flex-wrap gap-1.5">
            {parking.map((a) => <Chip key={a.id} a={a} />)}
          </div>
        </>
      )}
    </div>
  )
}
